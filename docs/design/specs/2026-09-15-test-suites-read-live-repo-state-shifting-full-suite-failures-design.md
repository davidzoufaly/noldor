# Test Suites Read Live Repo State — Shifting Full-Suite Failures — Design

**Slug:** test-suites-read-live-repo-state-shifting-full-suite-failures
**FD:** docs/features/test-suites-read-live-repo-state-shifting-full-suite-failures.md
**Date:** 2026-09-15
**Tier:** specs-only
**Deps:** none

## Problem

`npx vitest run` fails on a shifting set of files that each pass in isolation, so a green suite is a matter of timing rather than a statement about the code. The roadmap entry (Q-0171) recorded two runs ten minutes apart on 2026-08-20: one red in `src/garden/__tests__/sdd-report.test.ts` (2 tests), the next red in `src/release/__tests__/preflight.test.ts` + `src/dashboard/__tests__/route-sweep.test.ts` (8 tests) with sdd-report green, and all three green together in isolation.

The entry's stated cause does not survive reading the files. `preflight.test.ts:19-33` builds a `mkdtempSync` git repo per test and never touches the live `.noldor/`; `route-sweep.test.ts:23` binds `startServer({ port: 0 })`, an ephemeral port that cannot collide. So neither "tests read live `.noldor/session.json`" nor "the dashboard port" is the mechanism, and a fix aimed at those would leave the flake in place.

What the files do share is **unbounded external I/O inside a unit suite, under a per-test timeout shorter than the I/O's own bound**. Two green full-suite runs today (5618 tests, ~43s wall, one of them under six busy-loop CPU hogs) confirm the flake is real but not reproducible on demand, which is exactly why the remedy has to be structural rather than a chased repro.

## Goals

- Remove unbounded network and CLI-discovery I/O from the unit suite, so a test's result depends on the repo and not on `gh`, the npm registry, or the machine's load.
- Make a probe that exceeds its own bound report as a row rather than killing the test that called it — the current inversion loses the diagnosis.
- Leave behind a regression net, so the hazard class cannot silently regrow.

## Non-goals

- Rewriting all 67 of 385 test files that spawn subprocesses. Most spawn `git` against a tmpdir, which is bounded and local.
- Building a fixture consumer repo or an e2e layer — that is `consumer-contract-ci-and-headless-gate-e2e-harness`, already an FD.
- Raising `testTimeout` as the remedy. It would convert a red suite into a slow one and hide the same defect.
- Changing `vitest.setup.ts`'s `process.chdir` to the repo root. 32 test files read live repo state through it deliberately; that is a separate (and larger) question.

## Design

### Structural context

`noldor:cut graphify-out/graph.json is stale (design graph-context exit 1) and regenerating it rewrites a 4 MB tracked artifact that /noldor-release-sweep owns — the churn does not belong in this PR.` Read from the stale `graphify-out/graph.brainstorm-summary.toon` anyway: none of the six candidate paths (`vitest.config.ts`, `vitest.setup.ts`, `src/release/preflight-probes.ts`, and the three named test files) appears in the top-20 communities or the top-25 cross-community edges. They are interior files with no god node and no bridge — which is itself the finding: this change is contained, and nothing downstream reads it structurally. What would change the answer is a fresh graph showing `preflight-probes.ts` as a hub for the release module.

### U1 — Seam the external probes behind an injected runner

`src/release/preflight-probes.ts` reaches the outside world in three places with no way for a caller to intercept it. The `gh-auth` probe (lines 335-340) spawns `gh --version` then `gh auth status` on **every** `runPreflight` call, with no skip guard. The `npm-name` probe (line 670) runs `npm view <name> versions --json --registry https://registry.npmjs.org`, a real network round-trip — guarded only by `release.publish.enabled`. And `runCli` (lines 143-148) spawns the whole noldor CLI as a child node process via `noldorCliCommand`. `preflight.test.ts` calls `runPreflight` 19 times, and `runPreflight` (`src/release/preflight.ts:73-75`) walks all 17 probe ids serially per call, so that file alone performs ~323 probe executions and took 31s of the 43s suite.

The seam to add is the one `src/release/release-cr-gate.ts:75` already demonstrates — `input.runGit ?? ((args) => execFileSync(...))`. Extend `PreflightInput` with an optional runner (working name `exec`) that `makeProbeContext` threads onto `ProbeCtx`, defaulting to the real `execFileP`. Production behaviour is byte-identical; the tests inject a runner that answers `gh`/`npm` from a table and never leaves the process.

One runner covers all three call sites, `runCli` included. A second seam for the noldor-internal spawn would describe the same concern twice, which is the abstraction cost the repo's own ratchet penalises, and `runCli` already funnels every internal spawn through a single function — so the single seam reaches it for free.

### U2 — Resolve the timeout inversion

`vitest.config.ts` sets `testTimeout: 10_000`; `preflight-probes.ts:41` sets `PROBE_TIMEOUT_MS = 15_000`. A probe that hits its own bound therefore kills the test five seconds before it can return the row it was written to return — the `gh probe timed out after 15000ms` branch at line 348 is unreachable from the test suite, and the operator sees a bare vitest timeout naming the test rather than the gate. Once U1 lands the tests no longer reach those probes at all, but the inversion is a live defect for anyone running `runPreflight` under any harness with a shorter bound.

`PROBE_TIMEOUT_MS` therefore becomes a default rather than a constant: `PreflightInput` gains an optional bound that `makeProbeContext` threads onto `ProbeCtx` beside the runner, and the probes read it instead of the module-level literal. A caller that is itself bounded passes something under its own limit, so the timeout row is reachable rather than pre-empted. The rejected alternative was raising `testTimeout` past 15s for the release suite: one line, but it leaves both numbers free to disagree again on the next edit to either, and it makes the suite slower rather than more honest.

### U3 — A regression net that keeps the unit suite off the network

Without a guard the hazard regrows the next time someone adds a probe. The shape that fits this repo is an architecture-invariant-style test (the repo already carries `src/core/agent-runner/__tests__/no-stray-spawns.test.ts`, which is the same idea for a different spawn class) asserting that no probe module reaches `gh`, `npm`, or a URL except through the injected runner.

It is a **static scan** of `preflight-probes.ts` for the forbidden identifiers, not a runtime assertion that the default runner was never constructed. The scan matches the `no-stray-spawns.test.ts` precedent, costs nothing at runtime, and reads as a rule rather than as a side effect. The indirection it would miss — a spawn reached through a variable rather than a literal — is not a shape this module has, and a runtime probe would have to run the very I/O it is policing to observe it.

### What this deliberately does not fix

`src/garden/__tests__/sdd-report.test.ts:692,728,740,756` shells out to `tsx src/garden/sdd-report.ts` against the live repo (`cwd: process.cwd()`), plus `pnpm --silent fmt:check` at line 732 — four tests, 17.4s for that file. These are slow and live-state-dependent, and sdd-report was one of the observed red files. They stay out of scope: they are *integration* tests that deliberately exercise the real CLI against the real repo, and converting them to a fixture duplicates `consumer-contract-ci-and-headless-gate-e2e-harness`. Taking the narrow cut trades coverage of one observed red file for a fix that is measurable; the wide cut would trade a provable fix for a larger unprovable one.

This is the cut most likely to be wrong. If the flake recurs after this ships, these four tests are the next suspect and the scope moves to them.

## Acceptance criteria

1. `preflight.test.ts` completes without spawning `gh` or `npm` — asserted by the injected runner recording every command it was asked to run.
2. `runPreflight` with no injected runner behaves exactly as today: the 17-row contract at `preflight.test.ts:62-63` still passes unchanged.
3. A probe whose command exceeds the bound produces a `PreflightRow` reporting the timeout, and that row is observable from a test bounded at vitest's 10s — proved by injecting a runner that stalls past a bound the test passes in, so no real command is spawned to demonstrate it.
4. `src/release/__tests__/preflight.test.ts` file duration drops below 10s (from 31s), measured by `vitest run --reporter=basic`.
5. A new test fails when a network or CLI-discovery call is added to `preflight-probes.ts` outside the injected runner.
6. `pnpm verify` is green.

## Risks / trade-offs

- **The flake is not reproducible here, so success is not directly observable.** Two green runs today, one under load. Criterion 4 (file duration) is the closest proxy: removing 19 × 2 `gh` spawns and one CLI spawn per call should be a large, measurable drop, and a test that no longer performs unbounded I/O cannot time out because of it. The honest statement is that this removes a sufficient cause, not that it proves the only cause.
- **An injected runner can drift from the real one.** A stub that answers `gh auth status` differently from the real `gh` makes the test green and the release red. Mitigated by keeping the default path untouched and the stub's table small.
- **Scope may be mis-cut.** If the 2026-08-20 reds were in fact the sdd-report integration tests timing out under parallel load, U1–U3 leave that untouched and the flake survives. This is the main thing the operator should push back on.

## User Story

As an engineer or agent running `pnpm test`, I want a red suite to mean the code is broken rather than that the network was slow, so that I read the failure instead of retrying the run.

## Usage

No new command. `pnpm test` and `pnpm verify` behave as before; `pnpm noldor release run --preflight` is unchanged. The only new surface is the optional runner on `runPreflight`'s input, used by tests.

## Open questions (resolved)

1. *Is the mechanism unbounded external I/O, or live shared repo state as Q-0171 claims?* -> Unbounded external I/O. (D1) `preflight.test.ts` uses tmpdir repos and `route-sweep.test.ts` uses `port: 0`, so both stated causes are falsified by the files themselves, while every observed red file sits in the measured slow tail.
2. *One injected runner for all three spawn sites, or a separate seam for `runCli`?* -> One runner. (D2) Three seams to describe one concern is the abstraction cost the repo's own ratchet penalises, and `runCli` already funnels through a single function.
3. *Fix the timeout inversion by parameterising the probe bound, or by raising `testTimeout`?* -> Parameterise. (D3) Raising the timeout leaves two files free to disagree again and makes the suite slower rather than more honest.
4. *Static scan or runtime assertion for the regression net?* -> Static scan. (D4) Matches the existing `no-stray-spawns.test.ts` precedent and costs nothing at runtime; the indirection it misses is not a shape this module has.
5. *Should the sdd-report integration tests come into scope?* -> No. (D5) They are deliberate real-CLI integration tests and converting them is a different FD's scope — but this is the cut most likely to be wrong, so it is stated rather than assumed.
