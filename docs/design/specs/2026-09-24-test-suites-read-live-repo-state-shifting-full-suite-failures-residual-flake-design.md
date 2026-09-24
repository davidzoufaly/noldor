# Full-Suite Flake: route-sweep and sdd-report Still Unexplained — Design

**Slug:** full-suite-flake-route-sweep-and-sdd-report-still-unexplained
**FD:** docs/features/test-suites-read-live-repo-state-shifting-full-suite-failures.md
**Date:** 2026-09-24
**Tier:** specs-only
**Deps:** Q-0171 (shipped, PR #464 — the preflight command seam)

## Problem

On 2026-08-20, during a parallel XS drain, two full-suite runs ten minutes apart went red on different files that each passed alone: `src/garden/__tests__/sdd-report.test.ts` (2 tests) in the first, `src/release/__tests__/preflight.test.ts` plus `src/dashboard/__tests__/route-sweep.test.ts` (8 tests between them) in the second. Q-0171 removed the preflight cause and left the other two open. Nothing recorded what those runs reported, and the session transcripts from that week are gone, so "timeout or assertion?" cannot be answered from the past.

It can be answered now. Measured on 2026-09-24 on the 18-core dev machine:

- **One suite alone is green, but the top of it is close to the bound.** 6287 tests in 51s. The slowest test is sdd-report's `writes oxfmt-compliant markdown` at 6.7s, against the 10s `testTimeout` in `vitest.config.ts`. Three tests are over 5s, none over 8s.
- **Three suites at once go red every time.** Three concurrent `vitest run`s — what a parallel drain, or two worktree sessions plus a reviewer lane, does — all failed: 8, 10 and 11 failures, 151s wall each. Every failure but one is a **timeout**: sdd-report's three markdown CLI tests (12.7–16.7s), two to four hot-zones tests in `dashboard-data.test.ts` and three feature/wip-age tests in `dashboard-server.test.ts` (each at 10.0s). The odd one out is an assertion in `registry-logsink.test.ts`.
- **route-sweep held out, then fell.** It stayed green in those three runs, though its slowest routes call the same loaders whose own tests timed out; a second batch of three concurrent runs timed out its `GET /metrics` test (11–12s) in every run.
- **Nothing writes to the live tree.** A file-mtime scan across a full run found zero changed files, so the parent feature's "tests read live repo state" idea — a writer racing a reader — has no writer. That hypothesis is retired.

So the cause is not shared state. It is **oversubscription**. Vitest sizes its worker pool from `os.availableParallelism()`, not from how busy the machine is, so K suites put K times the workers on the same cores and every test's wall time stretches with K. The 10s bound is a wall-clock check, so the heaviest tests — the ones that spawn a whole-repo CLI or walk git history — cross it first, and which of them cross depends on how the load lands. That is the "shifting set".

One trap hid this: vitest 3.2.4's JSON reporter records a timeout as `Error: STACK_TRACE_ERROR` (the stack is captured before the message becomes "Test timed out"), so searching a JSON report for "timed out" finds nothing.

## Goals

- **Write the reproduction down** so anyone can re-run it and read the result, timeout trap included.
- **Stop concurrent suites from fighting over the cores**, so a timeout means a slow or hung test, not a busy neighbour.

## Non-goals

- **The `registry-logsink.test.ts` assertion.** Seen once under load (`expected '' to contain 'out-line'`, 0.2s) — an assertion, not a timeout, so a different class of flake. Captured in `ideas.md` for triage.
- **Raising the global `testTimeout`.** Q-0171's reasoning still holds: it turns a red suite into a slow one and hides the next regression.
- **Extra room for the slowest tests when one suite runs alone.** Alone, the slowest test takes 6.7s of its 10s and has never been seen to fail. Sharing one sdd-report run between two tests would only move that run into a hook with the same 10s bound, and putting the tests' bound above a child-process timeout is a per-test budget by another name — the approach this design rejected in favour of queuing.
- **Turning sdd-report's CLI tests into fixtures.** They are real-CLI integration tests on purpose (Q-0171 D7).
- **Making the dashboard's git loaders faster.** Possible, but not needed once suites stop competing (open question 8).
- **Load that is not a Noldor suite** — a build, a browser, another repo's tests. A lock cannot see it.
- **Shipping the lock to consumers.** This is this repo's own test setup; a consumer that hits the same thing can take it later.

## Design

### Structural context

The graph is fresh (`design graph-context` reports the committed graph postdates the last graph-relevant commit); `graph.brainstorm-summary.toon` is older than the graph, so this reads the per-path digests only. The session's candidate set is the parent feature's `links.code`, `src/release/run-command.ts`: community c87 beside `preflight-fix.ts`, `clean-tree.ts` and `auto-restamp.ts`, with cross-community edges to `preflight-probes.ts` [c21], `preflight.test.ts` [c78], `release-cr-gate.ts` [c90] and `release-version.ts` [c23]. This enhancement does not touch it.

The files it does touch are interior. `vitest.config.ts` (c213) and `vitest.setup.ts` (c214) have no god nodes and no cross-community edges. `route-sweep.test.ts` sits in c18 with `server.ts` and the other dashboard tests (edges to `startServer()` [c20] and `architecture-schema.ts` [c38]); `sdd-report.test.ts` sits in c13 with `sdd-report.ts`, `graph-fd-lookup.ts` and `triage-list-untriaged.ts` (edges to `fd-load.ts` [c16], `parse-blocks.ts` [c27], `feature-schema.ts` [c2], `sdd-report-format.ts` [c12] and `extractSpecSlug()` [c143]). No god node anywhere in the set: the change is contained to test infrastructure, and no product code depends on it. The one new edge is `src/testing/suite-lock.ts` importing `isAlive` from `src/autonomous/drain-lock.ts`.

### U1 — The reproduction, written down

The recipe goes in the parent FD's Usage, as a documented command rather than a new script: start three `NOLDOR_SUITE_LOCK=0 pnpm exec vitest run --reporter=json --outputFile=<dir>/suite-<n>.json` at once, wait for all three, then read each report's failed entries (`testResults[].assertionResults[]` with `status: "failed"`) with their `duration`. The numbers in *Problem* are the baseline it should reproduce on this machine.

The part a reader gets wrong is the classification, so the recipe states it outright: a failure whose first `failureMessages` line is `Error: STACK_TRACE_ERROR`, thrown from vitest's `chunk-hooks.js`, is a **timeout** — vitest 3.2.4 builds that error when the test is defined (to capture its location) and only rewrites the message when the timer fires, and the JSON reporter prints the stack. Anything else is an assertion or a thrown error. A timed-out test that ran synchronous work (`execSync`) reports a duration above the bound — 14.5s against 10s — because vitest cannot interrupt it and marks it failed when it returns.

### U2 — One full suite at a time, across worktrees

A vitest `globalSetup` (new `src/testing/suite-lock.ts`, wired from `vitest.config.ts`) takes an exclusive lock before any worker starts and drops it in teardown. The lock is one file, `noldor-suite.lock`, in the git common dir (`git rev-parse --path-format=absolute --git-common-dir`, the call `src/dashboard/identity.ts` already makes), which every worktree of the repo shares — so a drain child, a worktree session and a reviewer lane all queue on the same file. Its payload is `{ pid, startedAt, worktree }`, so a waiting suite can say who it is waiting for.

The acquire is new code, not `src/autonomous/drain-lock.ts`'s `acquireLock`, for two reasons. That function hardcodes `.noldor/drain.lock` under its `cwd`, and it creates the file with `openSync(path, 'wx')` and only then writes the payload — so a reader arriving between the two calls sees an empty file, parses nothing, treats the holder as dead and reclaims a live lock. The drain supervisor rarely starts twice at once; three suites starting together is exactly this feature's scenario. So the suite lock writes its payload to a temp file beside the lock and hard-links it into place (`linkSync`): the link either fails with `EEXIST` or publishes the file with its content in one step, and a lock is never seen without its payload. A dead holder is reclaimed the way the drain lock does it — rename the stale file aside, so only one reclaimer wins, then link again. Only `isAlive` (the pid probe) is imported from `drain-lock.ts`; the drain lock itself does not change, and its own window is captured in `ideas.md`.

A suite that finds the lock held by a live pid prints the holder once, then polls about once a second. The wait is bounded at 15 minutes — several full suites' worth — and past it the suite runs anyway with a loud warning, so the lock can never hang or fail a run. For the same reason it fails open: outside a git checkout, or when the lock cannot be created (a filesystem without hard links, a read-only `.git`), the suite runs unlocked and says so. `NOLDOR_SUITE_LOCK=0` skips it on purpose, so U1's recipe can still reproduce the flake after this ships.

The lock is re-entrant within one process and cleans up after a crash. vitest runs global setup once per project, so a future multi-project config would call this setup twice in the same process; a lock whose payload names this process's own pid passes straight through, and only the call that took the lock releases it, in its teardown — which vitest runs after the whole run has finished. If setup or the run dies before teardown, a `process.once('exit')` handler removes the lock when this process still owns it, and a process killed outright leaves a dead pid that the next suite reclaims.

Only a **full** run takes the lock. A run with file filters (`vitest run src/foo.test.ts`, the everyday dev loop) never waits, and neither does watch mode, which would otherwise hold the lock for as long as it stays open. Both facts come from what vitest itself parsed, not from re-reading `process.argv`: `globalSetup` receives the `TestProject` (vitest 3.2.4 calls `setup(project)` in `_initializeGlobalSetup`), `project.config.watch` is the watch flag, and `project.vitest.filenamePattern` holds the filters — set in `Vitest.start()` before global setup runs (`undefined` when there are none), but marked internal. So a test pins the behaviour, not just the field: a one-test fixture project whose `globalSetup` is this module is run through the real vitest CLI twice, filtered and unfiltered, and its test records whether the lock existed while it ran — `true` for the full run, `false` for the filtered one. A vitest upgrade that renames or repurposes the field then fails that test instead of silently changing who waits. A big filtered run — a whole directory — is exempt too and can still collide with a full suite; that is accepted, because every collision on record is between full suites.

### Testing

The lock gets unit tests over a temp dir: acquire, wait-then-acquire when a live holder releases, reclaim a dead holder, the bounded wait, re-entry from the same pid, the exit-handler release, the filtered-run and watch exemptions, and the env escape hatch. Simultaneous starts get their own test: several child processes try to acquire at the same instant, and exactly one may hold the lock. The vitest pin is the fixture run described in U2.

The end-to-end proof is U1's recipe run twice after the change. With the lock, each run's test interval — its JSON report's earliest file `startTime` to its latest `endTime` — must begin after the previous run's ends, with no timeouts. With `NOLDOR_SUITE_LOCK=0`, the timeouts must come back. Both results, with the three intervals and the lock's wait lines, go in the implementing commit's message.

## Acceptance criteria

1. The parent FD's Usage holds the reproduction recipe, the baseline numbers, and the `STACK_TRACE_ERROR` classification note.
2. Three concurrent full `vitest run`s on the dev machine all pass with the lock, with no timeouts, and their test intervals (earliest file start to latest file end in each JSON report) do not overlap. The intervals are recorded in the implementing commit's message.
3. With `NOLDOR_SUITE_LOCK=0`, the same three runs still reproduce the timeouts — the fix does not erase the reproduction.
4. A run with file filters, and a watch-mode run, never wait for the lock. The filter check is pinned against the installed vitest, so an upgrade that changes what `filenamePattern` holds fails a test.
5. A suite finding the lock held by a live pid waits and names the holder; a lock held by a dead pid is reclaimed; several suites starting at the same instant leave exactly one holder.
6. The wait is bounded; past the bound the suite runs with a warning, and the lock never fails or hangs a run — including when it cannot be created.
7. The lock is released on teardown, including after a run with failing tests; a second setup call from the same process does not wait on its own lock; a process that exits without teardown does not leave a lock behind.
8. `pnpm verify` is green.

## Risks / trade-offs

- **Queuing trades total throughput for results that mean something.** Measured with the lock in place: three runs started together finished at 57s, 126s and 194s, all green; competing, all three finished at 151s with 8–11 reds each. The first two finish sooner, the last about 43s later — one suite keeps roughly 7.5 of the 18 cores busy, so running suites side by side does use cores a lone suite leaves idle. It uses them by stretching every test, which is the flake.
- **The wait counts against outer deadlines.** A drain child's iteration budget (30 minutes for XS, scaled up by `sizeToTimeoutMs`) and any lane that runs `pnpm test` under its own timeout keep counting while a suite queues. A normal wait is the suites ahead times ~50s; the 15-minute bound is reached only behind a hung holder or a reused pid, and that case now spends up to half an XS iteration waiting instead of going red.
- **The lock sees only this repo's suites.** Typecheck, builds, a browser or charuy's tests still add load, and the slowest test has 3.3s of room when one suite runs alone. If that ever runs out, it shows up as a timeout with the lock in place — a new finding, not this one.
- **Filtered runs are not queued.** A directory-sized filtered run beside a full suite can still stretch both. Accepted: the dev loop must never wait, and no filtered collision has been observed.
- **The filter check reads a vitest internal.** `filenamePattern` is marked internal in 3.2.4. The pinning test turns a rename into a red test at upgrade time instead of a silent change in who waits. It costs two small vitest CLI runs of a fixture project, so it sits in the slower part of the suite itself.
- **route-sweep's original reds are matched, not replayed.** The 2026-08-20 runs left no record to compare against; what is observed is route-sweep timing out under the same load that times out the tests sharing its loaders. If it fails with the lock in place, the mechanism is not the whole story.
- **A killed suite leaves a stale lock** until the next suite reclaims it by pid. If the OS has handed that pid to an unrelated live process, the lock looks held: the next suite waits out the 15-minute bound and then runs with the warning. Slow, never stuck — and the warning names the pid, so the stale file is easy to delete.
- **A nested full run would wait on its parent.** A test that spawned this repo's own unfiltered `vitest run` would sit behind the lock its parent holds until the bound. No test does that today (`test:e2e:drain` is a filtered run), and a filtered spawn is exempt.
- **The recipe's numbers are machine-specific.** 18 cores reproduced at three suites; a smaller machine reproduces at two, a bigger one may need four.

## User Story

As an engineer or agent running `pnpm test` while another suite runs in a second worktree, I want my suite to wait its turn instead of fighting for the same cores, so that a red test means a broken test, not a busy machine.

## Usage

`pnpm test` works as before. When another full suite of this repo is running, it prints who holds the suite lock and starts when that suite finishes. `vitest run <file>` and watch mode never wait. `NOLDOR_SUITE_LOCK=0 pnpm test` skips the lock.

To reproduce the original flake, run three suites at once with the lock off and read the JSON reports; the parent FD's Usage has the exact commands and how to tell a timeout from an assertion.

## Open questions (resolved)

1. *Is the flake shared live state or machine load?* -> Load: oversubscription from concurrent suites. (D1) Three concurrent suites went red 3 of 3 times, and a full run wrote zero files to the live tree.
2. *What did a red run actually report?* -> Timeouts, for every sdd-report and dashboard failure; one unrelated assertion. (D2) The `STACK_TRACE_ERROR` stack is vitest's timeout error, built before its message is set.
3. *Queue suites, or give the heavy tests bigger budgets?* -> Queue. (D3) Budgets only move which test crosses the line next; queuing removes the cause for every test.
4. *Where does the lock live?* -> In the git common dir. (D4) Every worktree shares it, and it can never be committed or need a `.gitignore` line.
5. *Which runs take the lock?* -> Full `vitest run` only. (D5) Filtered runs are the dev loop and must never wait behind a ~50s suite; watch mode would hold the lock forever. Every recorded collision is between full suites.
6. *Wait forever, or bounded?* -> Bounded, then run with a warning. (D6) A lock that can hang or fail a run is worse than the flake.
7. *A script for the reproduction, or a recipe?* -> A recipe in the FD's Usage. (D7) It is run rarely, and the one fiddly part — telling a timeout from an assertion — is stated in the recipe itself.
8. *Does route-sweep need its own change?* -> No. (D8) It times out under the same load as the tests that share its loaders, and the lock covers them all.
9. *Raise the global `testTimeout`?* -> No. (D9) Q-0171's reasoning: it hides the next regression and lets bounds disagree again.
10. *Should the slowest tests also get more room when one suite runs alone?* -> No. (D10) Nothing has failed alone; sharing a run moves it into an equally bounded hook, and a raised per-test bound is the budget approach D3 rejected.
11. *Reuse the drain lock's `acquireLock`, or write a new acquire?* -> A new acquire in `suite-lock.ts`, importing only `isAlive`. (D11) `acquireLock` hardcodes `.noldor/drain.lock` and writes its payload after the create, a window simultaneous starts would hit; changing it would put the drain supervisor's lock at risk for a test-infrastructure change.
12. *How is a lock never seen without its payload?* -> Write the payload to a temp file and hard-link it into place. (D12) `link` fails with `EEXIST` when a lock exists and otherwise publishes the file with its content in one step.
13. *What if one process runs the setup twice, or dies before teardown?* -> Its own pid passes through, the last teardown releases, and an exit handler removes a lock the process still owns. (D13) vitest runs global setup once per project, so a multi-project config would otherwise wait on itself; a killed process leaves a dead pid the next suite reclaims.
