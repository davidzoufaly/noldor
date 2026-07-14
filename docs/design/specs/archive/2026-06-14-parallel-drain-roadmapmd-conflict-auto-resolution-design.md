# Parallel-Drain `roadmap.md` Conflict Auto-Resolution — Design

**Slug:** parallel-drain-roadmapmd-conflict-auto-resolution
**FD:** docs/features/parallel-drain-roadmapmd-conflict-auto-resolution.md
**Date:** 2026-06-14
**Tier:** specs-only
**Parent:** parallel-drain (`docs/features/parallel-drain.md`)
**Deps:** none

## Problem

Under `pnpm noldor autonomous queue-drain --concurrency N` (N>1), every fast-track
child removes its own schema-C block from the shared `docs/roadmap.md` during its
gate run, then commits that on its own `fast/<slug>` branch. The serialized merge
coordinator (`coordinator()` in `src/autonomous/drain-loop.ts:261`) merges PRs one at
a time, each rebased onto the prior merge via `gh pr update-branch`
(`src/autonomous/drain-io.ts:78-83`). Git's line-merge cannot auto-resolve *adjacent*
block removals — two children that each delete a neighbouring `###`/`####` block
produce overlapping hunks → the PR goes `DIRTY`.

`classifyMergeView()` (`src/autonomous/drain-io.ts:30`) maps `DIRTY`/`CONFLICTING` →
`merge-conflict`; `mergePr()` returns that; the coordinator skips the slug, records
`"merge-conflict — PR left open for human resolution"`, and leaves the worktree +
open PR orphaned (`drain-loop.ts:276-278`). Hit live during a 23-entry drain: ~5 of
the K=3 PRs went `DIRTY`, forcing a fall back to `--concurrency 1`. Sequential is
conflict-free by construction (each merges before the next branch is cut), so the
fallback works — but it defeats the entire point of parallel drain for the
roadmap source.

The block removal is **deterministic**: given a slug, the correct post-merge content
is *"the freshly-rebased base's `docs/roadmap.md`, minus that slug's block"* —
regardless of which adjacent blocks the prior PRs removed. We already own that exact
primitive: `removeBlock(raw, slug)` in `src/utils/write-blocks.ts:192`. So the
coordinator should re-apply the removal against the fresh base rather than letting
git's textual 3-way merge fail.

> Note: the roadmap entry's `Touches:` line cites `src/utils/parse-blocks.ts`, but the
> deterministic *remover* lives in `src/utils/write-blocks.ts` (`removeBlock`).
> `parse-blocks.ts` is the read-only sibling. Implementation surface is corrected to
> `write-blocks.ts` — see Open Question 6.

## Goals

- Make `--concurrency >1` usable for roadmap-source drains: a `roadmap.md`-only
  block-removal conflict resolves automatically instead of orphaning the PR.
- Resolution is deterministic and content-correct: fresh base minus the slug's block,
  via the existing `removeBlock` primitive — never a textual 3-way merge.
- Fail **closed**: any conflict touching a path other than `docs/roadmap.md`, or any
  unexpected git failure, falls back to today's behaviour (leave PR open,
  `merge-conflict`). Never silently mis-merge.
- Contained in the IO adapter (`drain-io.ts`); `drain-loop.ts` coordinator contract and
  the `DrainResult` shape stay unchanged.

## Non-goals

- Resolving conflicts in any file other than `docs/roadmap.md` (code conflicts between
  two fast-track features are genuine and must stay human-escalated).
- Touching the K=1 sequential path — it is conflict-free by construction and unchanged.
- Auto-resolving the plans source (`feat/<slug>`, `docs/backlog.md`) — out of scope;
  plans drain at K=1 today per the drain operational gotchas.
- A new `DrainResult`/`MergeOutcome` variant — auto-resolved folds into existing
  `merged`, unresolvable into existing `merge-conflict` (Open Question 5).

## Design

### Unit 1 — `resolveRoadmapConflict()` (new, `src/autonomous/drain-io.ts`)

A new exported function, split pure/IO in the **`salvage.ts` style** (`GitRunner`
injection) so the branching logic is unit-testable without shelling out:

```ts
export type GitRunner = (cmd: string, args: string[]) => { ok: boolean; stdout: string };

export function resolveRoadmapConflict(
  run: GitRunner,
  slug: string,
  branch: string,
  removeBlockFn = removeBlock,        // injected; defaults to write-blocks.removeBlock
  roadmapRel = 'docs/roadmap.md',
  maxAttempts = 3,
): 'resolved' | 'unresolvable';
```

Reuses `GitRunner` exactly as `src/autonomous/salvage.ts:6` defines it (ok=false on
non-zero exit). Algorithm, operating in a **scratch worktree**
`.worktrees/.merge-<slug>` created from `origin/<branch>` (Open Question 1):

1. `git worktree add --force .worktrees/.merge-<slug> origin/<branch>` (detached/branch
   tip of the open PR). On `!ok` → return `'unresolvable'`.
2. Loop up to `maxAttempts`:
   a. `git rebase origin/main`. On `ok` → rebase clean, no conflict → break to push.
   b. On `!ok`, read unmerged paths: `git diff --name-only --diff-filter=U`.
      If the set is **not exactly `{docs/roadmap.md}`** → `git rebase --abort`,
      return `'unresolvable'` (Open Question 2 — fail closed on any code conflict).
   c. Deterministic re-apply (Open Question 3): `git show origin/main:docs/roadmap.md`
      → raw base; `removeBlockFn(raw, slug)` → `newRaw`; write `newRaw` to the worktree's
      `docs/roadmap.md`; `git add docs/roadmap.md`; `git rebase --continue`.
      `removeBlock` throws if the slug's block is absent from the base — catch → return
      `'unresolvable'` (the prior PR somehow already removed it; don't guess).
3. `git push --force-with-lease origin HEAD:<branch>` (Open Question 7 — `fast/*` is the
   drain's exclusive namespace per `salvage.ts:52`). On `!ok` → `'unresolvable'`.
4. `git worktree remove --force .worktrees/.merge-<slug>` (best-effort cleanup), append a
   `kind: 'resolved'` agent-event (mirror `salvage.ts:86` `appendAgentEvent`), return
   `'resolved'`.

All git failures other than the two *semantic* `!ok`s (rebase-conflict in 2b, which is
handled) propagate as `'unresolvable'` — never throw out of the resolver, so the
coordinator's fail-closed posture is preserved.

### Unit 2 — wire into `mergePr()` (`src/autonomous/drain-io.ts:46`)

`mergePr` gains one optional injected param defaulting to a production-bound resolver:

```ts
export async function mergePr(
  cwd, slug, branch,
  pollTimeoutMs = 20 * 60 * 1000,
  pollIntervalMs = 10_000,
  resolve: (slug: string, branch: string) => 'resolved' | 'unresolvable'
    = (s, b) => resolveRoadmapConflict(spawnRunner(cwd), s, b),  // spawnRunner ≅ salvage.ts:62
): Promise<MergeOutcome>
```

In the poll loop (`drain-io.ts:74-76`), when `verdict === 'merge-conflict'`, instead of
returning immediately:

- call `resolve(slug, branch)` **once** (guard with a `resolved` boolean so a still-DIRTY
  re-poll after an `'unresolvable'` doesn't re-attempt);
- on `'resolved'`: re-enqueue auto-merge (`gh pr merge <branch> --auto --squash`) and
  `continue` the poll loop — the rebased+pushed branch re-reads as `BEHIND`→`CLEAN`/merged;
- on `'unresolvable'`: `return 'merge-conflict'` (today's behaviour exactly).

`classifyMergeView()` stays pure and unchanged. The serialized coordinator guarantees no
*other* PR merges while this one resolves, so a single resolve normally suffices; the
`maxAttempts` cap is a loop backstop.

### Unit 3 — coordinator (`src/autonomous/drain-loop.ts`) — no behaviour change

The coordinator (`drain-loop.ts:261-298`) already treats `mergePr` as a black box
returning `MergeOutcome`. An auto-resolved merge now returns `'merged'` → the existing
`shipped += 1` + `syncMainCleanState()` + oracle path fires unchanged. An unresolvable
conflict returns `'merge-conflict'` → existing skip path. **No edit required** beyond an
optional skip-reason wording tweak; the `DrainDeps.mergePr` signature
(`drain-loop.ts:42`) is untouched.

### Test surface (`src/autonomous/__tests__/`)

- New `resolve-roadmap-conflict.test.ts`: scripted `GitRunner` (mirror
  `salvage.ts` test style) — assert (a) rebase-clean → `'resolved'`; (b) conflict on
  `docs/roadmap.md` only → regen via injected `removeBlockFn` stub → `'resolved'`;
  (c) conflict including a `.ts` path → `'unresolvable'` + `git rebase --abort` issued;
  (d) `removeBlockFn` throw → `'unresolvable'`; (e) force-push `!ok` → `'unresolvable'`.
- Extend `merge-coordinator.test.ts`: a `merge-conflict` slug whose injected `resolve`
  returns `'resolved'` now ships (folds into the existing harness's `mergePr` mock);
  `'unresolvable'` reproduces today's skip assertion (`merge-coordinator.test.ts:56`).
- `removeBlock` adjacency is already locked by `write-blocks.test.ts:83-104`.

## Acceptance criteria

- `resolveRoadmapConflict` returns `'resolved'` when the only unmerged path is
  `docs/roadmap.md`, producing `origin/main:docs/roadmap.md` with exactly the slug's
  block removed (verified via injected `removeBlockFn`), and force-pushes `<branch>`.
- Returns `'unresolvable'` (and runs `git rebase --abort`) when any non-roadmap path
  conflicts, when `removeBlock` throws, or on any git `!ok` — never throws.
- `mergePr` attempts resolution at most once per genuine `merge-conflict` verdict; on
  `'resolved'` it re-enqueues auto-merge and keeps polling; on `'unresolvable'` it
  returns `merge-conflict` byte-identically to today.
- A K=3 roadmap drain where two slugs remove adjacent roadmap blocks ships both
  (regression-tested via the coordinator harness), instead of skipping one.
- K=1 path, `classifyMergeView`, `DrainResult` shape, and `DrainDeps.mergePr` signature
  are unchanged (existing tests stay green).
- Resolution emits a `kind: 'resolved'` agent-event for telemetry honesty.

## Risks / trade-offs

- **New git complexity in the merge lane.** A scratch-worktree rebase is more moving
  parts than today's skip. Mitigation: fail-closed everywhere — any unexpected `!ok`
  yields `'unresolvable'`, i.e. exactly today's safe behaviour; the worst case is no
  worse than the current state.
- **Force-push on `fast/<slug>`.** Safe only because `fast/*` is the drain's exclusive
  namespace (`salvage.ts:52-58` already deletes them unconditionally). `--force-with-lease`
  guards against a surprise concurrent push.
- **Mis-resolution if a fast-track also edits `docs/roadmap.md` beyond its block-removal.**
  By construction a fast-track child's only roadmap edit is removing its own block, so the
  deterministic re-apply is correct. If that invariant ever breaks, the change lands on a
  non-conflicting path and is unaffected; a conflicting non-block roadmap edit would be
  silently overwritten — acceptable given the invariant, flagged here for auditors.
- **Scratch worktree leak** if cleanup `!ok`. `syncMainCleanState`'s `git worktree prune`
  (`drain-io.ts:112`) reaps stale admin entries on the next iteration; the `.merge-<slug>`
  name is namespaced to avoid colliding with build worktrees.

## User Story

As an operator draining a large roadmap queue with `--concurrency >1`, I want adjacent
`docs/roadmap.md` block-removal conflicts resolved automatically by re-applying the
deterministic block removal against the freshly-rebased base, so that parallel fast-track
PRs all merge instead of going `DIRTY` and orphaning their worktrees — without me falling
back to `--concurrency 1`.

## Usage

**CLI** — no new flags; behaviour is automatic under the existing parallel path:

1. Run as today: `pnpm noldor autonomous queue-drain --concurrency 3` from a clean `main`.
2. When two children remove adjacent roadmap blocks and a PR would go `DIRTY`, the
   serialized coordinator now rebases the branch, re-applies `removeBlock(<base>, <slug>)`
   to `docs/roadmap.md`, force-pushes, and re-merges — transparently.
3. A conflict on any non-roadmap path (e.g. two features editing the same `.ts`) still
   leaves the PR open with `merge-conflict — PR left open for human resolution`; resolve
   by hand as today.
4. Auto-resolution surfaces as a `kind: 'resolved'` agent-event (visible via the metrics /
   agent-events surface) so the operator can audit which merges were machine-rebased.

**Agent API** (internal): `resolveRoadmapConflict(run, slug, branch)` →
`'resolved' | 'unresolvable'`, invoked by `mergePr` on a `merge-conflict` verdict.

## Open questions (resolved)

1. *Where to run the rebase — the build worktree, the main workspace HEAD, or a scratch
   worktree?* -> **Scratch worktree `.worktrees/.merge-<slug>` from `origin/<branch>`.**
   The build worktree's liveness at merge time isn't guaranteed and the main workspace HEAD
   is unsafe to checkout-flip while K workers run (D1).
2. *Auto-resolve any doc-only conflict, or strictly `docs/roadmap.md`?* -> **Strictly
   `docs/roadmap.md`.** It's the only path with a provably-deterministic resolution; any
   other unmerged path → `'unresolvable'`, fail closed (D2).
3. *Re-apply via `removeBlock` against the fresh base, or attempt a smarter textual
   3-way?* -> **`removeBlock(git show origin/main:docs/roadmap.md, slug)`.** Matches the
   entry's intent; deterministic, no conflict-marker parsing, reuses the existing tested
   primitive (D3).
4. *Cap on resolution attempts per merge?* -> **`maxAttempts = 3`, loop backstop.** The
   serialized coordinator means one attempt normally suffices; the cap guards against a
   pathological re-conflict loop (D4).
5. *Add a distinct `MergeOutcome`/`DrainResult` variant for auto-resolved merges?* ->
   **No.** Resolved folds into existing `merged`, unresolvable into existing
   `merge-conflict`; telemetry rides a `kind: 'resolved'` agent-event. Keeps the
   `drain-loop.ts` coordinator and `DrainResult` contract untouched (D5).
6. *Implement against `src/utils/parse-blocks.ts` (the entry's cited path) or
   `src/utils/write-blocks.ts`?* -> **`write-blocks.ts` `removeBlock`.** That's the actual
   deterministic remover; `parse-blocks.ts` is read-only. The entry's `Touches:` line is
   corrected (D6).
7. *Is force-pushing `fast/<slug>` safe?* -> **Yes, with `--force-with-lease`.** `fast/*`
   is the drain's exclusive namespace — `salvage.ts:52-58` already creates and deletes
   these branches unconditionally; no human shares them (D7).
