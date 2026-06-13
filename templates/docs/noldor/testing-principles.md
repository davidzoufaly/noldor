---
noldor-page: testing-principles
introduced: 0.4.0
---

# Testing

The framework recognizes four test layers, one CI gate, and a tag convention
that ties tests back to feature MDs.

## Layers

| Layer       | Tool (consumer's choice)       | Location (consumer-configured)              | What it tests                                          |
| ----------- | ------------------------------ | ------------------------------------------- | ------------------------------------------------------ |
| Unit        | the repo's test runner         | alongside source under the `scanPaths`      | Pure logic, isolated modules                           |
| Component   | test runner + component harness| alongside the UI source (if the repo has UI)| Components with state, interactions, conditional render |
| E2e         | a browser/integration runner   | under the configured `e2ePrefix`            | User/agent journeys against a running app              |
| Smoke       | the e2e runner (`@smoke` tag)  | under the configured `e2ePrefix`            | Public-surface shape + minimal round-trip              |

The framework is test-runner-agnostic — it does not mandate a specific tool.
It only relies on the `// @tests:` tag convention and the layer discipline
below; pick whatever unit/component/e2e runners suit the consumer's stack.
Rendering that a headless DOM can't meaningfully exercise (Canvas/WebGL,
native widgets) belongs in the e2e layer, not the component layer.

### Framework self-test

Beyond the unit suites, the framework tests *itself* against a generated
consumer. A temp-dir fixture builder (`src/testing/consumer-fixture.ts`) writes
a minimal real-git consumer repo — `.noldor/config.json`, a tiny `src/`, a docs
skeleton, and one seeded XS roadmap entry — and two lanes drive it:

- **Contract lane** (`pnpm test:contract`): packs the working tree (`pnpm pack`),
  installs the tarball into the fixture, and asserts `init` / `doctor` /
  `validate features` / `garden detect` all exit 0. Any framework PR that breaks
  the CLI contract fails here — downstream consumers are protected without being
  in the loop.
- **Headless-flow lane** (`pnpm test:e2e:drain`): drives the real drain/gate flow
  non-interactively and asserts *outcomes* (roadmap entry retired, commit
  trailers present, failure probes hold), not transcripts. This is the regression
  net for the PR-#33-class bug (a headless gate silently ignoring env-only
  signals) that shipped broken because nothing drove the flow end-to-end.

The flow lane is hermetic via the `stub` agent runner: the fixture's
`agents.default: 'stub'` resolves to an in-repo entrypoint
(`bin/noldor-stub-gate.mjs`) that performs scripted, canned fast-track work keyed
by slug — no LLM, no network, free + deterministic in CI. One opt-in nightly lane
runs a real model (`NOLDOR_RUN_REAL_AGENT=1`) for true end-to-end coverage. Both
lanes are wired in `.github/workflows/contract-e2e.yml`; see
[script-catalog.md](./script-catalog.md#testing-harness) for the per-command reference.

## Fixtures

Keep shared, reusable test fixtures in one place the consumer owns (e.g. a
`test-fixtures` package or directory) rather than duplicating setup across
suites. Prefer small, named, deterministic factories over ad-hoc inline data,
and a `seedRandom(n)` / `restoreRandom()` pair for anything that touches
`Math.random`.

## The `// @tests:` convention

Every test file carries a tag comment as its first non-import line:

```typescript
// @tests: undo-redo, state-management
import { describe, it, expect } from 'vitest';
```

Slugs are kebab-case feature slugs matching `docs/features/<slug>.md`
filenames. Multi-feature tests list every feature they exercise.

`pnpm noldor sync test-links` crawls tagged tests and writes `links.tests` arrays on
the corresponding feature MDs (path-sorted, deduped).

`pnpm noldor validate features` rejects any `@tests:` slug that has no matching
feature MD — catches typos and retired features.

Both run in the pre-commit hook. If `sync:test-links` modifies a feature MD,
re-stage the change before continuing the commit.

## Commands

The framework guarantees only the `noldor` CLI commands below. The `pnpm test*`
scripts are **consumer-defined conveniences** — declare whichever layers the
repo has; the release pipeline runs each only if it exists in `package.json`.

```bash
pnpm test                     # consumer: unit (+ component) suite
pnpm test:smoke               # consumer (optional): smoke suite
pnpm test:e2e                 # consumer (optional): full e2e suite
pnpm noldor sync test-links   # framework: rebuild feature MD links.tests from @tests: tags
pnpm noldor validate features # framework: schema + @tests: cross-check
```

## CI gates

| Event                    | Lanes                                                                       |
| ------------------------ | --------------------------------------------------------------------------- |
| Pre-commit               | `noldor sync test-links` + `noldor validate features` (+ the consumer's hook jobs) |
| Pre-push (`pnpm verify`) | the consumer's composite gate (e.g. `lint && fmt:check && typecheck && test`) |
| Release precondition     | framework checks (always) + the consumer's declared `test*`/`build`/`docs:build` (if present) |

## Flake policy

Playwright config sets `retries: 2` on CI, `retries: 0` locally. On flake:
open the `trace.zip` from the failed attempt, fix the root cause. Don't add
local retries to paper over non-determinism.

Determinism practices:

- **No arbitrary sleeps** — use `expect.poll()` or Playwright's
  auto-retrying assertions (`toBeVisible`, `toHaveText`).
- **Wait on app-level signals** — expose a deterministic readiness/state hook
  on the app (e.g. a `window.__appReady` flag or a state-query method) and wait
  on it rather than on wall-clock time.
- **Seed randomness** — a `seedRandom(n)` fixture in unit/component; in
  browser e2e, inject a seeded PRNG at page creation (e.g. Playwright
  `page.addInitScript`).

## Coverage

`pnpm test:coverage` generates an HTML report in `./coverage/`. No
threshold gate — coverage is a signal for where more tests might help, not a
quota.

## Adding a new test

1. Decide the layer (unit → component → e2e → smoke, smallest that catches
   the bug).
2. Write the test, tag it with `// @tests: <slug>` at the top.
3. Reuse shared test fixtures where a canned input works.
4. Follow determinism practices — especially in e2e / smoke.
5. `pnpm noldor validate features` passes; commit.
