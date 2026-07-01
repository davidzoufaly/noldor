# Consumer-Contract CI and Headless Gate E2E Harness — Design

**Slug:** consumer-contract-ci-and-headless-gate-e2e-harness
**FD:** docs/features/consumer-contract-ci-and-headless-gate-e2e-harness.md
**Date:** 2026-06-13
**Tier:** full
**Deps:** none (pairs with the existing `real-codex-integration-smoke-test` roadmap entry; doubles as the test bed for `version-aware-upgrade-and-migration-chain`)

## Problem

The repo has 164 unit-test files and **zero** end-to-end coverage of the flows autonomy actually depends on:

- the skill-markdown gate paths (`.claude/skills/gate/SKILL.md` + the markers in `src/core/session.ts`),
- the drain loop against a real git repo (`src/autonomous/drain-loop.ts` → `drain-io.ts` → `registry.ts`),
- `noldor init` / `noldor doctor` / `noldor validate` against a real consumer tree.

The PR #33 bug class — the headless gate silently ignoring env-only directives, so a directive that did not ride the prompt was dropped — lived **exactly** in this blind spot and shipped broken. The fix is now codified as a rule in `src/core/agent-runner/registry.ts` (`Directives ride the prompt, never env/flags`), but nothing exercises it end-to-end. Every drain-loop test today mocks `spawnAgent` directly (e.g. `src/autonomous/__tests__/run-drain.test.ts`), so the wiring between a real `noldor autonomous run` subprocess, a real git repo, and a real gate session is never asserted.

Two distinct risks, one missing harness:

1. **Contract risk** — a framework change (config field rename, template drift, CLI exit-code regression) silently breaks downstream consumers, who only find out after upgrading.
2. **E2E risk** — an autonomous path (drain success oracle, marker writes, scope validator, salvage) regresses without any test catching a PR-#33-class bug.

## Goals

- A **fixture consumer repo** generated on the fly into a temp dir by a builder util — the *contract*. Minimal single-package TS app with `.noldor/config.json`, tiny `src/`, `docs/` skeleton, one seeded XS roadmap entry, lefthook wired, a real git repo with an initial commit.
- A **contract CI lane** (`pnpm test:contract`): install the framework *from the working tree* (`pnpm pack` → install tarball) into the fixture, run `noldor init`, `noldor doctor`, `noldor validate features`, `noldor garden detect`; assert exit codes + key artifacts. Green locally in < 5 min.
- A **headless flow lane** (`pnpm test:e2e:drain`): drive `noldor autonomous run --source roadmap --max-features 1` against the fixture and assert **outcomes** — roadmap entry retired, commit carries `Noldor-Path: fast-track` + `Noldor-Reviewed-*` trailers, branch merged, worktree cleaned — plus marker/scope-validator probes and failure-path probes (dirty main, `drain.lock` present, stale `fast/<slug>` branch).
- A **hermetic agent-call seam**: a `stub` runner registered in `src/core/agent-runner/` that performs deterministic, canned, per-slug gate work so CI is free + offline. One opt-in `NOLDOR_RUN_REAL_AGENT=1` lane runs a real model for true end-to-end (same gating pattern as `real-codex-integration-smoke-test`).
- Wire both lanes into `.github/workflows/` and document them in `docs/noldor/script-catalog.md` + `docs/noldor/testing-principles.md`. On failure, print the fixture-repo `git log` + `.noldor/` state.

## Non-goals

- Not the real-model lane's content (that pairs with `real-codex-integration-smoke-test`; this entry only builds the gating seam + one smoke invocation).
- Not the migration-chain codemods (`version-aware-upgrade-and-migration-chain` consumes this fixture later; out of scope here).
- Not adoption docs (the fixture *enables* them; writing them is separate).
- Not multi-runner e2e (stub + one real lane only; codex/opencode e2e is future).
- No new drain-loop behavior — the harness asserts existing behavior, it does not change it.

## Design

### Unit 1 — Fixture consumer builder (`src/testing/consumer-fixture.ts`)

`buildConsumerFixture(opts?: { dir?: string; seedSlug?: string }): ConsumerFixture` — generates a minimal consumer into a `mkdtempSync(join(tmpdir(), 'noldor-fixture-'))` dir (matching the established temp-git pattern in `src/core/__tests__/rollout-marker.test.ts`). Generated-on-the-fly, **not** an in-repo `fixtures/` tree — avoids fixture rot and `.git`-in-`.git` issues (D1).

Writes:

- `.noldor/config.json` — a `consumer:` block satisfying `ConsumerConfigSchema` (`src/core/consumer-config.ts`): `name`, `repoUrl`, `lockstepPackages: []`, `scanPaths: ['src']`, `e2ePrefix`, `samplesPath`, `packagePrefix`, `pnpmStderrPrefix`, `appPathPrefix`, `categories: ['Tooling']`. Plus an `agents:` block (`agentsConfigSchema`, `src/core/agent-runner/types.ts`) with `default: 'stub'` and `targets: ['stub']` so the drain resolves to the hermetic runner (Unit 4). Plus an `autonomous:` block satisfying `assertConfig` in `src/autonomous/queue-drain.ts`: `onFailure: 'abort'`, `skipLanePicker: true`, `requireHumanPrApproval: false`.
- `src/index.ts` — a one-line TS module so `scanPaths` is non-empty.
- `docs/vision.md`, `docs/roadmap.md`, `docs/ideas.md` skeletons. `docs/roadmap.md` carries one seeded schema-C XS roadmap entry (the drain target).
- `lefthook.yml` referencing the framework's pre-commit jobs.
- An initial commit on `main` (`git init -q -b main`, `git add -A`, `git commit`).

Returns `ConsumerFixture { dir, seedSlug, git(args): string, cleanup(): void, dumpState(): string }`. `dumpState()` returns `git log --oneline -20` + a recursive listing of `.noldor/` for failure debuggability (Unit 6).

### Unit 2 — Contract CI lane (`src/testing/contract-harness.ts` + `scripts/test-contract.mjs`)

`installFrameworkTarball(fixtureDir: string): void` — runs `pnpm pack` in the repo root to produce `noldor-<version>.tgz`, then `pnpm add ./<tarball>` (or `npm i` of the tarball) inside the fixture. This installs the framework **from the working tree**, so any PR breaking the consumer contract fails before merge.

`runContractChecks(fixtureDir): ContractResult` drives, asserting exit code + key artifact per step:

1. `noldor init` (leaf, `src/cli/commands/init.ts`) → exit 0; assert template files landed (`.claude/skills/`, `lefthook.yml` managed lines).
2. `noldor doctor` (`src/cli/commands/doctor.ts`) → exit 0 on a freshly-inited tree (template diff clean + runner floors); the stub runner registered in Unit 4 must pass doctor's Phase 2 presence check.
3. `noldor validate features` (`src/features/validate-features.ts`) → exit 0.
4. `noldor garden detect` (`src/garden/garden-detect.ts`) → exit 0 (no drift on a clean fixture).

A negative probe: rename a field in the fixture's `.noldor/config.json` consumer block → assert `noldor doctor` (or `loadConsumerConfig`'s Zod parse) exits non-zero. This is the acceptance teeth: "intentionally breaking `consumer-config.ts` field name fails the contract job."

### Unit 3 — Headless flow lane (`src/testing/__tests__/drain-e2e.test.ts`)

vitest suite (`// @tests: consumer-contract-ci-and-headless-gate-e2e-harness`) with an extended `testTimeout` (drain is multi-second). For each test, `buildConsumerFixture()`, install the tarball (or symlink the built `dist/` for speed — see D3), then spawn `node <fixture>/node_modules/.bin/noldor autonomous run --source roadmap --max-features 1` as a child process with `NOLDOR_RUN_REAL_AGENT` **unset** (→ stub runner via fixture config).

**Happy path** asserts outcomes, not transcripts:

- the seeded roadmap entry is retired from `docs/roadmap.md`,
- the merge commit on `main` carries `Noldor-Path: fast-track` + `Noldor-Reviewed-*` trailers (`git log --format=%B`),
- the `fast/<seedSlug>` branch is merged (`git branch --merged main`),
- the worktree is cleaned (`git worktree list` shows no `.worktrees/<seedSlug>`).

**Marker probes** (drive the gate paths directly, not via drain): write a `micro-chore` and a `fast-track` `SessionMarker` via `writeSession` (`src/core/session.ts`), stage matching + non-matching diffs, run `runPreCommit` (`src/hooks/noldor-pre-commit.ts`), assert the scope validator accepts/rejects per the allowlist rules.

**Failure-path probes** assert the loop surfaces/parks instead of corrupting state:

- **dirty main** — leave an uncommitted change, run drain → `syncMainCleanState` (`src/autonomous/drain-io.ts`) ff-only path aborts; assert non-zero exit + roadmap entry NOT retired.
- **locked drain** — pre-create `.noldor/drain.lock` via `acquireLock` (`src/autonomous/drain-lock.ts`) with a live PID; run drain → assert it refuses (lock held).
- **stale `fast/<slug>`** — create a stale `fast/<seedSlug>` branch behind main; run drain → assert salvage (`src/autonomous/salvage.ts` `detectStale`/`repair`) repairs rather than merging stale work.

### Unit 4 — Hermetic stub runner (`src/core/agent-runner/runners/stub.ts` + `src/testing/stub-gate.ts`)

Extend the runner registry rather than bolting on a parallel env path (D2) — keeps the seam consistent with `claude`/`codex`/`opencode` and respects the PR-#33 rule (slug rides the prompt, parsed there; no env directive).

- `src/core/agent-runner/types.ts`: add `'stub'` to `RUNNER_NAMES`.
- `src/core/agent-runner/capabilities.ts`: add a `CAPABILITIES.stub` entry (`structuredOutput: 'prose'`, `sandbox: 'none'`, `supportsLocalModels: true`, `questionSuppression: 'flag'`, `rulesFile: 'CLAUDE.md'`).
- `src/core/agent-runner/runners/stub.ts`: `export const STUB_BIN = process.execPath` and `buildStubArgv(prompt, opts)` pointing at the in-repo executable `bin/noldor-stub-gate.mjs` (which loads `src/testing/stub-gate.ts` via tsx, mirroring `bin/noldor.mjs`). Prompt rides argv.
- `src/core/agent-runner/registry.ts` `planSpawn`: add the `case 'stub'` arm.
- `src/testing/stub-gate.ts`: the canned implementer. Parses the slug from the gate prompt / `$PWD`'s session marker, looks up a canned plan under `src/testing/fixtures/canned/<slug>.json` (deterministic file edits + commit message), performs the scripted fast-track gate work in the worktree: writes the canned file change, writes the `fast-track` `SessionMarker` (`writeSession`), commits with `Noldor-Path: fast-track` + `Noldor-Reviewed-*` trailers, retires the roadmap entry, pushes the branch / opens the PR (or marks it open for the `openPrExistsFor` oracle). Exit 0 on success. Because it produces the *same artifacts* a real `/gate` fast-track run would, the drain's existing success oracle in `drain-loop.ts` passes unchanged.

A missing canned fixture for the requested slug → exit non-zero with a clear message, so an unstubbed slug fails loudly rather than hanging.

### Unit 5 — Real-agent opt-in lane

`NOLDOR_RUN_REAL_AGENT=1` flips the fixture's `agents.default` from `'stub'` to `'claude'` (or `agents.roles.implementer.runner`) before the drain spawns, so the same harness runs a real model end-to-end. Default CI leaves it unset (hermetic + free). A nightly/manual workflow sets it — same gating pattern as the `real-codex-integration-smoke-test` roadmap entry's `NOLDOR_RUN_REAL_CODEX=1`. Skipped tests `log` what was skipped (no silent truncation).

### Unit 6 — CI wiring + docs

- `.github/workflows/contract-e2e.yml`: two jobs — `contract` (Unit 2) and `drain-e2e` (Unit 3), both on PR. Each job's failure step runs `node -e` / a script that prints `ConsumerFixture.dumpState()` output (fixture git log + `.noldor/` state). A third `nightly` job (cron) sets `NOLDOR_RUN_REAL_AGENT=1`.
- `package.json` scripts: `test:contract` → `scripts/test-contract.mjs`; `test:e2e:drain` → `vitest run src/testing/__tests__/drain-e2e.test.ts`.
- `docs/noldor/script-catalog.md`: a `## Testing harness` section documenting `test:contract` + `test:e2e:drain` in the page's per-command format (Trigger / Inputs / Outputs / When to use / Source).
- `docs/noldor/testing-principles.md`: extend the Layers table / add a "Framework self-test" note explaining the fixture-consumer + headless-drain harness and the stub seam.

## Acceptance criteria

- `pnpm test:contract` runs green locally in < 5 min: builds the fixture, `pnpm pack` + installs the tarball, runs `init`/`doctor`/`validate features`/`garden detect`, all exit 0, key artifacts asserted.
- Renaming a `consumer:` field in the fixture's `.noldor/config.json` (simulating a `consumer-config.ts` field rename) makes the contract job exit non-zero.
- `pnpm test:e2e:drain` happy path: after `noldor autonomous run --source roadmap --max-features 1` against the fixture, the seeded roadmap entry is retired, the merge commit carries `Noldor-Path: fast-track` + `Noldor-Reviewed-*` trailers, `fast/<slug>` is merged into `main`, and no `.worktrees/<slug>` remains.
- Marker probes: a `micro-chore` session accepts a `docs/**/*.md` staged diff and rejects an out-of-allowlist `src/` diff via `runPreCommit`; a `fast-track` marker is written and read back by `readSession`.
- Failure probes: dirty-main aborts with the entry NOT retired; a live `drain.lock` makes the drain refuse; a stale `fast/<slug>` branch triggers salvage rather than merging stale work.
- The `stub` runner is registered (`RUNNER_NAMES`, `CAPABILITIES`, `planSpawn` arm) and `noldor doctor` passes on the fixture with `agents.default: 'stub'`.
- `NOLDOR_RUN_REAL_AGENT=1` flips the fixture to a real runner; unset CI is hermetic (no network, no model spend).
- `.github/workflows/contract-e2e.yml` runs both lanes on PR and prints fixture state on failure; `script-catalog.md` + `testing-principles.md` document the harness.

## Risks / trade-offs

- **Adding `'stub'` to `RUNNER_NAMES` ripples** through strict Zod schemas (`agentsConfigSchema`), `CAPABILITIES` (typed `Record<RunnerName, …>`), `planSpawn`'s exhaustive switch, and `doctor`'s version-floor map. Mitigation: TypeScript's exhaustiveness + the strict schema make every missed site a compile error; the plan touches each in one task.
- **`pnpm pack` + install is slow** (tarball build + install per run) — threatens the < 5 min budget. Mitigation: pack once per test run (module-scoped fixture in vitest `beforeAll`), reuse across cases; D3 allows symlinking `dist/` for the drain lane where install fidelity is less critical than the contract lane.
- **Drain e2e is inherently multi-process** (child `noldor` spawn + git + gh) — flake risk. Mitigation: stub runner is deterministic; assert outcomes via git state with no wall-clock sleeps (testing-principles flake policy); `gh` calls are the residual risk — see D4.
- **`gh`-dependent steps** (`mergePr`, `openPrExistsFor` in `drain-io.ts`) need a stubbed/local merge in CI. Mitigation: D4 — inject a local fast-forward merge in place of `gh pr merge` for the fixture, since the fixture has no GitHub remote.
- **Stub drift**: the stub gate could diverge from real `/gate` behavior, giving false confidence. Mitigation: the `NOLDOR_RUN_REAL_AGENT=1` nightly lane is the backstop — it runs the same assertions against a real model.

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

## Open questions (resolved)

1. _In-repo `fixtures/consumer/` tree vs generated-on-the-fly into a temp dir?_
   -> **Generated on the fly** via `buildConsumerFixture` into `mkdtempSync`. Avoids fixture rot and `.git`-in-`.git` issues; matches the existing temp-git test pattern in `rollout-marker.test.ts` (D1).

2. _How is the agent-stub seam injected — env var + stub binary on PATH, vs a `DrainSource`-style interface?_
   -> **A `stub` runner registered in the existing agent-runner registry**, opted into via the fixture's `agents.default: 'stub'` config. Reuses the runner abstraction already used by `claude`/`codex`/`opencode`, keeps the slug riding the prompt (PR-#33 rule), and needs no parallel env-var code path. The slug→canned-plan lookup lives in `src/testing/stub-gate.ts` (D2).

3. _Install the framework via `pnpm pack` tarball, or symlink the built `dist/`?_
   -> **Tarball for the contract lane** (true install fidelity — that's the contract being tested); **symlink/`pnpm add ./dist` allowed for the drain e2e lane** where install fidelity matters less than wall-clock. Pack once per run, reuse (D3).

4. _How do `gh`-dependent drain steps (`mergePr`, `openPrExistsFor`) work against a fixture with no GitHub remote?_
   -> **Inject a local merge adapter**: in the e2e harness, override the `DrainDeps.mergePr`/`openPrExistsFor` IO adapters (the seam already exists in `drain-loop.ts`) with a local fast-forward merge of `fast/<slug>` into `main`. No real `gh` calls; the success oracle still sees a merged branch (D4).

5. _Where does the standalone repo's CI workflow file live?_
   -> **`.github/workflows/contract-e2e.yml`** in this repo (no `.github/workflows/` exists yet — this entry creates the dir). Two PR jobs (`contract`, `drain-e2e`) + one cron `nightly` job for the real-agent lane (D5).
