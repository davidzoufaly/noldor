---
area: tooling
category: Tooling
deps:
  - autonomous-plan-to-pr-merge
links:
  code:
    - src/autonomous/queue-drain.ts
    - src/autonomous/drain-loop.ts
    - src/autonomous/drain-eligibility.ts
    - src/autonomous/drain-lock.ts
    - src/autonomous/drain-state.ts
    - src/autonomous/drain-io.ts
    - src/core/next-priority.ts
    - src/cli/manifest.ts
    - .claude/skills/noldor-gate/SKILL.md
  tests:
    - src/autonomous/__tests__/build-pool.test.ts
    - src/autonomous/__tests__/decide-next.test.ts
    - src/autonomous/__tests__/drain-eligibility.test.ts
    - src/autonomous/__tests__/drain-lock.test.ts
    - src/autonomous/__tests__/drain-reconcile.test.ts
    - src/autonomous/__tests__/drain-state.test.ts
    - src/autonomous/__tests__/escalations.test.ts
    - src/autonomous/__tests__/merge-classify.test.ts
    - src/autonomous/__tests__/merge-coordinator.test.ts
    - src/autonomous/__tests__/queue-drain-cli.test.ts
    - src/autonomous/__tests__/run-drain.test.ts
    - src/autonomous/__tests__/status-cli.test.ts
    - src/autonomous/__tests__/watch-state.test.ts
    - src/core/__tests__/next-priority.test.ts
    - src/testing/__tests__/drain-e2e.test.ts
  spec: >-
    docs/superpowers/specs/archive/2026-06-10-autonomous-queue-drain-runner-design.md
name: Autonomous Queue-Drain Runner
packages:
  - scripts
phase: done
noldor-tier: full
introduced: 0.3.0
---
## Summary

An external supervisor that drains the roadmap's fast-track (XS/S) queue autonomously — spawning a fresh `claude --print "/noldor-gate --drain <slug>"` per entry, one auto-merged PR at a time, with retry-then-skip, a concurrency lock, and a per-iteration timeout. Each feature runs in a clean context, so always-clear is preserved without a human between features.

## User Story

As an operator with a backlog of small (XS/S) roadmap entries, I want one command that ships them autonomously — one auto-merged PR at a time, each in a fresh always-cleared `claude --print` context — so that I can drain the fast-track queue without sitting between every feature to `/clear` and re-run `/noldor-gate`.

## Usage

**CLI**

1. Ensure `.noldor/config.json` sets `autonomous: { "onFailure": "abort", "skipLanePicker": true, "requireHumanPrApproval": false }` — the drain refuses to start otherwise (headless-safe precondition).
2. From the main workspace on a clean, synced `main`, run `pnpm noldor autonomous queue-drain`.
3. Preview without spawning or merging anything: `--dry-run`. Tune with `--max-features N` (default 20), `--max-retries N` (default 2), `--iteration-timeout MS` (default 30 min). Add `--json` for a machine-readable summary.
4. The runner ships each fast-track (XS/S) roadmap entry as its own auto-merged PR, skipping M/L/XL and `Touches:`/multi-scope entries, until the queue is drained, all-remaining are skipped, or `--max-features` is hit.
5. Stop cleanly between iterations with SIGINT (Ctrl-C) or `touch .noldor/drain-stop` (exit 130).

**Agent API**

- None. The runner is the agent driver — it spawns `NOLDOR_DRAIN=1 claude --print "/noldor-gate --drain <slug>"` per entry; there is no in-editor API surface.

**Exit codes**

- `0` completed (drained / all-skipped / `--max-features` reached) · `1` aborted on error (config/lock/parse/`gh`/git-sync) · `130` stopped via kill switch.

## Verification

**Headless-flag spike (done).** `claude --help` confirms the flags the supervisor relies on:
`-p/--print`, `--disallowed-tools <tools…>` (used to deny `AskUserQuestion` as a code-level prompt
kill-switch), and `--permission-mode bypassPermissions` (so `git`/`gh`/`pnpm`/Edit run unattended).
These are wired in [`src/autonomous/drain-io.ts`](../../src/autonomous/drain-io.ts) `spawnGate`.

**Still to verify by a live integration run (not yet exercised — no real drain has shipped a PR):**
that `claude --print "/noldor-gate --drain <slug>"` resolves the `/noldor-gate` *skill* in print mode (vs treating the string as a
literal prompt) and that Ctrl-C propagates SIGINT to the spawned child. Runbook: on a scratch branch,
seed `docs/roadmap.md` with one standalone XS/S entry, set the `autonomous` config block
(`onFailure: "abort"`, `skipLanePicker: true`, `requireHumanPrApproval: false`), run
`pnpm noldor autonomous queue-drain --max-features 1`, and confirm the entry is retired from `main` via
a merged PR (not merely a clean child exit).

## PRs

<!-- @prs-since-last-release: autonomous-queue-drain-runner -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-06-10-autonomous-queue-drain-runner-design.md`](../../docs/superpowers/specs/archive/2026-06-10-autonomous-queue-drain-runner-design.md)
- **Code:**
  - [`src/autonomous/queue-drain.ts`](../../src/autonomous/queue-drain.ts)
  - [`src/autonomous/drain-loop.ts`](../../src/autonomous/drain-loop.ts)
  - [`src/autonomous/drain-eligibility.ts`](../../src/autonomous/drain-eligibility.ts)
  - [`src/autonomous/drain-lock.ts`](../../src/autonomous/drain-lock.ts)
  - [`src/autonomous/drain-state.ts`](../../src/autonomous/drain-state.ts)
  - [`src/autonomous/drain-io.ts`](../../src/autonomous/drain-io.ts)
  - [`src/core/next-priority.ts`](../../src/core/next-priority.ts)
  - [`src/cli/manifest.ts`](../../src/cli/manifest.ts)
  - [`.claude/skills/noldor-gate/SKILL.md`](../../.claude/skills/noldor-gate/SKILL.md)
- **Tests:**
  - [`src/autonomous/__tests__/build-pool.test.ts`](../../src/autonomous/__tests__/build-pool.test.ts)
  - [`src/autonomous/__tests__/decide-next.test.ts`](../../src/autonomous/__tests__/decide-next.test.ts)
  - [`src/autonomous/__tests__/drain-eligibility.test.ts`](../../src/autonomous/__tests__/drain-eligibility.test.ts)
  - [`src/autonomous/__tests__/drain-lock.test.ts`](../../src/autonomous/__tests__/drain-lock.test.ts)
  - [`src/autonomous/__tests__/drain-reconcile.test.ts`](../../src/autonomous/__tests__/drain-reconcile.test.ts)
  - [`src/autonomous/__tests__/drain-state.test.ts`](../../src/autonomous/__tests__/drain-state.test.ts)
  - [`src/autonomous/__tests__/escalations.test.ts`](../../src/autonomous/__tests__/escalations.test.ts)
  - [`src/autonomous/__tests__/merge-classify.test.ts`](../../src/autonomous/__tests__/merge-classify.test.ts)
  - [`src/autonomous/__tests__/merge-coordinator.test.ts`](../../src/autonomous/__tests__/merge-coordinator.test.ts)
  - [`src/autonomous/__tests__/queue-drain-cli.test.ts`](../../src/autonomous/__tests__/queue-drain-cli.test.ts)
  - [`src/autonomous/__tests__/run-drain.test.ts`](../../src/autonomous/__tests__/run-drain.test.ts)
  - [`src/autonomous/__tests__/watch-state.test.ts`](../../src/autonomous/__tests__/watch-state.test.ts)
  - [`src/core/__tests__/next-priority.test.ts`](../../src/core/__tests__/next-priority.test.ts)
  - [`src/testing/__tests__/drain-e2e.test.ts`](../../src/testing/__tests__/drain-e2e.test.ts)

<!-- /generated: resources -->
