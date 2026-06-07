# End-of-Flow Ergonomics — Design

**Date:** 2026-06-07
**FD:** `noldor` (attach; enhancement `end-of-flow-ergonomics`)
**Path:** `full-attach`

## Problem

Two ergonomics gaps in the `/gate` Step 4 post-merge handoff (`openAndAutoMerge`):

1. **Worktree-cleanup mismatch (silent leak).** `gate/SKILL.md`
   Step 4 and `docs/noldor/pr-flow.md` instruct the controller to remove the
   worktree via the native `ExitWorktree` tool (`action: 'remove'`). But the
   framework creates worktrees via `git worktree add .worktrees/<name>`
   (`worktree-discipline.md`). The native `ExitWorktree` tool only manages
   worktrees it created under `.claude/worktrees/`. On a worktree it did not
   create, its tool contract describes a **no-op** — it reports no active
   worktree session and takes no action. (The remedy below — direct git — is
   correct regardless of whether the precise failure mode is no-op or some
   prompt; the point is the instruction doesn't match the creation mechanism.)
   So the failure mode is **not** a blocking stall: it silently does nothing,
   leaving the worktree
   directory and `feat/<name>` branch on disk and local `main` unsynced from
   the merged squash. The next session then starts from a stale `main` with
   orphaned worktree residue. The harm is a silent leak, not an interactive
   block — the cleanup instruction simply doesn't match the creation mechanism.

2. **Silent auto-merge polling.** `pollAutoMerge` (`src/core/pr-flow.ts`) polls
   `gh pr view --json mergedAt,state` every 5s for up to 10min (20min when
   `BEHIND`) with zero operator visibility. The operator cannot distinguish
   "polling healthy, waiting on required checks" from "hung / network dropped".

These are independent; bundled in one FD because both live in the same
end-of-flow surface — the three surface files `src/core/pr-flow.ts`,
`.claude/skills/gate/SKILL.md`, and `docs/noldor/pr-flow.md` (the full edit set,
incl. tests + the FD link fix, is six files — see the table below).

## Goals

- Post-merge cleanup actually removes the worktree + branch and syncs local
  `main` (no silent leak), via a non-interactive git sequence.
- Operator sees periodic healthy-progress signal during auto-merge polling.
- No regression to merge-detection latency.

## Non-goals

- The pre-merge `requireHumanPrApproval` prompt is **out of scope** — it fires
  *before* merge and is a deliberate gate (skipped in autonomous mode via
  `shouldPromptForPrApproval`). This FD touches only the post-merge window.
- No change to `superpowers:finishing-a-development-branch` handling — gate
  already correctly excludes it as interactive.
- No change to poll timeout ceilings (10min / 20min-BEHIND).

## Part (b) — Stream auto-merge poll status

### Mechanism

`pollAutoMerge` gains two injected seams, mirroring the existing `SpawnFn`
injection pattern so both the deadline and the throttle logic are
deterministically unit-testable without real timers or real `gh`:

- `onStatus?: (line: string) => void` — emit sink for status lines.
- `now?: () => number` — clock function, defaults to `Date.now`. Drives both
  the existing deadline math (`Date.now() - start`) and the new throttle, so a
  test can advance time arbitrarily between scripted poll cycles and assert the
  30s boundary exactly. (`setTimeout` for the inter-poll sleep stays real but is
  driven with a tiny `intervalMs` in tests — only the *throttle/deadline*
  decisions read `now()`, so wall-clock advance is irrelevant to assertions.)

```ts
export async function pollAutoMerge(opts: {
  prUrl: string;
  spawn: SpawnFn;
  intervalMs: number;
  timeoutMs: number;
  onStatus?: (line: string) => void;
  now?: () => number;
}): Promise<{ mergedAt: string }>;
```

### Behavior

- Fetch field set widens: `gh pr view <url> --json mergedAt,state,mergeStateStatus`.
- Poll interval stays 5s (responsive merge detection preserved).
- Emit-on-change OR throttle: emit a status line when **any** of these hold —
  (1) first poll cycle, (2) `state` or `mergeStateStatus` changed since the last
  emitted line, or (3) ≥30s have elapsed (per `now()`) since the last emission.
  A meaningful transition (e.g. `OPEN→BEHIND`, `mergeStateStatus BLOCKED→CLEAN`)
  surfaces immediately rather than being suppressed for up to 30s — that
  transition is exactly the moment an operator wants to see. Steady-state
  (no change) falls back to the 30s throttle so a stalled poll still emits
  periodically. Both the deadline and the throttle read the injected `now()` —
  no separate timer.
- Line format:
  `Auto-merge: state=<state>, mergeStateStatus=<mergeStateStatus>, elapsed=<s>s`
  where `<s>` is whole seconds since poll start (`Math.floor((now()-start)/1000)`).
- If the PR is already merged on the first poll cycle, return immediately
  **without** emitting a status line (no spurious output on instant merges).
- `mergeStateStatus` is one of GitHub's `BEHIND | BLOCKED | CLEAN | DIRTY |
  DRAFT | HAS_HOOKS | UNKNOWN | UNSTABLE`. When the field is absent/null in the
  JSON (older `gh`, edge cases), print `UNKNOWN`.

### Wiring

- `openAndAutoMerge` threads `onStatus` from its input through to
  `pollAutoMerge`.
- `OpenAndAutoMergeInput` gains optional `onStatus?: (line: string) => void`.
- `pr-flow-cli.ts` passes `onStatus: (line) => process.stderr.write(line + '\n')`.
  Stderr (not stdout) keeps the machine-readable PR URL on stdout clean.

### Edge cases

- Throttle boundary: at exactly 30s since last emit, emit (`>=`).
- `gh pr view` non-zero exit on a cycle: existing behavior unchanged (skip,
  retry next interval) — no status line for failed fetches (we have no fresh
  state to report).
- `BEHIND` extends the deadline as today; status lines continue at the same
  30s throttle through the extended window.

## Part (a) — Fix worktree-cleanup mismatch (doc/skill only)

Zero code. Replace the `ExitWorktree` cleanup instruction with the
non-interactive git sequence that `worktree-discipline.md` already documents
under "Finishing a worktree".

### `.claude/skills/gate/SKILL.md` — Step 4 "On merged" cleanup

The **Worktree-backed paths** bullet changes from:

> `ExitWorktree` native tool with `action: 'remove'` — removes the worktree
> directory + deletes the local feature branch.

to:

> `git worktree remove [--force] .worktrees/<name>` then
> `git branch -D feat/<name>` — removes the worktree directory + deletes the
> local feature branch. Non-interactive; no native tool. `--force` only if the
> worktree has uncommitted changes (it should not at this point).

**`-D`, not `-d`:** the PR is **squash**-merged (`gh pr merge --squash`), so the
feature branch's commits are not ancestors of `main`. `git branch -d` rejects
with "not fully merged" and the branch leaks — recreating the silent-leak class
this fix targets, moved from worktree to branch. Use the force delete `-D`. This
also corrects the three `git branch -d feat/<name>` references in
`worktree-discipline.md` (table row + two finish-sequence bullets), which carry
the same latent bug; left as `-d` they would contradict the gate instruction
(Detector 14/15 drift).

The subsequent local-`main` sync sentence
(`git fetch origin main && git checkout main && git merge --ff-only origin/main`)
is unchanged.

### `docs/noldor/pr-flow.md`

- Flow-diagram line: `explicit cleanup: ExitWorktree (worktree paths) OR delete
  temp branch (micro-chore)` → `explicit cleanup: git worktree remove + git
  branch -D (worktree paths) OR delete temp branch (micro-chore)`.
- "Local main sync" paragraph: replace the `after ExitWorktree` phrasing with
  `after git worktree remove`.

### Verification of "zero prompts"

After the doc fix, the post-merge sequence is: `git worktree remove` →
`git branch -D` → `git fetch` → `git checkout main` → `git merge --ff-only` →
`next-priority`. None prompt. `superpowers:finishing-a-development-branch` is
not invoked. Goal met.

## Cleanup riders (found during audit)

- **Stale path (in scope — our file).** The `links.code` entry appended to
  `docs/features/noldor.md` during promote used `scripts/noldor/pr-flow.ts`; the
  file now lives at `src/core/pr-flow.ts` (source migrated
  `scripts/noldor/**` → `src/core/**`). Correct **this one** entry to
  `src/core/pr-flow.ts` in the implementation — it is the file this FD touches.
  `.claude/skills/gate/SKILL.md` and `docs/noldor/pr-flow.md` paths are correct.

- **Other stale `links.code` paths (scope-deferred).** The same migration left
  7 further stale `scripts/noldor/*.ts` entries in `docs/features/noldor.md`
  frontmatter (`changelog.ts`, `next-priority.ts`, `lint-plan-snippets.ts`,
  `release-markers.ts`, `validate-noldor-scope.ts`, `validate-noldor.ts`,
  `validate-skill-catalog.ts`), plus the auto-generated Resources markdown
  links that regenerate from them. **Deferred deliberately:** these are
  orthogonal pre-existing drift, not part of the end-of-flow surface, and
  fixing them here would widen this FD into unrelated link maintenance (and
  pull in the generated-Resources regen path). They are a clean `/garden`
  link-drift sweep or a one-line `chore`. Tracked as roadmap entry "Noldor FD
  stale `links.code` paths (scripts/noldor → src/core)".
  `pnpm validate:features` currently passes
  with them present (the validator does not assert path existence), so they are
  stale-but-not-failing — no release blocker.

## Files touched

| File | Change | Kind |
| --- | --- | --- |
| `src/core/pr-flow.ts` | `onStatus`/`now` seams, `mergeStateStatus` fetch, emit-on-change-OR-throttle, thread through `openAndAutoMerge` | code |
| `src/core/pr-flow-cli.ts` | wire `onStatus` → stderr | code |
| `src/core/__tests__/pr-flow.test.ts` | first-cycle / throttle / emit-on-change / parse / instant-merge / failed-fetch tests | test |
| `.claude/skills/gate/SKILL.md` | Step 4 cleanup → `git worktree remove` + `git branch -D` | doc/skill |
| `docs/noldor/pr-flow.md` | diagram + sync paragraph (`-D`) | doc |
| `docs/noldor/worktree-discipline.md` | 3× `git branch -d` → `-D` (squash-merge correctness) | doc |
| `docs/features/noldor.md` | correct stale `links.code` path | doc |

## Test plan

- Unit (`pr-flow.test.ts`): inject a fake `spawn` returning scripted
  `gh pr view` JSON across cycles, a **settable** clock (a `let nowMs` the test
  mutates between awaited cycles, exposed as `now: () => nowMs`) so the test
  controls the value regardless of how many times `now()` is read within a
  cycle — `now()` is called multiple times per cycle (deadline check + throttle
  check + `elapsed`), so a positional array would drift; a settable variable
  does not. Plus a recording `onStatus`; assert:
  - first cycle emits one line with correct `state` / `mergeStateStatus` / `elapsed`;
  - steady state (unchanged `state`+`mergeStateStatus`): no second emit when
    `now()` advances <30s; emit when it advances ≥30s (boundary asserted exactly
    via the injected clock);
  - emit-on-change: a `state` or `mergeStateStatus` transition inside the 30s
    window emits immediately (e.g. `OPEN`→`BEHIND` at elapsed 20s);
  - instant merge (first cycle has `mergedAt`) emits nothing and returns;
  - `mergeStateStatus` absent → `UNKNOWN`;
  - failed (non-zero) `gh` fetch cycle emits nothing (no fresh state to report).
- Existing `pollAutoMerge` / `openAndAutoMerge` tests stay green (callback optional).
- Manual: next real `/gate` end-of-flow ships through the new cleanup sequence
  and prints status lines (acceptance via dogfood).
