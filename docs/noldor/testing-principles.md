---
noldor-page: testing-principles
introduced: 0.4.0
---

# Testing

Charuy has four test layers, one CI gate, and a tag convention that ties tests
back to feature MDs.

## Layers

| Layer       | Tool                              | Location                                                  | What it tests                                                               |
| ----------- | --------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| Unit        | Vitest                            | `packages/*/src/__tests__/`, `apps/web/src/**/__tests__/` | Pure logic, isolated modules                                                |
| Component   | Vitest + `@testing-library/react` | `apps/web/src/**/__tests__/*.test.tsx`                    | Non-Canvas React components with state, interactions, conditional rendering |
| E2e         | Playwright                        | `apps/web/e2e/scenarios/`                                 | User/agent journeys in a real browser with WebGL + WASM                     |
| Agent smoke | Playwright (`@smoke` tag)         | `apps/web/e2e/smoke/`                                     | Agent-API surface shape + minimal round-trip                                |

R3F (Three.js via `@react-three/fiber`) Canvas rendering is **not** tested at
the component layer — JSDOM can't meaningfully render it. Canvas correctness
lives in e2e with SwiftShader-backed headless Chromium.

## Fixtures

Shared fixtures live in [`packages/test-fixtures`](../../packages/test-fixtures/):

- `loadScene('<name>')` — returns a validated `SceneNode` from a JSON golden
- `serializeScene(scene)` — round-trip helper
- `sceneWithNBoxes(n)` — parameterized factory (returns a group of N boxes)
- `seedRandom(n)` / `restoreRandom()` — deterministic `Math.random`
- `demoScene` — the scene the web app shows on first load

Fixture scenes: `empty-scene`, `single-box`, `simple-union`, `nested-group`,
`deep-tree`, `demo-scene`.

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

```bash
pnpm test              # all Vitest (unit + component) + script tests
pnpm test:smoke        # Playwright smoke suite (`@smoke` tag only)
pnpm test:e2e          # Playwright full suite (smoke + scenarios)
pnpm test:coverage     # Vitest with coverage report in ./coverage/
pnpm noldor sync test-links   # rebuild feature MD links.tests from @tests: tags
pnpm noldor validate features # schema + @tests: cross-check
```

## CI gates

| Event                              | Lanes                                                        | Target time |
| ---------------------------------- | ------------------------------------------------------------ | ----------- |
| Pre-commit                         | `sync:test-links` + `validate:features`                      | <5s         |
| Pre-push (`pnpm verify`)           | `pnpm test` + `pnpm test:smoke` + `pnpm test:e2e` (Chromium) | ≤6 min      |
| Release precondition               | All of the above                                             | ≤6 min      |
| Nightly (manual for now, CI later) | Full suite + WebKit + perf sweep                             | ≤15 min     |

## Flake policy

Playwright config sets `retries: 2` on CI, `retries: 0` locally. On flake:
open the `trace.zip` from the failed attempt, fix the root cause. Don't add
local retries to paper over non-determinism.

Determinism practices:

- **No arbitrary sleeps** — use `expect.poll()` or Playwright's
  auto-retrying assertions (`toBeVisible`, `toHaveText`).
- **Wait on app-level signals** — `window.__charuyFlush` for persisted state,
  `window.charuy.getScene()` (when agent-api ships) for in-memory state.
- **Seed randomness** — fixture `seedRandom(n)` in unit/component; Playwright
  `page.addInitScript` injects a seeded PRNG at page creation (see
  [`apps/web/e2e/setup.ts`](../../apps/web/e2e/setup.ts)).

## Coverage

`pnpm test:coverage` generates an HTML report in `./coverage/`. No
threshold gate — coverage is a signal for where more tests might help, not a
quota.

## Adding a new test

1. Decide the layer (unit → component → e2e → smoke, smallest that catches
   the bug).
2. Write the test, tag it with `// @tests: <slug>` at the top.
3. Use fixtures from `@charuy/test-fixtures` where a canned scene works.
4. Follow determinism practices — especially in e2e / smoke.
5. `pnpm noldor validate features` passes; commit.
