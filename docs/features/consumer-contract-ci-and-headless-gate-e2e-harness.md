---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/testing/fixtures
    - src/testing/consumer-fixture.ts
    - src/testing/contract-harness.ts
    - src/testing/stub-gate.ts
    - src/autonomous/
    - docs/noldor/testing-principles.md
    - docs/noldor/script-catalog.md
  docs: []
  tests:
    - src/autonomous/__tests__/build-pool.test.ts
    - src/autonomous/__tests__/decide-next.test.ts
    - src/autonomous/__tests__/drain-eligibility.test.ts
    - src/autonomous/__tests__/drain-lock.test.ts
    - src/autonomous/__tests__/drain-reconcile.test.ts
    - src/autonomous/__tests__/drain-source.test.ts
    - src/autonomous/__tests__/drain-state.test.ts
    - src/autonomous/__tests__/escalations.test.ts
    - src/autonomous/__tests__/merge-classify.test.ts
    - src/autonomous/__tests__/merge-coordinator.test.ts
    - src/autonomous/__tests__/notify.test.ts
    - src/autonomous/__tests__/queue-drain-cli.test.ts
    - src/autonomous/__tests__/resolve-roadmap-conflict.test.ts
    - src/autonomous/__tests__/run-drain.test.ts
    - src/autonomous/__tests__/salvage.test.ts
    - src/autonomous/__tests__/watch-args.test.ts
    - src/autonomous/__tests__/watch-detach.test.ts
    - src/autonomous/__tests__/watch-state.test.ts
    - src/testing/__tests__/consumer-fixture.test.ts
    - src/testing/__tests__/contract-harness.test.ts
    - src/testing/__tests__/drain-e2e.test.ts
    - src/testing/__tests__/stub-runner.test.ts
  spec: >-
    docs/superpowers/specs/archive/2026-06-13-consumer-contract-ci-and-headless-gate-e2e-harness-design.md
  plan: >-
    docs/superpowers/plans/archive/2026-06-13-consumer-contract-ci-and-headless-gate-e2e-harness.md
name: Consumer-Contract CI and Headless Gate E2E Harness
packages:
  - scripts
phase: done
noldor-tier: full
introduced: 0.4.0
---

## Summary

164 unit-test files, zero end-to-end coverage of the flows autonomy actually depends on: the skill-markdown gate paths, drain loop against a real repo, init/upgrade against a real consumer tree. The PR #33 bug class (headless gate silently ignoring env-only signals) lived exactly in this blind spot and shipped broken. Build one harness that covers both needs: a fixture consumer repo as the *contract*, and headless skill-flow runs as the *e2e layer*.

**What to do:**

- Fixture consumer: a minimal single-package TS app (`fixtures/consumer/` in-repo, or generated into a temp dir by a builder script — temp-dir generation avoids fixture rot and `.git`-in-`.git` issues; lean that way). Contains: `.noldor/config.json`, a tiny `src/`, `docs/` skeleton with vision/roadmap/ideas, one seeded roadmap entry sized XS, lefthook wired. A builder util makes it a real git repo with an initial commit.
- Contract layer: CI job — install framework *from the working tree* into the fixture (`pnpm pack` + install tarball), run `noldor init`, `noldor doctor`, `noldor validate features`, `noldor garden detect`. Assert exit codes + key artifacts. Any framework PR that breaks this fails before merge — consumers are protected without being in the loop.
- Headless flow layer: drive real flows non-interactively and assert *outcomes*, not transcripts:
  - drain a seeded XS roadmap entry: `noldor autonomous run --source roadmap --max-features 1` → assert roadmap entry retired, commit carries `Noldor-Path: fast-track` + `Noldor-Reviewed-*` trailers, branch merged, worktree cleaned.
  - micro-chore and fast-track gate sessions: marker files written, scope validator accepts/rejects per the rules.
  - failure-path probes: dirty main, locked drain (`drain.lock` present), stale `fast/<slug>` branch (the salvage case) — assert the loop surfaces/parks instead of corrupting state.
- Agent-call seam: headless runs that would spawn an LLM agent need a stub mode (deterministic canned implementer/reviewer responses keyed by slug) so CI is hermetic + free; one opt-in non-stubbed nightly/manual lane runs a real model for true end-to-end (pairs with the existing roadmap entry "Real-Codex Integration Smoke Test" — same gating pattern, `NOLDOR_RUN_REAL_*=1`).
- Wire into CI config + `script-catalog.md`; failures must print the fixture-repo git log + `.noldor/` state for debuggability.

**What it enables:** framework changes can't silently break consumers (the contract half) or the autonomous paths (the e2e half); regression net for every PR-#33-class bug; the fixture doubles as the test bed for [version-migration-chain](#version-aware-upgrade-and-migration-chain) codemods and the demo ground for adoption docs.

**Open questions:** in-repo fixture vs generated-on-the-fly (lean generated); how the agent-stub seam is injected (env var + stub binary on PATH vs a `DrainSource`-style interface — the `DrainSource` seam from plan-runner suggests the pattern); CI provider/workflow file location for the standalone repo.

** **Acceptance sketch:** `pnpm test:contract` locally green in <5 min; intentionally breaking `consumer-config.ts` field name fails the contract job; drain e2e asserts trailers + retired entry on the fixture repo.

## User Story

As an autonomous-drain operator (and as a framework maintainer), I want a fixture consumer repo plus hermetic headless gate/drain runs wired into CI, so that any framework change that would break a downstream consumer's `init`/`doctor`/`validate` contract — or silently regress an autonomous path like the PR-#33 env-directive bug — fails before merge instead of after a consumer upgrades.

## Usage

**Contract lane (local + CI):**

```bash
pnpm test:contract        # build fixture, pnpm pack + install tarball, run init/doctor/validate/garden, assert exit codes
```

**Headless drain e2e (local + CI):**

```bash
pnpm test:e2e:drain       # spawn `noldor autonomous run --source roadmap --max-features 1` against the fixture; assert retired entry + trailers + merged branch
```

**Real-agent lane (nightly / manual only):**

```bash
NOLDOR_RUN_REAL_AGENT=1 pnpm test:e2e:drain   # same harness, real model end-to-end (network + spend)
```

**Agent API / programmatic:**

- `buildConsumerFixture(opts?)` → `ConsumerFixture` (`src/testing/consumer-fixture.ts`) — generate a temp consumer repo; `.git(args)`, `.dumpState()`, `.cleanup()`.
- `runContractChecks(fixtureDir)` (`src/testing/contract-harness.ts`) — drive the four contract commands, return per-step exit codes + artifact assertions.
- Stub seam: set `agents.default: 'stub'` in the consumer's `.noldor/config.json` to make every agent spawn resolve to the deterministic canned gate (`src/testing/stub-gate.ts`).

**Keyboard shortcut:** _none — CI / test harness, no UI surface._

## PRs

<!-- @prs-since-last-release: consumer-contract-ci-and-headless-gate-e2e-harness -->

## Changelog

### Initial Release (v0.4.0)

#### Summary

Hermetic stub runner now register in agent registry (#99).

#### PRs

- #99: register hermetic stub runner in agent registry ([link](https://github.com/davidzoufaly/noldor/pull/99))

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-06-13-consumer-contract-ci-and-headless-gate-e2e-harness-design.md`](../../docs/superpowers/specs/archive/2026-06-13-consumer-contract-ci-and-headless-gate-e2e-harness-design.md)
- **Plan:**
  - [`docs/superpowers/plans/archive/2026-06-13-consumer-contract-ci-and-headless-gate-e2e-harness.md`](../../docs/superpowers/plans/archive/2026-06-13-consumer-contract-ci-and-headless-gate-e2e-harness.md)
- **Code:**
  - [`src/testing/fixtures`](../../src/testing/fixtures)
  - [`src/testing/consumer-fixture.ts`](../../src/testing/consumer-fixture.ts)
  - [`src/testing/contract-harness.ts`](../../src/testing/contract-harness.ts)
  - [`src/testing/stub-gate.ts`](../../src/testing/stub-gate.ts)
  - [`src/autonomous/`](../../src/autonomous/)
  - [`docs/noldor/testing-principles.md`](../../docs/noldor/testing-principles.md)
  - [`docs/noldor/script-catalog.md`](../../docs/noldor/script-catalog.md)
- **Tests:**
  - [`src/autonomous/__tests__/build-pool.test.ts`](../../src/autonomous/__tests__/build-pool.test.ts)
  - [`src/autonomous/__tests__/decide-next.test.ts`](../../src/autonomous/__tests__/decide-next.test.ts)
  - [`src/autonomous/__tests__/drain-eligibility.test.ts`](../../src/autonomous/__tests__/drain-eligibility.test.ts)
  - [`src/autonomous/__tests__/drain-lock.test.ts`](../../src/autonomous/__tests__/drain-lock.test.ts)
  - [`src/autonomous/__tests__/drain-reconcile.test.ts`](../../src/autonomous/__tests__/drain-reconcile.test.ts)
  - [`src/autonomous/__tests__/drain-source.test.ts`](../../src/autonomous/__tests__/drain-source.test.ts)
  - [`src/autonomous/__tests__/drain-state.test.ts`](../../src/autonomous/__tests__/drain-state.test.ts)
  - [`src/autonomous/__tests__/escalations.test.ts`](../../src/autonomous/__tests__/escalations.test.ts)
  - [`src/autonomous/__tests__/merge-classify.test.ts`](../../src/autonomous/__tests__/merge-classify.test.ts)
  - [`src/autonomous/__tests__/merge-coordinator.test.ts`](../../src/autonomous/__tests__/merge-coordinator.test.ts)
  - [`src/autonomous/__tests__/notify.test.ts`](../../src/autonomous/__tests__/notify.test.ts)
  - [`src/autonomous/__tests__/queue-drain-cli.test.ts`](../../src/autonomous/__tests__/queue-drain-cli.test.ts)
  - [`src/autonomous/__tests__/resolve-roadmap-conflict.test.ts`](../../src/autonomous/__tests__/resolve-roadmap-conflict.test.ts)
  - [`src/autonomous/__tests__/run-drain.test.ts`](../../src/autonomous/__tests__/run-drain.test.ts)
  - [`src/autonomous/__tests__/salvage.test.ts`](../../src/autonomous/__tests__/salvage.test.ts)
  - [`src/autonomous/__tests__/watch-args.test.ts`](../../src/autonomous/__tests__/watch-args.test.ts)
  - [`src/autonomous/__tests__/watch-detach.test.ts`](../../src/autonomous/__tests__/watch-detach.test.ts)
  - [`src/autonomous/__tests__/watch-state.test.ts`](../../src/autonomous/__tests__/watch-state.test.ts)
  - [`src/testing/__tests__/consumer-fixture.test.ts`](../../src/testing/__tests__/consumer-fixture.test.ts)
  - [`src/testing/__tests__/contract-harness.test.ts`](../../src/testing/__tests__/contract-harness.test.ts)
  - [`src/testing/__tests__/drain-e2e.test.ts`](../../src/testing/__tests__/drain-e2e.test.ts)
  - [`src/testing/__tests__/stub-runner.test.ts`](../../src/testing/__tests__/stub-runner.test.ts)

<!-- /generated: resources -->
