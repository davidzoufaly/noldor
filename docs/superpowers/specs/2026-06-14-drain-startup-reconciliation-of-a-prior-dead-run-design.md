# Drain Startup Reconciliation of a Prior Dead Run — Design

**Slug:** drain-startup-reconciliation-of-a-prior-dead-run
**FD:** docs/features/drain-startup-reconciliation-of-a-prior-dead-run.md
**Date:** 2026-06-14
**Tier:** specs-only
**Deps:** none (attaches to `autonomous-queue-drain-runner`)

## Problem

When a drain dies mid-run (session pause / crash / SIGKILL) it leaves a mess that a fresh drain does NOT clean up:

1. **Open PRs the next run ignores.** A clean open `fast/<slug>` PR from the dead run is left for the operator to merge by hand; a DIRTY one must be closed + rebuilt by hand. The worker's open-PR guard in `runDrain` (`drain-loop.ts:226`) only *skips* such slugs (`pr-open-unmerged`) — it never merges the clean ones or closes the dirty ones. Done by hand 3× in one session.
2. **Orphaned `fast/*` worktrees + branches for already-shipped slugs.** `syncMainCleanState` (`drain-io.ts:105`) runs `git worktree prune` (admin-only — drops entries for *already-gone* dirs) and deliberately refuses to remove live `fast/*` worktrees, because it can't tell a drain orphan from a human's feature worktree. So a worktree whose slug already shipped lingers.
3. **Stale lock.** Partly handled: `acquireLock`/`liveLockPid` (`drain-lock.ts:35,56`) already reclaim a lock whose holder pid is dead. The residual gap is the dead run's **orphan agent children**.
4. **Orphan agent grandchildren survive runner death.** `spawnAgent` (`registry.ts:118`) spawns the `claude --print /gate` child in the runner's own process group with no `detached`; on runner SIGKILL the child (and the real agent process it spawns) keeps running, holding context and a worktree. `spawnAgent`'s timeout path also only `child.kill('SIGKILL')`s the direct child (`registry.ts:134`), not its descendants.
5. **Late-failing divergence.** An un-pushed local-`main`-ahead-of-`origin` commit (e.g. a triage commit on local main) does NOT trip the existing `git merge --ff-only origin/main` (`drain-io.ts:111`) — that guard only catches *behind* divergence; local-ahead is "Already up to date". The divergence surfaces only *after* a gate child did the work and tries to retire the entry against an out-of-sync `origin/main`.

## Goals

- Add a **startup reconciliation pass** that runs once, right after lock acquisition, before the first gate spawn, and is a no-op when there's nothing to reconcile.
- For each in-source slug with an open drain-namespace PR: **merge when CLEAN** (advance the oracle), **close + flag-for-rebuild when DIRTY/CONFLICTING**.
- **Prune orphaned `fast/*` worktrees + branches** whose slug is already shipped (absent from the source universe) — without touching human feature worktrees.
- **Reap orphan agent process groups** of a dead prior run before acquiring/using the lock.
- **Spawn each gate child in its own process group** and group-kill on runner death / timeout, so the orphan case stops being created in the first place.
- **Pre-flight a queue-source-vs-origin sync check** and fail loud *before* the first spawn.

## Non-goals

- Reconciling PRs / worktrees that are NOT in the drain's branch namespace (`fast/*` for roadmap, `feat/*` for plans) — human worktrees and unrelated branches are untouched.
- Re-implementing dead-pid lock reclaim — that already exists in `drain-lock.ts`.
- Auto-pushing or auto-resolving a local-ahead divergence — the pre-flight surfaces it; the operator decides (see D2).
- A cross-run persistent cache. Reconciliation reads the prior run's heartbeat + live git/`gh` state only.

## Design

### Unit 1 — `reconcileDeadRun(cwd, source, deps)` — new `src/autonomous/drain-reconcile.ts`
Orchestrator called from `queue-drain.ts` `main()` immediately after `acquireLock` succeeds and before `runDrain`. Pure-of-IO except through injected deps (mirrors `drain-loop.ts` testability). Returns a `ReconcileReport { reapedPgids: number[]; merged: string[]; closedDirty: string[]; prunedWorktrees: string[] }` logged to stdout (and into the `--json` summary). Idempotent: each sub-unit is a no-op when its input set is empty. Sub-units run in order 2 → 3 → 4 (reap stragglers first, then heal PRs, then prune the freed worktrees).

### Unit 2 — `reapOrphanAgents(cwd)` — orphan process-group reaping
Reads the prior `.noldor/drain-state.json` (`drain-state.ts`). If its `pid` is dead (reuse the `isAlive` probe extracted from `drain-lock.ts`) and it carries `agentPgids`, `process.kill(-pgid, 'SIGKILL')` each (swallow `ESRCH` — already gone). Carrier: extend `DrainState` (`drain-state.ts:9`) with `agentPgids: number[]`, populated by `emitState` in `drain-loop.ts:135` from a live set of in-flight gate-child pgids. This runs right after `acquireLock` reclaims (the orphans don't hold the lock — the dead parent did), before the new run's first `emitState` overwrites the file.

### Unit 3 — `reconcileOpenPrs(cwd, source, deps)` — open-PR healing
`gh pr list --state open --json number,headRefName,mergeStateStatus,mergedAt,state`, filter heads to the source's branch namespace (head ↔ slug via stripping the `fast/`/`feat/` prefix that `source.branchFor` adds), then per PR reuse `classifyMergeView` (`drain-io.ts:30`):
- `merged` → nothing (oracle already advanced).
- `merge-conflict` (DIRTY/CONFLICTING) → `gh pr close <branch>`; leave the branch so the next run's `salvageStaleBase` → `detectStale` (`salvage.ts:23`) sees `closed-unmerged-pr` + `orphan-remote-branch` and `repair`s the base → rebuild. Closing IS the rebuild flag — no new park reason needed.
- `pending`/CLEAN → call `mergePr` (`drain-io.ts:46`) with a short bounded `pollTimeoutMs` (D6); on `merged` advance via `source.parseAll()`; on non-merge leave it (the worker's open-PR guard / next iteration re-observes it).

### Unit 4 — `pruneShippedWorktrees(cwd, universe)` — shipped-worktree GC — `src/autonomous/drain-io.ts`
`git worktree list --porcelain`, parse each `worktree .worktrees/<slug>` on branch `fast/<slug>`. If `<slug>` is absent from `source.parseAll()` (already shipped/retired) → `git worktree remove --force .worktrees/<slug>` + `git branch -D fast/<slug>` (reusing `salvage.ts` `repair`'s exact commands, sans the remote delete). The shipped-guard is what makes this safe where `syncMainCleanState` was forced to refuse — a still-in-universe slug or a non-`fast/*` worktree is never touched.

### Unit 5 — `assertQueueSourceSynced(cwd)` — pre-flight divergence guard — `src/autonomous/drain-io.ts`
After `syncMainCleanState` (which catches *behind*) and before the first spawn: `git rev-list --count origin/main..HEAD`. `> 0` → local `main` is ahead of `origin` (un-pushed commit) → throw a loud error naming the offending commits (`git log --oneline origin/main..HEAD`). `main()` catches → exit 1 with the message, *before* any gate child wastes work.

### Unit 6 — process-group spawn + group-kill — `src/core/agent-runner/registry.ts`
Spawn with `detached: true` so the child is its own group leader (`pgid === child.pid`). On timeout, replace `child.kill('SIGKILL')` (`registry.ts:134`) with `process.kill(-child.pid, 'SIGKILL')` (whole group). Add `opts.onSpawn?(pgid)` called synchronously post-spawn so `spawnGate`'s wrapper (`drain-io.ts:151`) can register the pgid into the drain-loop's live set (carrier for Unit 2) and deregister on `close`. Runner-level: in `queue-drain.ts` extend the existing SIGINT handler (`queue-drain.ts:119`) and add SIGTERM to group-kill all live pgids on the way out (best-effort; the startup reap is the backstop for SIGKILL, which runs no handler).

### Wiring
`queue-drain.ts` `main()`: `acquireLock` → `reapOrphanAgents` → `syncMainCleanState` → `assertQueueSourceSynced` → `reconcileOpenPrs` → `pruneShippedWorktrees` → `runDrain`. `DrainDeps`/`ReconcileDeps` gain the new injected adapters so the orchestration stays unit-testable against mocks (as `run-drain.test.ts` does today).

## Acceptance criteria

- Startup with no prior dead run → `reconcileDeadRun` returns an empty report and makes zero `gh pr close` / `worktree remove` / `kill` calls (idempotent no-op), test-verified.
- A seeded open CLEAN `fast/<slug>` PR for an in-universe slug → reconcile merges it (via `mergePr`) and the slug leaves `source.parseAll()`; report lists it under `merged`.
- A seeded open DIRTY PR → reconcile calls `gh pr close <branch>`, leaves the branch, and the slug is reported under `closedDirty`; a subsequent drain's `salvageStaleBase` detects `closed-unmerged-pr` and rebuilds (covered by existing `salvage` tests + a new reconcile test).
- A `.worktrees/<slug>` on `fast/<slug>` whose slug is absent from the universe → removed + branch deleted; a still-in-universe slug's worktree and any non-`fast/*` worktree → untouched.
- A prior `drain-state.json` with a dead `pid` and `agentPgids: [N]` → `reapOrphanAgents` issues `process.kill(-N, 'SIGKILL')`; a live-pid state → no kill (test via injected kill spy).
- `assertQueueSourceSynced` throws (→ exit 1, loud message with the commit list) when `git rev-list --count origin/main..HEAD > 0`; passes silently when `== 0`.
- `spawnAgent` spawns with `detached: true`; the timeout path group-kills (`process.kill(-pgid, …)`), verified against the injected `spawnImpl` mock in the agent-runner tests.
- `pnpm typecheck` + existing `drain-lock` / `drain-state` / `run-drain` / `salvage` suites stay green.

## Risks / trade-offs

- **`process.kill(-pgid)` portability.** Negative-pid group kill is POSIX (darwin/Linux OK); the carrier records a real group only because of `detached: true`. Guard the `kill` in try/catch (ESRCH/EPERM) so a reused-pid or permission edge can't crash startup.
- **Reused pgid hazard.** A dead run's pgid may have been recycled by an unrelated process. Mitigation: only reap when the recorded *parent* `pid` is confirmed dead AND the state file is the prior run's (not this run's, which hasn't written yet); accept residual risk as best-effort (same posture as lock reclaim).
- **Auto-merging during reconcile** lands code from a dead run the operator never watched complete. Mitigation: only CLEAN PRs (all required checks green via `classifyMergeView`), bounded poll (D6); a DIRTY/pending PR is never merged blind.
- **`gh` rate / latency** for the open-PR list at startup. One `gh pr list` call, namespace-filtered client-side — cheap.

## User Story

As an operator re-running a drain after a prior one crashed or was killed mid-flight, I want the new run to automatically reconcile the dead run's leftovers — merge its clean open PRs, close + flag its dirty ones for rebuild, prune its orphaned shipped worktrees, reap its orphan agent processes, and refuse to start loud if local `main` is ahead of `origin` — so that the drain is crash-recoverable and I stop hand-cleaning the same mess every restart.

## Usage

**CLI**

1. Re-run as normal: `pnpm noldor autonomous queue-drain` (or `watch`). Reconciliation runs automatically at startup — no new flag.
2. Reconcile actions print before the drain begins, e.g. `reconcile: merged 1, closed-dirty 1 [foo], pruned 2 worktrees, reaped 1 orphan agent`; the same fields appear in the `--json` summary under a `reconcile` key.
3. If local `main` is ahead of `origin`, the run aborts (exit 1) before spawning: `drain: local main is ahead of origin/main by N commit(s) — push or reset before draining:` followed by the offending `git log --oneline` lines.
4. `--dry-run` reports what reconcile *would* do (merge/close/prune/reap) without acting, alongside the existing FIFO ship plan.

**Agent API** — none. Reconciliation is internal to the runner startup path.

**Exit codes** — unchanged from the parent FD (`0` / `1` / `130`); `assertQueueSourceSynced` failure surfaces as the existing `1` (git-sync abort) class.

## Open questions (resolved)

1. *DIRTY open PR — close-and-rebuild, or park for a human?*
   -> **Close + let the next run's `salvageStaleBase` rebuild it.** The drain already knows how to rebuild a `closed-unmerged-pr` base; parking would stall an automatable case, and the existing retry/skip caps backstop a repeatedly-failing rebuild (D1).
2. *Local-`main`-ahead-of-origin — abort loud, or auto-push?*
   -> **Abort loud (exit 1) with the commit list.** Auto-pushing an un-reviewed (likely triage) commit from a headless runner is unsafe; surfacing lets the operator push or reset deliberately (D2).
3. *Where do orphan agent pgids live across the parent's death?*
   -> **In `.noldor/drain-state.json` (`agentPgids`).** It is already the per-run heartbeat carrying the runner `pid`; reuse it rather than widen the lock payload, which is a one-shot mutex written only at acquire (D3).
4. *How are orphans actually killed?*
   -> **`detached: true` spawn + `process.kill(-pgid, 'SIGKILL')`**, applied on timeout, on runner SIGTERM/SIGINT, and as a startup reap backstop for SIGKILL (which runs no handler) (D4).
5. *Does reconcile cover `--source plans` (`feat/<slug>`) too?*
   -> **Yes — source-agnostic via `source.branchFor` namespace.** The same dead-run mess (open feat PRs, orphan worktrees) applies to the plans source; deriving the namespace from the source keeps one code path (D5).
6. *Reconcile-time CLEAN merge — reuse `mergePr`'s full 20-min poll?*
   -> **Reuse `mergePr` but pass a short bounded `pollTimeoutMs` (~60–90s).** Reconcile must not hang minutes on a stuck PR; a non-merge within the window is simply left for the worker's open-PR guard / next iteration to re-observe (D6).
