# Parallel Drain — Concurrent Autonomous Execution — Design

**Slug:** `parallel-drain`
**FD:** [docs/features/parallel-drain.md](../../features/parallel-drain.md) *(scaffolded via /new-feature — not in roadmap/backlog)*
**Date:** 2026-06-10
**Tier:** full
**Deps:** `autonomous-queue-drain-runner`

> Generalizes the autonomous drain supervisor from **sequential** (one feature at a time) to **K-concurrent**: many features build in parallel, each in its own worktree, each its own auto-merged PR — but merges are **serialized through a queue** so `main` never sees an N-way conflict. Cross-cutting and source-agnostic: it composes with `queue-drain` (XS/S roadmap) today and with the `--source plans` extension (plan-runner) once that lands.

## Problem

The shipped supervisor (`src/autonomous/drain-loop.ts` `runDrain`) is a strictly sequential loop: pick `topPriority[0]` → `spawnGate` → wait for the PR to merge → `syncMainCleanState` → repeat. Wall-clock is therefore the **sum** of every feature's build+review+merge time. For a queue of 25 small features, or a batch of designed plans, that is hours of mostly-idle waiting while one `claude --print "/gate"` child runs and the supervisor blocks on it.

The operator's intuition is right — these should run in parallel, each isolated — but the naive parallelization ("merge all the worktrees together at the end and resolve conflicts") trades one problem for a worse one: an N-way end-merge of features that each touched overlapping code, each retired a `docs/roadmap.md` block, and each flipped an FD phase, **resolved autonomously**. That is precisely the unreliable-autonomy the queue-drain MVP refused to bet on, and a single batch PR also destroys per-FD review + the `Noldor-FD` trailer↔PR mapping.

## Goals

- Run up to **K** features concurrently (`--concurrency N`), each building in its own isolated worktree (which the gate already creates per feature — no shared working tree).
- Keep **one PR per feature** with per-FD CR review, trailer mapping, and skip-on-failure isolation. No batch PR, no fan-in worktree merge.
- Confine all `main`/roadmap contention to a **serialized merge step** ("merge queue"): builds fan out, merges fan in one at a time, each rebased on the prior — conflicts resolved incrementally, never all-at-once.
- Preserve always-clear (every feature is a fresh `claude --print` context — true whether 1 or K run at once), the singleton lock, retry-then-skip, the per-iteration timeout, and the SIGINT/`.noldor/drain-stop` kill switch.
- `--concurrency 1` reproduces today's sequential behavior byte-for-byte (regression-safe default until the operator opts up).

## Non-goals

- **Fan-in / single batch PR** (the `batch-<date>` integration-branch + N-way merge model). Explicitly rejected — see D6. Re-open as a separate FD only if a milestone needs to be reviewed as one unit.
- An **autonomous merge-conflict resolver.** The merge queue *avoids* conflicts (sequential rebase); it does not teach an agent to resolve a genuine semantic conflict. A hard conflict pauses that feature (skip + surface), it is not auto-resolved.
- Cross-feature **dependency ordering** / DAG scheduling. K features are assumed independent; `deps:` ordering is future work.
- Changing what a single `/gate` child does *inside* its worktree. The child is unchanged except for slug assignment (D2).

## Design

### 1. Build-parallel, merge-serial — the shape

Today: `for (;;) { pick; spawn; wait-for-merge; sync }`. New:

- A **build pool** of size K (`runWithConcurrency`-style, like `src/prep/spawn.ts`) keeps K `spawnGate` children in flight. As soon as one finishes, the scheduler calls `decideNext` for the next eligible slug and launches it — the pool stays full until the source is drained or caps hit.
- A **merge coordinator** runs as a single serialized lane. A child's job ends when its **PR is open** (not merged); the coordinator then merges PRs one at a time, each rebased on the latest `main`, via the platform merge queue (preferred) or supervisor-driven `gh pr merge` (fallback). This is the only place `main` advances, so two features never race a `main` update.

Sequential today is just this with K=1 and the merge inline.

### 2. Assigned-slug dispatch (gate change) — `.claude/skills/gate/SKILL.md`

Today drain Step 0 auto-selects `topPriority[0]` honoring `NOLDOR_DRAIN_SKIP`. With K children launching near-simultaneously they would all pick the same top entry. Fix: the supervisor assigns each child a **specific** slug via a new `NOLDOR_DRAIN_SLUG=<slug>` env var; drain Step 0 selects that exact slug when set, falling back to `topPriority[0]` when unset (sequential/back-compat). `NOLDOR_DRAIN_SKIP` is still passed for defense-in-depth. This is the only gate-skill change.

### 3. Worktree isolation — already done, no change

The gate's drain Step 2 already creates `.worktrees/<slug>` on a deterministic branch (`fast/<slug>`, or `feat/<slug>` under plan-runner) and force-recreates a stale branch before `git worktree add`. Distinct slugs → distinct worktrees and branches → **parallel children never share a working tree.** The operator's "each agent its own worktree copy" is satisfied by the existing per-feature worktree; parallel drain simply launches several at once. The supervisor must NOT run `syncMainCleanState` (which does `git checkout main` in the main workspace) while children are mid-flight — it runs only at the start and is replaced mid-run by the merge coordinator's per-PR rebase.

### 4. Roadmap retirement + merge queue — the contention point

Each feature PR still retires its own `docs/roadmap.md` block (fast-track) / flips its FD phase. Under concurrency these would textually conflict at merge time. The merge coordinator resolves this **by serializing merges with a rebase between each**: PR-A merges → PR-B is rebased onto the new `main` (its block-removal reapplies cleanly because A removed a *different* block) → PR-B merges, etc.

- **Preferred:** enable the platform merge queue (GitHub) on `main`; `gh pr merge --auto --squash` then lets the platform serialize+rebase. The supervisor just opens PRs.
- **Fallback (no merge queue):** the coordinator holds a serialized merge lane: for each ready PR, `gh pr merge --squash` one at a time; on a rebase/merge conflict it does **not** auto-resolve — it marks that slug `merge-conflict`, leaves the PR open for human resolution, and continues with the rest (skip-on-fail).

Adjacent-hunk edge (two removed blocks are physically adjacent in roadmap.md) is the only realistic auto-conflict; the rebase-between-merges handles it because only one block is removed per rebase against the already-updated file.

### 5. Success oracle under concurrency

Unchanged in spirit (`absence === shipped`) but evaluated **per feature after its own PR merges**, not by a single post-iteration roadmap re-read. The coordinator, after merging PR-for-slug, re-reads the source on the freshly-synced `main`; slug absent → shipped; still present after `maxRetries` → skip. A child that never opened a PR (build failed / timed out) → retry-then-skip, identical to today.

### 6. Supervisor state + lifecycle

- `src/autonomous/drain-state.ts`: `currentSlug` → `inFlight: Array<{ slug; phase: 'building' | 'awaiting-merge'; worktree: string }>`; plus `merging: string | null`. Heartbeat reflects all K.
- Singleton `.noldor/drain.lock` unchanged — still one supervisor.
- Kill switch: SIGINT / `.noldor/drain-stop` stops *scheduling new* children, lets in-flight builds finish (or kills on a grace timeout), drains the merge queue, exits 130.
- Caps: `--max-features` / `--max-spawns` still bound total work; `--concurrency` bounds simultaneity.

### 7. Source-agnostic

The pool/coordinator live in `runDrain` and know only slugs + the injected `DrainDeps`/`DrainSource` seam. Parallel drain therefore applies unchanged to `--source roadmap` (queue-drain) and `--source plans` (plan-runner); `branchFor`/`gatePrompt` already vary by source. No source literal enters the scheduler.

## Acceptance criteria

- `--concurrency 1` (default) reproduces current sequential behavior; existing `src/autonomous/__tests__` pass with only injected-pool wiring changes.
- `--concurrency K` keeps up to K `spawnGate` children in flight; each builds in its own `.worktrees/<slug>`; the main workspace is never `git checkout`-ed mid-flight.
- Each shipped feature is its own squash-merged PR with its `Noldor-FD` trailer; no batch PR is created.
- Merges are serialized: at most one PR merges at a time, each rebased on the prior; a roadmap-block-removal conflict between two concurrent features does not corrupt `main` (it either auto-rebases clean or the second is left open + marked, never force-merged).
- A build/merge failure on one slug skips that slug (retry-then-skip) and does not abort the others.
- SIGINT / `.noldor/drain-stop` stops new scheduling, finishes/drains in-flight, exits 130.
- `decideNext`/scheduler contain no source or branch literals.

## Risks / trade-offs

- **Merge-queue dependency.** Best behavior needs a platform merge queue; the `gh`-serialized fallback is correct but slower and leaves hard conflicts for a human. Mitigation: detect + document; default `--concurrency` conservative.
- **Resource load.** K concurrent `claude --print` + K worktrees + K `pnpm install` is heavy (CPU, disk, API rate). Mitigation: low default (K=3), `--concurrency` bound, and the existing per-iteration timeout.
- **`gh` rate limits / auto-merge queue depth** under many concurrent PRs. Mitigation: serialized merge lane naturally throttles PR-merge API calls.
- **Worktree leakage on crash.** K worktrees outstanding if the supervisor dies. Mitigation: startup `git worktree prune` + per-slug force-recreate (already in gate) + a documented `--cleanup` recovery path.
- **Harder to reason about than sequential.** Mitigation: K=1 default keeps the simple path the norm; concurrency is opt-in.

## User Story

As an operator draining a large queue (or a batch of designed plans), I want `--concurrency N` so that N features build in parallel — each isolated in its own worktree, each its own auto-merged PR — while merges serialize safely onto `main`, so that I drain the queue in roughly queue-size/N wall-clock instead of sequentially, without giving up per-feature review or risking an N-way merge.

## Usage

**CLI**

1. Same headless-safe config precondition as queue-drain (`autonomous.onFailure: 'abort'`, `skipLanePicker: true`, `requireHumanPrApproval: false`).
2. From a clean, synced `main`: `pnpm noldor autonomous queue-drain --concurrency 3` (or, once plan-runner lands, `autonomous run --source plans --concurrency 3`).
3. `--concurrency 1` (default) = today's sequential drain. Combine with `--max-features`, `--max-retries`, `--iteration-timeout`, `--dry-run`, `--json`.
4. Preferred: enable the GitHub merge queue on `main` first; otherwise the supervisor serializes merges itself.
5. Stop with SIGINT or `touch .noldor/drain-stop` — in-flight builds finish, the merge lane drains, then exit 130.

**Exit codes**

- `0` drained / all-skipped / cap reached · `1` aborted (config/lock/systemic spawn or git failure) · `130` stopped via kill switch.

## Open questions (resolved)

1. *Parallel via fan-in (one batch PR) or per-feature PRs?* → **Per-feature PRs, parallel build + serial merge** (D6 rejects fan-in). Keeps per-FD review/trailer/skip-on-fail; the merge queue gives incremental conflict resolution without an N-way end-merge.
2. *How do K children avoid all picking the same top entry?* → Supervisor assigns each a `NOLDOR_DRAIN_SLUG=<slug>`; gate selects that slug when set, else falls back to `topPriority[0]` (D2). Only gate-skill change.
3. *How is the roadmap/main race resolved?* → A **serialized merge lane**: merge one PR at a time, rebase each on the prior; prefer the platform merge queue, fall back to supervisor `gh pr merge`; a genuine conflict is left open + marked, never force-merged (D4).
4. *Default concurrency?* → **1** (sequential, regression-safe); operator opts up with `--concurrency N`. Recommended practical ceiling small (≤ ~4) given resource + merge-API load (D5).
5. *Does this need its own worktree machinery?* → No — the gate already creates `.worktrees/<slug>` per feature; parallel drain just launches several at once and stops the supervisor from `git checkout`-ing the main workspace mid-flight (D3).
6. *Why not the operator's `batch-<date>` + fan-in-merge model?* → It forces autonomous N-way conflict resolution, a single giant-review batch PR, and loss of per-FD trailer mapping + skip-on-fail. The merge-queue model delivers the same parallelism and the same "resolve conflicts incrementally on the way to one clean main" outcome, at per-feature granularity, without those costs (D6). Revisit only if a milestone must be reviewed as a single PR.

## Out of scope (YAGNI)

- A dependency-aware scheduler (topological ordering by `deps:`).
- Auto-resolving semantic merge conflicts.
- Distributing children across machines.

## Files touched (proposed)

- `src/autonomous/drain-loop.ts` — replace the sequential `for` with a K-bounded build pool + a serialized merge coordinator; `decideNext` unchanged in spirit, fed by the scheduler.
- `src/autonomous/drain-io.ts` — `spawnGate` gains the `NOLDOR_DRAIN_SLUG` env; add a `mergePr(slug, branch)` / merge-queue helper; `openPrExistsFor` already branch-aware.
- `src/autonomous/queue-drain.ts` — parse `--concurrency` (default 1); thread into `runDrain`.
- `src/autonomous/drain-state.ts` — `inFlight[]` + `merging` heartbeat.
- `.claude/skills/gate/SKILL.md` — drain Step 0 honors `NOLDOR_DRAIN_SLUG`.
- Tests: pool scheduling (K in flight, refill), assigned-slug dispatch, serialized-merge conflict handling, `--concurrency 1` regression, kill-switch drains in-flight.

## Related

- Deps / parent: [autonomous-queue-drain-runner](../../features/autonomous-queue-drain-runner.md) — the sequential supervisor this parallelizes.
- Composes with: [plan-runner](2026-06-10-plan-runner-design.md) (`--source plans`) — concurrency is orthogonal to source.
- Feeds from: the `prep` pipeline (`noldor prep fanout` → `prep promote`) produces the in-progress FDs a parallel `--source plans` drain then executes concurrently.
- Origin: operator's "branch out, per-agent worktrees, merge recursively, resolve conflicts on the way, one merge" — reinterpreted as build-parallel + merge-serial (per-feature PRs through a merge queue) rather than a fan-in batch PR.
