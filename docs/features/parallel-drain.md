---
area: tooling
category: Tooling
deps:
  - autonomous-queue-drain-runner
links:
  code:
    - src/autonomous/drain-loop.ts
    - src/autonomous/drain-io.ts
    - src/autonomous/queue-drain.ts
    - src/autonomous/drain-state.ts
    - src/core/pr-flow.ts
    - src/core/pr-flow-cli.ts
    - .claude/skills/gate/SKILL.md
  tests:
    - src/autonomous/__tests__/run-drain.test.ts
    - src/autonomous/__tests__/build-pool.test.ts
    - src/autonomous/__tests__/merge-coordinator.test.ts
    - src/autonomous/__tests__/merge-classify.test.ts
    - src/autonomous/__tests__/queue-drain-cli.test.ts
    - src/core/__tests__/pr-flow.test.ts
  spec: docs/superpowers/specs/archive/2026-06-10-parallel-drain-design.md
name: Parallel Drain
packages:
  - scripts
phase: done
noldor-tier: full
introduced: 0.3.0
---
## Summary

Generalizes the autonomous drain supervisor from sequential (one feature at a time) to K-concurrent via `--concurrency N`: up to N features build in parallel, each in its own worktree and its own PR, while merges are serialized through a single coordinator so `main` never sees an N-way conflict. `--concurrency 1` (default) is byte-for-byte today's sequential drain; concurrency is opt-in.

## User Story

As an operator draining a large queue (or a batch of designed plans), I want `--concurrency N` so that N features build in parallel — each isolated in its own worktree, each its own auto-merged PR — while merges serialize safely onto `main`, so that I drain the queue in roughly queue-size/N wall-clock instead of sequentially, without giving up per-feature review or risking an N-way merge.

## Usage

**CLI**

1. Precondition (same as sequential queue-drain): `.noldor/config.json` has `autonomous.onFailure: 'abort'`, `skipLanePicker: true`, `requireHumanPrApproval: false`, and `main` is clean + synced.
2. Run from a clean `main`: `pnpm noldor autonomous queue-drain --concurrency 3` (or `autonomous run --source plans --concurrency 3` for the plan-runner source).
3. `--concurrency 1` (default) reproduces today's sequential drain. Combine with `--max-features`, `--max-retries`, `--iteration-timeout`, `--dry-run`, `--json`.
4. Preferred: enable the GitHub merge queue on `main` first; otherwise the supervisor serializes merges itself via `gh pr merge`.
5. Stop with SIGINT or `touch .noldor/drain-stop` — in-flight builds finish, the merge lane drains, then the process exits 130.

**Exit codes**

- `0` — drained / all-skipped / cap reached
- `1` — aborted (config / lock / systemic spawn or git failure)
- `130` — stopped via kill switch

## PRs

<!-- @prs-since-last-release: parallel-drain -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-06-10-parallel-drain-design.md`](../../docs/superpowers/specs/archive/2026-06-10-parallel-drain-design.md)
- **Code:**
  - [`src/autonomous/drain-loop.ts`](../../src/autonomous/drain-loop.ts)
  - [`src/autonomous/drain-io.ts`](../../src/autonomous/drain-io.ts)
  - [`src/autonomous/queue-drain.ts`](../../src/autonomous/queue-drain.ts)
  - [`src/autonomous/drain-state.ts`](../../src/autonomous/drain-state.ts)
  - [`src/core/pr-flow.ts`](../../src/core/pr-flow.ts)
  - [`src/core/pr-flow-cli.ts`](../../src/core/pr-flow-cli.ts)
  - [`.claude/skills/gate/SKILL.md`](../../.claude/skills/gate/SKILL.md)
- **Tests:**
  - [`src/autonomous/__tests__/run-drain.test.ts`](../../src/autonomous/__tests__/run-drain.test.ts)
  - [`src/autonomous/__tests__/build-pool.test.ts`](../../src/autonomous/__tests__/build-pool.test.ts)
  - [`src/autonomous/__tests__/merge-coordinator.test.ts`](../../src/autonomous/__tests__/merge-coordinator.test.ts)
  - [`src/autonomous/__tests__/merge-classify.test.ts`](../../src/autonomous/__tests__/merge-classify.test.ts)
  - [`src/autonomous/__tests__/queue-drain-cli.test.ts`](../../src/autonomous/__tests__/queue-drain-cli.test.ts)
  - [`src/core/__tests__/pr-flow.test.ts`](../../src/core/__tests__/pr-flow.test.ts)

<!-- /generated: resources -->
