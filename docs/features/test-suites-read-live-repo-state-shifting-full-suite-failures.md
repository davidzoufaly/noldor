---
area: testing
category: Tooling
deps: []
entry-id: Q-0171
links:
  code:
    - src/release/run-command.ts
    - src/testing/suite-lock.ts
  tests:
    - src/release/__tests__/no-probe-spawns.test.ts
    - src/release/__tests__/run-command.test.ts
    - src/testing/__tests__/suite-lock.test.ts
name: Test Suites Read Live Repo State — Shifting Full-Suite Failures
packages:
  - scripts
phase: in-progress
since: 2026-08-23T00:00:00.000Z
noldor-tier: specs-only
introduced: 1.10.0
---
## Summary

`npx vitest run` failed on a shifting set of files that each passed in isolation, so a green suite was a matter of timing. Q-0171 recorded two runs ten minutes apart on 2026-08-20 with disjoint failure sets across `sdd-report.test.ts`, `preflight.test.ts` and `route-sweep.test.ts`.

The entry blamed live `.noldor/session.json` and the dashboard port. Reading the files falsified both: `preflight.test.ts` builds a `mkdtemp` repo per test and `route-sweep.test.ts` binds `port: 0`. What reading did establish was a specific defect in one file — `src/release/preflight-probes.ts` performed unbounded external I/O (`gh --version`, `gh auth status`, `npm view`) with no seam to intercept it, driven 19 times per run, under a harness bound (10s) *shorter* than the probes' own (15s), so the probes' timeout branch was unreachable and a slow keychain killed the test instead.

**This feature fixes that one file.** Every probe now reaches the outside world through one injectable `RunCommand` (`src/release/run-command.ts`), timeout enforcement moved into `runProbe` as a per-probe budget, and a static scan keeps spawn primitives out of the probes module. Measured: 31s → ~5s alone, ~14s in the full parallel suite.

**It does not fix the full-suite flake, and does not claim to.** The residue is `git`, not `gh` — `inspectTreeState` spawns `git fetch` outside the seam (Q-0237) — and the `route-sweep.test.ts` and `sdd-report.test.ts` reds remain unexplained (Q-0238). Both were minted as follow-ups when this shipped, so retiring Q-0171 does not lose the open investigation.

**Q-0238 explained the rest, and it was load, not shared state.** Three full suites started at once on the 18-core dev machine went red in every run, and every `sdd-report`, dashboard and `route-sweep` failure was a timeout: vitest sizes each run's worker pool from the core count, so concurrent suites — a parallel drain, or two worktree sessions plus a reviewer lane — oversubscribe the machine and the heaviest tests cross the 10s bound. A full run writes nothing to the live tree, so the hypothesis in this feature's name is retired. Full suites now queue behind one lock that every worktree shares (`src/testing/suite-lock.ts`, a vitest `globalSetup`); with it, three concurrent runs pass one after another.

## Diagram

<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or
     two beside it for readers that do not render mermaid. No shape worth drawing?
     Replace this comment with: noldor:cut <reason> -->

## User Story

As an engineer or agent running `pnpm test`, I want a red suite to mean the code is broken rather than that the network was slow, so that I read the failure instead of retrying the run.

## Usage

`pnpm test` and `pnpm verify` queue behind any other full suite of this repo, from any worktree. A run that finds the suite lock held prints `suite lock: waiting for the full suite in <worktree> (pid <n>, running since <time>)`, then `suite lock: acquired after <n>s` when its turn comes. `vitest run <file>` and watch mode never queue. The wait is bounded at 15 minutes, after which the run starts anyway with a warning; outside a git checkout, or when the lock cannot be created, the run is not queued and says so. `pnpm noldor release run --preflight` behaves as before.

- `NOLDOR_SUITE_LOCK=0 pnpm test` — run without queuing.
- The lock is `noldor-suite.lock` in the git common dir (`git rev-parse --git-common-dir`). A run killed outright leaves it behind; the next full suite reclaims it once that pid is dead.

**Reproducing the full-suite flake**

Start three full suites at once with the queue off, then read the JSON reports:

```bash
for n in 1 2 3; do
  NOLDOR_SUITE_LOCK=0 pnpm exec vitest run --reporter=json --outputFile="/tmp/suite-$n.json" &
done
wait
```

A report's failures are the `testResults[].assertionResults[]` entries with `status: "failed"`. One whose first `failureMessages` line is `Error: STACK_TRACE_ERROR`, thrown from `@vitest/runner`'s `chunk-hooks.js`, is a **timeout**: vitest 3.2.4 builds that error when the test is defined and only rewrites its message when the timer fires, and the JSON reporter prints the stack, so searching a report for "timed out" finds nothing. Anything else is an assertion or a thrown error. A test that timed out inside synchronous work (`execSync`) reports a duration above the bound.

Baseline on the 18-core dev machine (2026-09-24): one suite alone passes in ~51s and its slowest test takes 6.7s; three at once fail 6–11 tests each, nearly all of them timeouts in `sdd-report.test.ts`, the dashboard data and server tests, and `route-sweep.test.ts`. With the queue on, the same three runs pass one after another, finishing at 57s, 126s and 194s.

**Agent/Programmatic API**

- `runPreflight({ ..., runCommand })` — inject a `RunCommand` so the probes spawn nothing. It resolves `{ code, stdout, stderr }` and must never reject; `makeProbeContext` normalises it if it does, because a type cannot forbid a throw.
- `runPreflight({ ..., budgetMs })` — budget for one probe, shared by every command in it. A caller bounded by its own harness passes something smaller and gets a timeout row back instead of being killed mid-probe.
- `src/release/run-command.ts` exports `defaultRunCommand` (the only sanctioned spawn in the preflight path), `normalizeRunner`, and `resultFromError`.
- `src/testing/suite-lock.ts` — its default export is the vitest `globalSetup`. `tryAcquire` takes the lock once, `acquireSuiteLock` waits for it with a deadline and an optional `AbortSignal`, `releaseSuiteLock` removes it only while it is still the caller's, and `suiteLockSkipReason` says which runs do not queue.

## PRs

<!-- @prs-since-last-release: test-suites-read-live-repo-state-shifting-full-suite-failures -->

## Changelog

### Initial Release (v1.10.0)

#### Summary

Preflight probes now go through one injectable command seam (#464).

#### PRs

- #464: route preflight probes through one injectable command seam ([link](https://github.com/davidzoufaly/noldor/pull/464))

<!-- generated: resources -->

## Resources

- **Code:**
  - [`src/release/run-command.ts`](../../src/release/run-command.ts)
  - [`src/testing/suite-lock.ts`](../../src/testing/suite-lock.ts)
- **Tests:**
  - [`src/release/__tests__/no-probe-spawns.test.ts`](../../src/release/__tests__/no-probe-spawns.test.ts)
  - [`src/release/__tests__/run-command.test.ts`](../../src/release/__tests__/run-command.test.ts)
  - [`src/testing/__tests__/suite-lock.test.ts`](../../src/testing/__tests__/suite-lock.test.ts)

<!-- /generated: resources -->
