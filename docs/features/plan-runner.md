---
area: tooling
category: Tooling
deps:
  - autonomous-queue-drain-runner
links:
  code:
    - src/autonomous/drain-source.ts
    - src/autonomous/drain-loop.ts
    - src/autonomous/drain-io.ts
    - src/autonomous/queue-drain.ts
    - src/cli/manifest.ts
    - .claude/skills/noldor-gate/SKILL.md
    - src/prep/prep-fanout.ts
    - src/prep/prep-promote.ts
    - src/prep/discover.ts
    - src/prep/draft.ts
    - src/prep/scaffold.ts
    - src/prep/staging.ts
    - src/prep/index-doc.ts
    - src/prep/spawn.ts
    - src/prep/types.ts
  tests:
    - src/autonomous/__tests__/build-pool.test.ts
    - src/autonomous/__tests__/decide-next.test.ts
    - src/autonomous/__tests__/drain-reconcile.test.ts
    - src/autonomous/__tests__/drain-source.test.ts
    - src/autonomous/__tests__/escalations.test.ts
    - src/autonomous/__tests__/merge-classify.test.ts
    - src/autonomous/__tests__/merge-coordinator.test.ts
    - src/autonomous/__tests__/queue-drain-cli.test.ts
    - src/autonomous/__tests__/run-drain.test.ts
    - src/autonomous/__tests__/watch-state.test.ts
    - src/prep/__tests__/discover.test.ts
    - src/prep/__tests__/formats.test.ts
    - src/prep/__tests__/index-doc.test.ts
    - src/prep/__tests__/prep-promote.test.ts
    - src/prep/__tests__/scaffold.test.ts
    - src/prep/__tests__/staging.test.ts
  spec: docs/design/specs/archive/2026-06-10-plan-runner-design.md
name: Plan-Runner — Autonomous Plan Executor
packages:
  - scripts
phase: done
noldor-tier: full
introduced: 0.3.0
---

## Summary

The execution end of the autonomous-design pipeline. Generalizes the shipped queue-drain supervisor with an injected `DrainSource` seam (`src/autonomous/drain-source.ts`) so the loop is source-agnostic: `roadmapSource` reproduces queue-drain byte-for-byte (fast-track XS/S roadmap entries), while the new `plansSource` drains already-designed in-progress FDs (spec **and** plan committed) — taking on the M/L/XL work queue-drain refuses, one auto-merged `feat/<slug>` PR at a time, always-clear preserved. Exposed as `pnpm noldor autonomous run --source roadmap|plans`, with `queue-drain` retained as a `--source roadmap` alias. The authoring end of the same pipeline — the `prep` CLI (`noldor prep fanout` drafts specs+plans, `noldor prep promote` produces the in-progress FDs plan-runner consumes) — ships under this FD as the feeder. `--source specs` is reserved for phase 2 (needs an autonomous `writing-plans` step).

## User Story

As an operator (human or agent) with a stack of already-designed in-progress FDs — each carrying a CR-approved spec **and** plan — I want one command, `pnpm noldor autonomous run --source plans`, that resumes and ships them autonomously, one auto-merged PR at a time in a fresh always-cleared context, so that I drain my designed backlog without sitting at every feature to `/noldor-gate --resume` and `/clear` between them.

## Usage

**CLI**

1. Ensure each in-progress FD you want shipped has a committed spec (`docs/design/specs/*-<slug>-design.md`) and plan (`docs/design/plans/*-<slug>.md`) — the output of `noldor prep fanout` + `noldor prep promote`.
2. Ensure `.noldor/config.json` sets `autonomous: { "onFailure": "abort", "skipLanePicker": true, "requireHumanPrApproval": false }` (same precondition as queue-drain; the runner refuses to start otherwise).
3. From a clean, synced `main`, preview: `pnpm noldor autonomous run --source plans --dry-run` (lists eligible FDs in FIFO plan-age order, plus skip reasons).
4. Run live: `pnpm noldor autonomous run --source plans`. Tune with `--max-features N` (default 20), `--max-retries N` (default 2), `--iteration-timeout MS` (default 30 min); add `--json` for a machine summary.
5. Stop cleanly between iterations with SIGINT (Ctrl-C) or `touch .noldor/drain-stop` (exit 130).

**Aliases / sources**

- `pnpm noldor autonomous queue-drain` == `autonomous run --source roadmap` (fast-track XS/S roadmap entries — the shipped behavior).
- `--source specs` is reserved (phase 2) and currently exits 1.

**Exit codes**

- `0` completed (drained / all-skipped / `--max-features` reached) · `1` aborted (config/lock/parse/`gh`/git-sync, or `--source specs`) · `130` stopped via kill switch.

## PRs

<!-- @prs-since-last-release: plan-runner -->

## Changelog

### Initial Release (v0.3.0)

#### Summary

Release-notes prose (write normal — doc artifact):

This release adds a parallel prep pipeline to the noldor CLI, introducing fanout drafts together with a promote bridge (#30).

#### PRs

- #30: parallel prep pipeline — fanout drafts + promote bridge as noldor CLI ([link](https://github.com/davidzoufaly/noldor/pull/30))

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/archive/2026-06-10-plan-runner-design.md`](../../docs/design/specs/archive/2026-06-10-plan-runner-design.md)
- **Code:**
  - [`src/autonomous/drain-source.ts`](../../src/autonomous/drain-source.ts)
  - [`src/autonomous/drain-loop.ts`](../../src/autonomous/drain-loop.ts)
  - [`src/autonomous/drain-io.ts`](../../src/autonomous/drain-io.ts)
  - [`src/autonomous/queue-drain.ts`](../../src/autonomous/queue-drain.ts)
  - [`src/cli/manifest.ts`](../../src/cli/manifest.ts)
  - [`.claude/skills/noldor-gate/SKILL.md`](../../.claude/skills/noldor-gate/SKILL.md)
  - [`src/prep/prep-fanout.ts`](../../src/prep/prep-fanout.ts)
  - [`src/prep/prep-promote.ts`](../../src/prep/prep-promote.ts)
  - [`src/prep/discover.ts`](../../src/prep/discover.ts)
  - [`src/prep/draft.ts`](../../src/prep/draft.ts)
  - [`src/prep/scaffold.ts`](../../src/prep/scaffold.ts)
  - [`src/prep/staging.ts`](../../src/prep/staging.ts)
  - [`src/prep/index-doc.ts`](../../src/prep/index-doc.ts)
  - [`src/prep/spawn.ts`](../../src/prep/spawn.ts)
  - [`src/prep/types.ts`](../../src/prep/types.ts)
- **Tests:**
  - [`src/autonomous/__tests__/build-pool.test.ts`](../../src/autonomous/__tests__/build-pool.test.ts)
  - [`src/autonomous/__tests__/decide-next.test.ts`](../../src/autonomous/__tests__/decide-next.test.ts)
  - [`src/autonomous/__tests__/drain-reconcile.test.ts`](../../src/autonomous/__tests__/drain-reconcile.test.ts)
  - [`src/autonomous/__tests__/drain-source.test.ts`](../../src/autonomous/__tests__/drain-source.test.ts)
  - [`src/autonomous/__tests__/escalations.test.ts`](../../src/autonomous/__tests__/escalations.test.ts)
  - [`src/autonomous/__tests__/merge-classify.test.ts`](../../src/autonomous/__tests__/merge-classify.test.ts)
  - [`src/autonomous/__tests__/merge-coordinator.test.ts`](../../src/autonomous/__tests__/merge-coordinator.test.ts)
  - [`src/autonomous/__tests__/queue-drain-cli.test.ts`](../../src/autonomous/__tests__/queue-drain-cli.test.ts)
  - [`src/autonomous/__tests__/run-drain.test.ts`](../../src/autonomous/__tests__/run-drain.test.ts)
  - [`src/autonomous/__tests__/watch-state.test.ts`](../../src/autonomous/__tests__/watch-state.test.ts)
  - [`src/prep/__tests__/discover.test.ts`](../../src/prep/__tests__/discover.test.ts)
  - [`src/prep/__tests__/formats.test.ts`](../../src/prep/__tests__/formats.test.ts)
  - [`src/prep/__tests__/index-doc.test.ts`](../../src/prep/__tests__/index-doc.test.ts)
  - [`src/prep/__tests__/prep-promote.test.ts`](../../src/prep/__tests__/prep-promote.test.ts)
  - [`src/prep/__tests__/scaffold.test.ts`](../../src/prep/__tests__/scaffold.test.ts)
  - [`src/prep/__tests__/staging.test.ts`](../../src/prep/__tests__/staging.test.ts)

<!-- /generated: resources -->
