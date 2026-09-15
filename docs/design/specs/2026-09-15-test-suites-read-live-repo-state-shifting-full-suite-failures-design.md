# Test Suites Read Live Repo State — Shifting Full-Suite Failures — Design

**Slug:** test-suites-read-live-repo-state-shifting-full-suite-failures
**FD:** docs/features/test-suites-read-live-repo-state-shifting-full-suite-failures.md
**Date:** 2026-09-15
**Tier:** specs-only
**Deps:** none

## Problem

`npx vitest run` fails on a shifting set of files that each pass in isolation, so a green suite is a matter of timing rather than a statement about the code. Q-0171 recorded two runs ten minutes apart on 2026-08-20: one red in `src/garden/__tests__/sdd-report.test.ts` (2 tests), the next red in `src/release/__tests__/preflight.test.ts` + `src/dashboard/__tests__/route-sweep.test.ts` (8 tests) with sdd-report green, and all three green together in isolation.

The entry's stated causes do not survive reading the files. `preflight.test.ts:19-33` builds a `mkdtempSync` git repo per test and never touches the live `.noldor/`; `route-sweep.test.ts:23` binds `startServer({ port: 0 })`, an ephemeral port that cannot collide. So neither "tests read live `.noldor/session.json`" nor "the dashboard port" is a mechanism, and a fix aimed at those would change nothing.

What reading the files *does* establish is a specific, independently-checkable defect in one file. `src/release/preflight-probes.ts` performs unbounded external I/O — `gh --version`, `gh auth status`, and `npm view <name> --registry https://registry.npmjs.org` — with no seam for a caller to intercept it, and `preflight.test.ts` drives that 19 times. The probes' own bound (`PROBE_TIMEOUT_MS = 15_000`, line 41) is larger than the harness bound that contains them (`testTimeout: 10_000` in `vitest.config.ts`), so the probes' timeout branch is unreachable from the suite. That file took 31s of a 43s run.

Two full-suite runs today were green (5618 tests, ~43s wall; the second under six busy-loop CPU hogs). The flake is real but does not reproduce on demand here, which bounds what this feature may claim — see Goals.

## Goals

- **Isolate `preflight.test.ts` from external I/O**, so its result depends on the repo rather than on `gh`, the npm registry, or machine load.
- **Give timeout enforcement one owner**, so a probe that exceeds its budget reports a row instead of being killed by the harness that called it.
- **Leave a regression net**, so the hazard cannot silently regrow when the next probe is added.

## Non-goals

- **Claiming the full-suite flake is fixed.** This removes one sufficient cause in one file. The 2026-08-20 `route-sweep.test.ts` reds are **not explained** by anything in this spec, and the `sdd-report.test.ts` reds are explicitly out of scope. Q-0171 stays open as an investigation after this ships; see *What remains unresolved*.
- Rewriting the 67 of 385 test files that spawn subprocesses. Most spawn `git` against a tmpdir, which is local and bounded.
- Building a fixture consumer repo or an e2e layer — that is `consumer-contract-ci-and-headless-gate-e2e-harness`, already an FD.
- Raising `testTimeout`. It converts a red suite into a slow one and leaves the two bounds free to disagree again.
- Changing `vitest.setup.ts`'s `process.chdir` to the repo root. 32 test files read live repo state through it deliberately; that is a separate and larger question.

## Design

### Structural context

`noldor:cut graphify-out/graph.json is stale (design graph-context exit 1) and regenerating it rewrites a 4 MB tracked artifact that /noldor-release-sweep owns — the churn does not belong in this PR.` Read from the stale `graphify-out/graph.brainstorm-summary.toon` anyway: none of the candidate paths (`vitest.config.ts`, `vitest.setup.ts`, `src/release/preflight-probes.ts`, and the three named test files) appears in the top-20 communities or the top-25 cross-community edges. They are interior files with no god node and no bridge — itself the finding: this change is contained, and nothing downstream reads it structurally. A fresh graph showing `preflight-probes.ts` as a hub for the release module would change the answer.

### U1 — One injected command runner, with a stated contract

`preflight-probes.ts` reaches the outside world in three places with no interception point: the `gh-auth` probe (lines 335-340), the `npm-name` probe (line 670), and `runCli` (lines 143-148), which spawns the whole noldor CLI as a child node process. `runPreflight` (`src/release/preflight.ts:73-75`) walks all 17 probe ids serially per call, so `preflight.test.ts`'s 19 calls perform ~323 probe executions.

Add **one** seam, following the precedent at `src/release/release-cr-gate.ts:75` (`input.runGit ?? ((args) => execFileSync(...))`). `PreflightInput` gains an optional `runCommand`; `makeProbeContext` (`preflight-probes.ts:83-101`) threads it onto `ProbeContext` beside the existing memoized `treeState` / `previousTag` / `config` closures, defaulting to the real `execFileP`. All three call sites go through it — a second seam for `runCli` would describe the same concern twice, and `runCli` already funnels every internal spawn through a single function.

**The contract is part of the design, not left to the implementer.** The runner is `(cmd: string, args: string[], opts?: { timeout?: number }) => Promise<{ stdout: string; stderr: string }>`. Failure is a rejection with an `Error` carrying `stdout` and `stderr` string properties and, where the process exited non-zero, a numeric `code` — the shape `execFile`'s own rejection already has. This matters concretely rather than decoratively: the `npm-name` probe at `preflight-probes.ts:669-680` discriminates published-from-unpublished by regexing `err.stderr` + `err.message` for `/E404|404 Not Found/` and treats anything else as an unanswered question, so a stub rejecting with a bare `Error` would silently land in the "unanswered" branch and assert a blocking row where production reports the name free. Test support therefore ships **one** helper that builds rejections in this shape, and every stub uses it, so the contract has a single point of drift.

The name is `runCommand` rather than `exec` deliberately — see U3.

### U2 — The probe owns its timeout, not the runner

`PROBE_TIMEOUT_MS` (line 41) is 15s; `vitest.config.ts` sets `testTimeout: 10_000`. A probe that hits its own bound is killed by the harness five seconds before it can return the row it exists to return, so the `gh probe timed out after 15000ms` branch at line 348 is unreachable from the suite.

The tempting fix — pass a smaller `timeout` to the injected runner — does not work, for two independent reasons. First, it is **circular as a test**: the probe tells a timeout from a missing binary by reading `(err as { killed?: boolean }).killed === true` at lines 341-348, a Node `execFile` implementation detail, so a stub would have to both enforce the bound and fabricate `killed`, and the test would assert the stub rather than the probe. Second, it is **off by 2×**: `gh-auth` makes two sequential `execFileP` calls at lines 339-340, each handed the full bound, so a caller under vitest's 10s that passes 9s can still spend 18s here and be killed exactly as today.

So enforcement moves **into the probe**. `PreflightInput` gains an optional budget (default `PROBE_TIMEOUT_MS`) that `makeProbeContext` threads onto the context. `runProbe` races the whole probe body against that budget with `Promise.race` and, on the budget winning, synthesises the probe's timeout row itself. Two consequences fall out. The budget is **per probe, shared by every command inside it**, so `gh-auth`'s two calls can no longer double it. And the timeout row no longer depends on `killed`, so no runner — real or stubbed — has to produce that flag.

The default runner still passes `timeout` down to `execFile`, because the race decides the *row* while only `execFile`'s own timeout **cancels the child process**; dropping it would leak a real `gh` waiting on a keychain prompt. A stub spawns nothing, so it leaks nothing. The line 341-348 `killed` discrimination stays in place for the real path where `execFile` may still win the race.

### U3 — A static scan that does not red on its own sanctioned calls

Without a guard the hazard regrows the next time someone adds a probe. The shape is an architecture-invariant test modelled on `src/core/agent-runner/__tests__/no-stray-spawns.test.ts`, whose pattern is `/\b(?:spawn|spawnSync|execFile|execFileSync|execFileP|exec)\s*\(\s*['"](?:claude|codex|opencode)['"]/m`.

Copying that shape naively breaks twice, and the design pins both. Its `exec` alternative is preceded by `\b`, and a word boundary sits between the `.` and the `e` in `ctx.exec(`, so a seam named `exec` would be matched by the very scan meant to protect it. Hence `runCommand` in U1 — a name no spawn-primitive alternative can match. And the scan forbids **spawn primitives only** (`execFile`, `execFileSync`, `execFileP`, `execSync`, `spawn`, `spawnSync`) applied to a literal `gh` or `npm`; it does **not** forbid URLs, because `preflight-probes.ts:665` keeps `'https://registry.npmjs.org'` as a config default and line 352 keeps `'https://cli.github.com/'` in operator-facing fix text, and neither is I/O.

A static scan over `preflight-probes.ts` is the choice over a runtime assertion: it matches the existing precedent, costs nothing at runtime, and does not have to perform the I/O it polices in order to observe it.

### What this deliberately does not fix

`src/garden/__tests__/sdd-report.test.ts:692,728,740,756` shells out to `tsx src/garden/sdd-report.ts` against the live repo (`cwd: process.cwd()`), plus `pnpm --silent fmt:check` at line 732 — four tests, 17.4s for that file. They stay out: they are *integration* tests that deliberately exercise the real CLI against the real repo, and converting them to a fixture duplicates `consumer-contract-ci-and-headless-gate-e2e-harness`.

### What remains unresolved

The 2026-08-20 `route-sweep.test.ts` reds (8 tests, shared with preflight) are **not accounted for** by U1–U3. That file performs no external I/O: it binds an ephemeral port and renders live-repo pages in-process, at 949–1472 ms per route against a 10s bound. Nothing here makes it faster or more deterministic. The honest statement is that this spec removes one sufficient cause in one file and leaves the full-suite question open; if the flake recurs after this ships, `route-sweep.test.ts` and then the sdd-report integration tests are the next suspects, in that order.

## Acceptance criteria

1. `preflight.test.ts` runs to completion without spawning `gh` or `npm`, asserted by the injected runner recording every command it was asked to run.
2. With no injected runner, `runPreflight` behaves as today: the 17-row contract at `preflight.test.ts:62-63` holds, evaluated against the real probes at least once.
3. `makeProbeContext` is asserted directly to default `runCommand` to the real `execFileP` and the budget to `PROBE_TIMEOUT_MS` when the input omits them — so a mis-typed `??` or a dropped field cannot leave the suite green.
4. A probe whose body exceeds the budget yields a `PreflightRow` reporting a timeout, produced by the probe rather than by the runner, and observable from a test bounded at vitest's 10s.
5. A probe making two sequential commands cannot exceed the budget: `gh-auth` given a budget under the harness bound returns its row within that budget, not 2× it.
6. A runner that rejects with a bare `Error` — no `stderr` — is rejected by the contract's test helper rather than silently producing an "unanswered" `npm-name` row.
7. Adding a spawn primitive applied to a literal `gh` or `npm` anywhere in `preflight-probes.ts` fails the scan test; the sanctioned `ctx.runCommand(...)` calls and the two non-I/O URL strings do not.
8. `src/release/__tests__/preflight.test.ts` file duration drops below 10s, from 31s, measured by `vitest run --reporter=basic`.
9. `pnpm verify` is green.

## Risks / trade-offs

- **Success is not directly observable.** The flake did not reproduce here across two runs, one under load. Criterion 8 is the closest proxy, and criteria 1–7 prove the hazard is gone rather than that the original reds are gone. This is a removal of a sufficient cause, stated as such; *What remains unresolved* names what it does not cover.
- **`Promise.race` decides the row but does not cancel work.** The default runner's `execFile` timeout is what kills a real child; if that were ever dropped, a raced-out probe would return its row while a real `gh` kept waiting on a keychain prompt. The coupling is stated in U2 so a later edit does not remove one half.
- **A stub can still drift from the real runner.** A single rejection-building helper (U1) and criterion 6 narrow it to one place, but a stub that answers `gh auth status` differently from real `gh` would make the test green and the release red. The default path staying untouched is the main mitigation.
- **Scope may be mis-cut.** If the 2026-08-20 reds were dominated by slow in-process rendering rather than external I/O, U1–U3 leave them untouched. *What remains unresolved* is written so that outcome reads as expected rather than as a surprise.

## User Story

As an engineer or agent running `pnpm test`, I want a red suite to mean the code is broken rather than that the network was slow, so that I read the failure instead of retrying the run.

## Usage

No new command. `pnpm test` and `pnpm verify` behave as before; `pnpm noldor release run --preflight` is unchanged. The only new surface is two optional fields on `runPreflight`'s input — `runCommand` and the probe budget — used by tests.

## Open questions (resolved)

1. *Is the mechanism unbounded external I/O, or live shared repo state as Q-0171 claims?* -> Neither claim in the entry survives, and external I/O is established only for `preflight.test.ts`. (D1) The tmpdir repos and the ephemeral port falsify the entry's two causes outright; the `gh`/`npm` spawns are measured, but they explain one of the two observed red files, so the causal claim is scoped to that file rather than to the suite.
2. *One injected runner for all three spawn sites, or a separate seam for `runCli`?* -> One runner. (D2) Three seams for one concern is the abstraction cost the repo's own ratchet penalises, and `runCli` already funnels every internal spawn through a single function.
3. *Who enforces the probe timeout — the injected runner, or the probe?* -> The probe, via `Promise.race` on a per-probe budget. (D3) A runner-enforced bound makes the regression test assert the stub's fabricated `killed` flag rather than the probe, and lets `gh-auth`'s two sequential calls spend 2× the bound.
4. *Is the injected bound a per-command ceiling or a per-probe budget?* -> Per probe, shared by every command in it. (D4) A per-command ceiling is what produces the 2× overrun, and a caller that is itself bounded can only reason about the probe as a whole.
5. *Static scan or runtime assertion for the regression net?* -> Static scan, over spawn primitives only, with no URL clause. (D5) It matches the `no-stray-spawns.test.ts` precedent and cannot false-red on the two non-I/O URL strings that survive U1; the seam is named `runCommand` so the scan cannot match its own sanctioned calls.
6. *What proves the default, non-injected wiring once every test injects a stub?* -> A direct assertion on the context `makeProbeContext` returns. (D6) It is constructed from a plain object at `preflight-probes.ts:83-101`, so the defaults are assertable without running a probe.
7. *Should the sdd-report integration tests come into scope?* -> No. (D7) They are deliberate real-CLI integration tests and converting them is another FD's scope.
8. *Should the feature claim the full-suite flake is fixed?* -> No; narrow the claim to preflight I/O isolation and keep the investigation open. (D8) The `route-sweep.test.ts` reds are unexplained by this design, so a "fixed" claim would be falsified by the next shifting failure.
