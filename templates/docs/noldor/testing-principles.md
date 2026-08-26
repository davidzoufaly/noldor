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

## The Deletion Test

The prime directive for every test in the repo:

> If the logic under test were deleted, or replaced with a trivial stub
> (`return []`, `return undefined`, `return true`), would this test still pass?

If it would, the test verifies nothing — rewrite it or delete it. A test that
cannot fail when the implementation breaks is worse than no test: it burns CI
time and manufactures confidence. Fewer real tests beat many fake ones.

What follows from it:

- **Cover the meaningful branches, not only the guard.** A function shaped
  `if (x) return []; return compute(...)` is not tested by asserting the `[]`
  branch alone — that assertion survives a gutted `compute`.
- **Expected values are independent literals**, never recomputed the way the
  implementation computes them. `expect(total(items)).toBe(42)`, not
  `expect(total(items)).toBe(items.reduce((s, i) => s + i.price, 0))`.
- **A test that never calls the code under test is banned.** One that only
  exercises fixtures and library helpers passes whatever this repo does.
- **Call assertions complement behavior assertions, never replace them.**

Test names state WHAT behavior holds, not HOW it is implemented, and a test
must not break when the implementation is refactored without a behavior change.

## Banned patterns

| Pattern | Why it is banned |
| ------- | ---------------- |
| **Tautology** — expected value derived the way the implementation derives it | Passes against any implementation, including a wrong one. |
| **Library-only assertion** — exercises a fixture and a third-party helper, never this repo's code | Tests the dependency, not the change. |
| **Mock echo** — asserting a mock returned what it was configured to return | Verifies the test's own setup. |
| **Call-only** — `toHaveBeenCalled*` as the sole assertion where observable output exists | Pins the call graph, not the behavior: breaks on refactor, survives wrong results. |
| **Snapshots** — `toMatchSnapshot` / `toMatchInlineSnapshot` | Break on every refactor and get blindly regenerated. Assert the properties that matter instead. |
| **`.only` / `.skip` / `.todo`** | A disabled or focused test is a hidden regression. Lint-bannable — see the pass below — and otherwise reviewer-enforced. Fix the test, or delete it and say so in the PR. |
| **Weakening an assertion to get green** — `toEqual(expected)` → `toBeDefined()` | If a correct assertion fails, the code or the setup is wrong. Report it; never assert less. |

`skipIf` on a genuine environment precondition (running as root, a build output
that is absent) is a scoped test, not a disabled one, and the pass below does
not flag it. State the condition inline so the scope stays reviewable.

### The one ban with a lint implementation

Only the disabled/focused-test ban is machine-checkable today. A repo that
wants it enforced rather than reviewed appends this second pass to its own
`lint` script — `init` does not write it, because the `lint` script is the
consumer's:

```bash
oxlint --vitest-plugin -A all \
  -D vitest/no-disabled-tests -D vitest/no-focused-tests -D vitest/warn-todo src
```

The framework's own repo runs exactly that as the second half of `pnpm lint`.
Narrow on purpose: `--vitest-plugin` unrestricted raised 476 findings across
six rules in the framework repo (221 `require-mock-type-parameters`, 132
`valid-title`, 59 `require-to-throw-message`, 58 `no-conditional-expect`, 5
`valid-expect`, 1 `expect-expect`) — a migration to schedule, not a gate to
turn on. The three denied rules are green there over the whole suite, so they
land as enforcement rather than as a ratchet; run the command before adopting
it and expect a different count.

Every other ban on this page has no lint implementation and is enforced by the
code-stage reviewer against two rules in the scoped rule store —
`.noldor/rules/test-real-behavior.md` and `.noldor/rules/test-mocking-boundaries.md`.
Both ship as `init` templates, both are `enforce: true`, and both are scoped
`src/**/*.test.ts` at the `code` stage, so they land in the ENFORCE bucket of
`noldor rules brief --file <a test file>` and in the reviewer's rule context.
A repo whose tests live elsewhere widens the `applies-to` glob.

## Mocking boundaries

Mock at **system boundaries only**. Never mock an internal collaborator — a
module the change itself owns. A test that mocks its own subsystem tests the
mock.

| Dependency | Approach |
| ---------- | -------- |
| A module in the same subsystem (relative import) | Never mock — use the real code |
| Filesystem | A real temp dir (`mkdtemp`), not an in-memory shim |
| Git | A real repo in a temp dir, or a scripted runner fake passed as a parameter |
| Schemas / parsers | The real schema, real fixtures |
| Subprocess / editor / spawn seams | A hand-rolled fake injected as a parameter |
| Time / randomness | `vi.useFakeTimers()`; for randomness, a seeded generator injected as a parameter |
| Network | Should not be reachable from unit-testable logic — extract the pure part rather than mocking `fetch` |

Prefer a **hand-rolled fake passed as a parameter** over `vi.mock`. A function
that is hard to test because it constructs its dependencies internally should
accept them instead — difficulty testing is a design signal, not a mocking
opportunity:

- Logic buried behind IO → extract the pure function and test that.
- Dependencies constructed internally → take them as parameters.
- Still stuck → say so in the PR. An honest gap is reviewable; a fake test
  hides it.

`vi.mock` of a relative path is the pattern to justify, not the default. Where
one is warranted — a dispatch seam that spawns a lane, for instance — keep it
to that seam and assert observable output on either side of it.

## Fixtures

Keep shared, reusable test fixtures in one place the consumer owns (e.g. a
`test-fixtures` package or directory) rather than duplicating setup across
suites. Prefer small, named, deterministic factories over ad-hoc inline data. Anything
that would reach for `Math.random` takes a seeded generator as a parameter
instead — there is no global seeding helper, and a test that patches the global
is mocking a boundary it does not own.

## House patterns

Copy the approach of these files rather than inventing new machinery.

- **Scripted-runner fake** — a `Record<prefix, result>` map compiled into a
  runner function and passed as a parameter, so each case scripts only the
  commands it cares about and every other key answers a benign default:
  `src/autonomous/__tests__/drain-branch-state.test.ts`. The fake is a plain
  function — no `vi.mock`, no module registry — so a case can wrap the base
  runner to vary one command and inherit the rest.
- **Real temp repo** — build an actual git repo under `mkdtemp` and run the real
  code against it: `src/design/__tests__/archive-cli.test.ts`.
- **Generated consumer fixture** — the framework's boundary tests build a real
  consumer repo instead of asserting against a canned string:
  `src/testing/consumer-fixture.ts` (see Framework self-test above).
- **Baseline-and-flip factory** — a `state(overrides)` helper returning a full
  set of working defaults, spread-merged with the override, so each case flips
  exactly one field and the diff between cases *is* the behavior under test:
  `src/autonomous/__tests__/status-cli.test.ts`. Every case there asserts
  returned or rendered output, not a call record — which is what makes it worth
  copying alongside the pattern itself.
- **Invariant assertions over exact output** — for algorithms and detectors,
  assert the property that must hold rather than a brittle exact shape. See
  Tuning a detector below.

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

**Fast-track work has no feature MD — never tag its tests.** A
`// @tests: <fast-track-slug>` tag makes `pnpm noldor validate features` fail
repo-wide (`unknown feature slug`) and blocks every commit until the tag is
removed. Only tag tests with slugs that have a `docs/features/<slug>.md`.

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
| Pre-push                 | framework hooks only: review-receipt enforcement, push-block, template-sync |
| CI (push/PR)             | `pnpm verify` — the consumer's composite gate (e.g. `lint && fmt:check && typecheck && test`) |
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
- **Seed randomness** — inject a seeded generator as a parameter in
  unit/component; in browser e2e, inject a seeded PRNG at page creation (e.g.
  Playwright `page.addInitScript`).

## Coverage

No coverage tooling is wired up — there is no `test:coverage` script and no
coverage provider installed. If a coverage report would help, add a vitest
coverage provider and run it ad hoc. Either way, no threshold gate — coverage
is a signal for where more tests might help, not a quota.

Quota-free is a deliberate posture, not an omission: a percentage target is met
most cheaply by the exact tests the Deletion Test bans. The bar is that every
test can fail; the count follows from that, never the other way round.

## Adding a new test

1. Decide the layer (unit → component → e2e → smoke, smallest that catches
   the bug).
2. Write the test, tag it with `// @tests: <slug>` at the top.
3. Reuse shared test fixtures where a canned input works.
4. Follow determinism practices — especially in e2e / smoke.
5. `pnpm noldor validate features` passes; commit.

## Tuning a detector

Tuning a detector is a corpus change, not a unit-test change. Measure the
detector's own counters (`groups` / `duplicatedTokens` for clones, gap counts
for garden detectors) before and after, and name one genuine finding that MUST
survive the tuning — otherwise a threshold change that silences everything
reads as a pass.

- **Derive fixtures from a live run, not from a roadmap entry's example.** The
  two clone matches Q-0122 was written against had already been refactored away
  by the time it shipped, so the fixtures had to be re-derived from a fresh
  `clones report --json`.
- **A negative fixture written too faithfully stops being negative.** The first
  "unrelated schemas" case shared field count and wrapper, differing only in
  name — a genuine Type-2 clone, so the test failed for the right reason.
