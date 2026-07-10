---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/autonomous/drain-reconcile.ts
    - src/autonomous/queue-drain.ts
    - src/autonomous/drain-io.ts
    - src/autonomous/drain-lock.ts
    - src/autonomous/drain-state.ts
    - src/autonomous/drain-loop.ts
    - src/core/agent-runner/registry.ts
    - src/core/agent-runner/types.ts
  docs: []
  tests:
    - src/autonomous/__tests__/build-pool.test.ts
    - src/autonomous/__tests__/decide-next.test.ts
    - src/autonomous/__tests__/drain-lock.test.ts
    - src/autonomous/__tests__/drain-reconcile.test.ts
    - src/autonomous/__tests__/drain-state.test.ts
    - src/autonomous/__tests__/escalations.test.ts
    - src/autonomous/__tests__/merge-classify.test.ts
    - src/autonomous/__tests__/merge-coordinator.test.ts
    - src/autonomous/__tests__/queue-drain-cli.test.ts
    - src/autonomous/__tests__/run-drain.test.ts
    - src/autonomous/__tests__/watch-state.test.ts
    - src/core/agent-runner/__tests__/doctor-runners.test.ts
    - src/core/agent-runner/__tests__/registry.test.ts
    - src/core/agent-runner/__tests__/types.test.ts
    - src/testing/__tests__/consumer-fixture.test.ts
    - src/testing/__tests__/drain-e2e.test.ts
    - src/testing/__tests__/stub-runner.test.ts
  spec: >-
    docs/superpowers/specs/archive/2026-06-14-drain-startup-reconciliation-of-a-prior-dead-run-design.md
name: Drain Startup Reconciliation of a Prior Dead Run
packages:
  - scripts
phase: done
noldor-tier: specs-only
introduced: 0.4.0
---

## Summary

When a drain dies mid-run (session pause / crash / SIGKILL) it leaves orphaned `fast/<slug>` worktrees, leftover branches, open PRs (clean *and* DIRTY), and a stale `.noldor/drain.lock`. Today a fresh drain does not reconcile these — the operator must manually merge clean open PRs, close/rebuild DIRTY ones, prune worktrees, and clear the stale lock (done by hand 3× in one session). Add a startup reconciliation pass: for each in-roadmap slug with an open PR, merge it when CLEAN (advance the oracle) or close + flag-for-rebuild when DIRTY; `git worktree prune` + remove orphaned `fast/*` worktrees whose slug is already shipped; reclaim a stale lock whose pid is dead. Makes the drain crash-recoverable instead of leaving a mess. - Add a startup sync-check: an un-pushed local-`main`-ahead-of-`origin` commit (e.g. a triage commit on local main but not origin) blocks the whole drain — but only *after* the gate already did the work and tries to retire the entry. Pre-flight `origin/main == queue-source` before spawning the first gate, and surface the divergence loudly instead of failing deep.
- Orphan agent children survive runner SIGTERM: killing the parent (`autonomous run`/`watch`) leaves the spawned `claude --print /noldor-gate` child running and holding context. Spawn the agent in its own process group and kill the group on runner death; at startup, reconcile (kill) any dead-run agent children before acquiring the lock.

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

## PRs

<!-- @prs-since-last-release: drain-startup-reconciliation-of-a-prior-dead-run -->

## Changelog

### Initial Release (v0.4.0)

#### Summary

Reconcile a prior dead drain run at startup (#107).

#### PRs

- #107: reconcile a prior dead drain run at startup ([link](https://github.com/davidzoufaly/noldor/pull/107))

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-06-14-drain-startup-reconciliation-of-a-prior-dead-run-design.md`](../../docs/superpowers/specs/archive/2026-06-14-drain-startup-reconciliation-of-a-prior-dead-run-design.md)
- **Code:**
  - [`src/autonomous/drain-reconcile.ts`](../../src/autonomous/drain-reconcile.ts)
  - [`src/autonomous/queue-drain.ts`](../../src/autonomous/queue-drain.ts)
  - [`src/autonomous/drain-io.ts`](../../src/autonomous/drain-io.ts)
  - [`src/autonomous/drain-lock.ts`](../../src/autonomous/drain-lock.ts)
  - [`src/autonomous/drain-state.ts`](../../src/autonomous/drain-state.ts)
  - [`src/autonomous/drain-loop.ts`](../../src/autonomous/drain-loop.ts)
  - [`src/core/agent-runner/registry.ts`](../../src/core/agent-runner/registry.ts)
  - [`src/core/agent-runner/types.ts`](../../src/core/agent-runner/types.ts)
- **Tests:**
  - [`src/autonomous/__tests__/build-pool.test.ts`](../../src/autonomous/__tests__/build-pool.test.ts)
  - [`src/autonomous/__tests__/decide-next.test.ts`](../../src/autonomous/__tests__/decide-next.test.ts)
  - [`src/autonomous/__tests__/drain-lock.test.ts`](../../src/autonomous/__tests__/drain-lock.test.ts)
  - [`src/autonomous/__tests__/drain-reconcile.test.ts`](../../src/autonomous/__tests__/drain-reconcile.test.ts)
  - [`src/autonomous/__tests__/drain-state.test.ts`](../../src/autonomous/__tests__/drain-state.test.ts)
  - [`src/autonomous/__tests__/escalations.test.ts`](../../src/autonomous/__tests__/escalations.test.ts)
  - [`src/autonomous/__tests__/merge-classify.test.ts`](../../src/autonomous/__tests__/merge-classify.test.ts)
  - [`src/autonomous/__tests__/merge-coordinator.test.ts`](../../src/autonomous/__tests__/merge-coordinator.test.ts)
  - [`src/autonomous/__tests__/queue-drain-cli.test.ts`](../../src/autonomous/__tests__/queue-drain-cli.test.ts)
  - [`src/autonomous/__tests__/run-drain.test.ts`](../../src/autonomous/__tests__/run-drain.test.ts)
  - [`src/autonomous/__tests__/watch-state.test.ts`](../../src/autonomous/__tests__/watch-state.test.ts)
  - [`src/core/agent-runner/__tests__/doctor-runners.test.ts`](../../src/core/agent-runner/__tests__/doctor-runners.test.ts)
  - [`src/core/agent-runner/__tests__/registry.test.ts`](../../src/core/agent-runner/__tests__/registry.test.ts)
  - [`src/core/agent-runner/__tests__/types.test.ts`](../../src/core/agent-runner/__tests__/types.test.ts)
  - [`src/testing/__tests__/consumer-fixture.test.ts`](../../src/testing/__tests__/consumer-fixture.test.ts)
  - [`src/testing/__tests__/drain-e2e.test.ts`](../../src/testing/__tests__/drain-e2e.test.ts)
  - [`src/testing/__tests__/stub-runner.test.ts`](../../src/testing/__tests__/stub-runner.test.ts)

<!-- /generated: resources -->
