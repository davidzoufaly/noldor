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

**The contract is part of the design, and failure is returned rather than thrown.** The runner is

```
type RunCommand = (cmd: string, args: string[], opts?: { timeout?: number })
  => Promise<{ code: number; stdout: string; stderr: string }>;
```

and it **never rejects**. A non-zero exit, a missing binary and a killed child all resolve with a non-zero `code` and whatever `stdout`/`stderr` were captured. `runCli` at `preflight-probes.ts:143-152` already does exactly this — it catches `execFileP`'s rejection and returns `{ code, out }` — so this generalises a shape the file already carries rather than inventing one.

The alternative, a rejection carrying `stdout`/`stderr` in the shape `execFile` already uses, was rejected because TypeScript does not type a promise's rejection value: nothing would stop a stub from `throw new Error('boom')`, and that drift is invisible until it changes a row. It matters concretely here — the `npm-name` probe at `preflight-probes.ts:669-680` discriminates published-from-unpublished by regexing `err.stderr` + `err.message` for `/E404|404 Not Found/` and treats anything else as an unanswered question, so a bare `Error` from a stub silently asserts a blocking row where production would report the name free. With a returned result, `stderr` is a typed field the compiler requires, the drift class is gone rather than policed, and no error-constructing helper is needed at all.

The three call sites adapt to read `code` instead of catching. The default runner — an **exported named symbol**, so a test can assert identity against it rather than against the module-private `execFileP` at line 38 — is the one place that converts `execFile`'s rejection into the returned shape.

The name is `runCommand` rather than `exec` deliberately — see U3.

### U2 — The probe owns its timeout, not the runner

`PROBE_TIMEOUT_MS` (line 41) is 15s; `vitest.config.ts` sets `testTimeout: 10_000`. A probe that hits its own bound is killed by the harness five seconds before it can return the row it exists to return, so the `gh probe timed out after 15000ms` branch at line 348 is unreachable from the suite.

The tempting fix — pass a smaller `timeout` to the injected runner — does not work, for two independent reasons. First, it is **circular as a test**: the probe tells a timeout from a missing binary by reading `(err as { killed?: boolean }).killed === true` at lines 341-348, a Node `execFile` implementation detail, so a stub would have to both enforce the bound and fabricate `killed`, and the test would assert the stub rather than the probe. Second, it is **off by 2×**: `gh-auth` makes two sequential `execFileP` calls at lines 339-340, each handed the full bound, so a caller under vitest's 10s that passes 9s can still spend 18s here and be killed exactly as today.

So enforcement moves **into the probe**. `PreflightInput` gains an optional budget (default `PROBE_TIMEOUT_MS`) that `makeProbeContext` threads onto the context. `runProbe` (`preflight-probes.ts:129`) races the whole probe body against that budget with `Promise.race`. The budget is **per probe, shared by every command inside it**, so `gh-auth`'s two calls can no longer double it, and the row no longer depends on `killed`, so no runner has to produce that flag.

Three details decide whether this works, and each is part of the design rather than the implementer's discretion.

**The race owns the row exclusively; `execFile` only cancels the child.** Both bounds defaulting to `PROBE_TIMEOUT_MS` would fire at the same instant and make it a coin flip which row is produced — the race's generic one or the tailored `killed` row at lines 341-352 whose `fix` names the keychain prompt. So the default runner passes the budget **plus a fixed slack** down to `execFile`, guaranteeing the race always wins. `execFile`'s timeout is retained purely to kill a real child that the race cannot cancel; without it a raced-out probe would return while a real `gh` kept waiting on a keychain prompt. The existing `killed` branch stays as the path for a child killed during that cleanup window.

**Each probe declares its own timeout row.** Rather than synthesising a generic one, the probe registry carries a per-probe `{ detail, fix }` for the timeout case, which `runProbe` returns when the budget wins. That is what keeps `gh-auth`'s keychain advice from being silently dropped, and it settles the row's semantics for all 17 probes rather than only the one with existing timeout text. The status is `blocking`, matching what `runProbe`'s existing catch already returns for a probe that threw (lines 133-140): a probe that could not evaluate its gate must never read as a pass.

**The losing timer is cleared.** `runProbe` runs once per id per pass and this one test file drives ~323 probe executions, so an uncleared 15s `setTimeout` per probe would hold the event loop open long after the probe resolved in milliseconds — working directly against criterion 8. The timer is cleared in a `finally`, and `unref`'d besides.

### U3 — A static scan that does not red on its own sanctioned calls

Without a guard the hazard regrows the next time someone adds a probe. The shape is an architecture-invariant test modelled on `src/core/agent-runner/__tests__/no-stray-spawns.test.ts`, whose pattern is `/\b(?:spawn|spawnSync|execFile|execFileSync|execFileP|exec)\s*\(\s*['"](?:claude|codex|opencode)['"]/m`.

Copying that shape naively breaks three ways, and the design pins all three.

**The seam must not match its own guard.** The precedent's `exec` alternative is preceded by `\b`, and a word boundary sits between the `.` and the `e` in `ctx.exec(`, so a seam named `exec` would be flagged by the very scan meant to protect it. Hence `runCommand` in U1 — a name no spawn-primitive alternative can match.

**The scan is keyed on the primitive, not on a command name.** The precedent matches `['"](?:claude|codex|opencode)['"]` right after the call, but `runCli` at `preflight-probes.ts:143-148` spawns `execFileP(cmd, cmdArgs, …)` where `cmd` comes from `noldorCliCommand` — a variable, so no literal-keyed pattern can ever see it, and that is the third call site U1 routes through the seam. The scan therefore forbids **any** spawn primitive (`execFile`, `execFileSync`, `execFileP`, `execSync`, `spawn`, `spawnSync`) appearing anywhere in `preflight-probes.ts` outside the single exported default-runner definition, regardless of what it is handed. That is a stricter rule than the precedent's and it is the only one that closes the variable-command hole.

**There is no URL clause.** `preflight-probes.ts:665` keeps `'https://registry.npmjs.org'` as a config default and line 352 keeps `'https://cli.github.com/'` in operator-facing fix text; neither is I/O, both survive U1, and forbidding URLs would false-red on them.

A static scan is the choice over a runtime assertion: it costs nothing at runtime and does not have to perform the I/O it polices in order to observe it.

### What this deliberately does not fix

`src/garden/__tests__/sdd-report.test.ts:692,728,740,756` shells out to `tsx src/garden/sdd-report.ts` against the live repo (`cwd: process.cwd()`), plus `pnpm --silent fmt:check` at line 732 — four tests, 17.4s for that file. They stay out: they are *integration* tests that deliberately exercise the real CLI against the real repo, and converting them to a fixture duplicates `consumer-contract-ci-and-headless-gate-e2e-harness`.

### What remains unresolved

The 2026-08-20 `route-sweep.test.ts` reds (8 tests, shared with preflight) are **not accounted for** by U1–U3. That file performs no external I/O: it binds an ephemeral port and renders live-repo pages in-process, at 949–1472 ms per route against a 10s bound. Nothing here makes it faster or more deterministic. The honest statement is that this spec removes one sufficient cause in one file and leaves the full-suite question open; if the flake recurs after this ships, `route-sweep.test.ts` and then the sdd-report integration tests are the next suspects, in that order.

## Acceptance criteria

1. No test in the default `vitest run` spawns `gh` or `npm`: every `runPreflight` call in `preflight.test.ts` injects a runner, and that runner records every command it was asked to run.
2. The 17-row contract at `preflight.test.ts:60-64` still holds under an injected runner — the row set and id uniqueness are properties of the registry, not of what the commands returned. **No criterion asks for a real-probe pass.** Evaluating those probes for real spawns `gh --version` + `gh auth status` under a 10s bound, which is the hazard this spec exists to remove; the claim that production is unchanged rests on criteria 3 and 7 instead.
3. `makeProbeContext` is asserted directly to default `runCommand` to the exported default-runner symbol and the budget to `PROBE_TIMEOUT_MS` when the input omits them — so a mis-typed `??` or a dropped field cannot leave the suite green.
4. A probe whose body exceeds the budget yields that probe's declared timeout `PreflightRow` at `blocking`, produced by `runProbe` rather than by the runner, and observable from a test bounded at vitest's 10s. `gh-auth`'s row still carries its keychain `fix` text.
5. A probe making two sequential commands cannot exceed the budget: `gh-auth` given a budget under the harness bound returns its row within that budget, not 2× it.
6. `runCommand` has no rejection path to get wrong: a stub that resolves `{ code, stdout, stderr }` is the only shape the type admits, and `npm-name`'s `/E404/` discrimination reads `stderr` as a required field. A stub omitting it fails `pnpm typecheck`.
7. Any spawn primitive appearing in `preflight-probes.ts` outside the exported default-runner definition fails the scan test — including one handed a variable rather than a literal command name. The sanctioned `ctx.runCommand(...)` calls and the two non-I/O URL strings pass.
8. No probe leaves a pending timer after it resolves, so worker teardown is not delayed by the race.
9. `src/release/__tests__/preflight.test.ts` file duration drops below 10s, from 31s, measured by `vitest run --reporter=basic`.
10. `pnpm verify` is green.

## Risks / trade-offs

- **Success is not directly observable.** The flake did not reproduce here across two runs, one under load. Criterion 8 is the closest proxy, and criteria 1–7 prove the hazard is gone rather than that the original reds are gone. This is a removal of a sufficient cause, stated as such; *What remains unresolved* names what it does not cover.
- **`Promise.race` decides the row but cannot cancel the losing work.** A probe body that has already started a second command keeps running after its row is returned. The `execFile` timeout (budget + slack) is what eventually kills the real child; if that were ever dropped, a raced-out probe would return while a real `gh` waited on a keychain prompt. The coupling and the slack are both stated in U2 so a later edit cannot remove one half without seeing the other. What remains genuinely unhandled is a command *started* after the deadline by a late continuation — accepted, because `runPreflight` returns the raced row regardless and the child is bounded by its own `execFile` timeout.
- **A stub can still drift from the real runner behaviourally.** The typed `{ code, stdout, stderr }` result removes the *shape* drift class entirely (criterion 6), but a stub that answers `gh auth status` with the wrong `code` or `stderr` would make the test green and the release red. Nothing here catches that; the default path staying untouched, and criterion 3 proving it is wired, are the mitigations.
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
9. *Does the runner signal failure by rejecting or by returning?* -> Returning `{ code, stdout, stderr }`; it never rejects. (D9) TypeScript does not type a rejection value, so a rejection contract could only be policed at runtime and by convention, while a returned result makes `stderr` a field the compiler requires — and `runCli` at `preflight-probes.ts:143-152` already returns rather than throws, so this generalises the file's own shape.
10. *Where does the real-probe, non-injected pass live?* -> Nowhere in the default suite. (D10) Running it spawns `gh` under a 10s bound, which is the hazard being removed; criterion 3's direct assertion on `makeProbeContext`'s defaults and criterion 7's scan carry the "production is unchanged" claim instead.
11. *Does the race's generic row replace each probe's tailored timeout text?* -> No; each probe declares its own timeout `{ detail, fix }` and `runProbe` returns it. (D11) A generic row would silently drop `gh-auth`'s keychain advice at line 352, and declaring one per probe also settles the row's semantics for the other 16 rather than leaving them undefined.
12. *How is the scan made to cover `runCli`'s variable command?* -> Key the scan on the spawn primitive alone, not on a literal command name. (D12) `runCli` passes `cmd` from `noldorCliCommand`, so no literal-keyed pattern can see it; forbidding the primitive outside the exported default runner is stricter than the precedent but is the only rule that closes the hole.
