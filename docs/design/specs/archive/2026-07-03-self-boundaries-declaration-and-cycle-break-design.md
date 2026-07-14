# Self-Boundaries Declaration and Cycle Break — Design

**Slug:** self-boundaries-declaration-and-cycle-break
**FD:** docs/features/self-boundaries-declaration-and-cycle-break.md
**Date:** 2026-07-03
**Tier:** specs-only

## Problem

`pnpm noldor invariants run` reports 4/4 green, but the `boundaries` check is vacuous for Noldor itself: `makeBoundariesInvariant` (`src/invariants/boundaries.ts:23`) sources its forbidden rules from `loadConsumerConfig(repoRoot).boundaries`, and Noldor's own `.noldor/config.json` declares `"boundaries": []`. dependency-cruiser runs over `src/` with **zero rules**, so "passed" means "nothing was checked".

Meanwhile 4 real production cycles exist in the module graph (verified by grep on 2026-07-03):

1. **core ↔ cr** — `src/core/pr-flow-cli.ts:6-7` imports `../cr/config.js` (`loadConfig`, `NoldorConfig`) and `../cr/prompt-stdin.js` (`promptSelect`), while `src/cr/` imports core in at least 4 files (`deep-review-spawn.ts`, `bootstrap-immunity.ts`, `run-codex.ts`, `config.ts` itself imports `../core/agent-runner/types.js`). The repo-wide `.noldor/config.json` loader lives in `src/cr/config.ts` (209 lines) and is imported by 11 modules outside `src/cr/` (release, autonomous, hooks, garden, validate, core).
2. **features ↔ garden** — `src/features/{migrate-code-tags,fill-links-code-gaps,propose-pointers}.ts` import `loadSddFeatures`/`walkRepo`/`isInfraFile` from `../garden/sdd-report.js`, while `src/garden/{sdd-report,garden-detect,plan-resolution}.ts` import `FeatureFrontmatterSchema` from `../features/feature-schema.js`. `sdd-report.ts` (1214 lines) doubles as the shared FD-loading library.
3. **garden ↔ sync** — `src/garden/sdd-report.ts:8` imports `extractTags` from `../sync/sync-test-links.js` and `garden-detect.ts:28` imports `../sync/sync-code-links.js`, while `src/sync/sync-spec-links.ts:7` imports `extractSpecSlug` back from `../garden/sdd-report.js`.
4. **garden ↔ invariants** — `src/garden/garden-detect.ts:11` imports `makeInvariants`/`runInvariants` from `../invariants/index.js`, while `src/invariants/rule-conflicts.ts:4-6` imports `INVARIANTS` and the rule-pair `Invariant` type back from `../garden/garden-invariants.js`.

The framework preaches boundary discipline to consumers (vision.md: "boundary rules" live in the consumer block); it declares none for itself. Bonus debt: the Charuy-inherited `keyboard-binding` invariant (`src/invariants/keyboard-binding.ts`) checks `area: web` FDs against `docs/features/keyboard-shortcuts.md` — a UI concern with zero hits in a CLI framework — and is consistently the slowest check (275ms of a 275ms wall today; 922ms at audit time).

## Goals

- Break all 4 prod cycles so `src/` has an acyclic module graph with a documented layering direction.
- Declare real dependency-cruiser rules in `.noldor/config.json` `consumer.boundaries` so the `boundaries` invariant fails when a cycle or layering violation is reintroduced.
- Relocate the repo-wide config loader out of `src/cr/` into `src/core/`.
- Extract the FD-loading library out of `src/garden/sdd-report.ts` into core.
- Retire the `keyboard-binding` invariant from the built-in registry.

## Non-goals

- No new invariant plugins; only rule data + module moves.
- No behavior change to `loadConfig` / `loadSddFeatures` semantics — pure relocation.
- No dep-cruiser rules shipped as *defaults for consumers* (scaffold template stays `[]`; consumers opt in) — this entry only fills Noldor's own config.
- No refactor of `sdd-report.ts`'s detector functions (`detectCodeOrphans`, `buildGateComplianceSection`, …) — they stay in garden.
- No test-file boundary rules (`boundaries.ts` already excludes `__tests__|\.test\.ts$`).

## Design

Layering convention this entry establishes (top may import bottom, never reverse):

```
cli / hooks / autonomous / release / dashboard        (orchestration)
  → cr / garden / sync / features / invariants / …    (domain modules)
    → core / lib / utils / rules                      (foundation)
```

### Unit 1 — config loader relocation (breaks core ↔ cr)

- Move `src/cr/config.ts` → `src/core/config.ts` (no name clash; `src/core/` has no `config.ts`). It already imports `agentsConfigSchema` from `../core/agent-runner/types.js`, so the move shortens that edge.
- Its two cr-local deps come along: `src/cr/review-profile.ts` (34 lines, zod-only) → `src/core/review-profile.ts`; the `laneSchema` + `artifactKindSchema` enums move out of `src/cr/findings-schema.ts` into `src/core/config.ts` (or a tiny `src/core/lanes.ts`), and `findings-schema.ts` re-imports them from core (cr → core is the allowed direction).
- Move `src/cr/prompt-stdin.ts` (19 lines, depends only on `@inquirer/prompts`) → `src/core/prompt-stdin.ts` — it is a generic stdin prompt util, and it is `pr-flow-cli.ts`'s second core→cr edge.
- Update all importers (11 files outside `src/cr/` — `src/release/{index,release-publish,release-cr-gate}.ts`, `src/autonomous/{watch,queue-drain}.ts`, `src/hooks/noldor-pre-commit.ts`, `src/garden/{garden-detect,sdd-report}.ts` + `detectors/override-audit.ts`, `src/validate/noldor-config.ts`, `src/core/pr-flow-cli.ts` — plus cr internals). **No re-export shims** in `src/cr/` — a shim keeps the forbidden edge alive in the dependency graph.
- `DEFAULT_SESSION_TTL_HOURS`'s doc comment in `config.ts` ("lives here … so `session.ts` keeps no core → cr import edge") becomes obsolete — rewrite it; the constant may now sit beside `core/session.ts` consumers naturally.

### Unit 2 — FD-loading library extraction (breaks features ↔ garden AND garden ↔ sync)

- New module `src/core/fd-load.ts` extracted from `src/garden/sdd-report.ts`: `FeatureRecord`, `loadSddFeatures`, `walkRepo`, `isInfraFile`, `listSpecs`, `listPlans`, `extractSpecSlug`, `extractPlanSlug`, `readTextFiles`, plus the enforcement helpers they use (`MIN_ENFORCED_VERSION`, `compareSemver`, `isLinkEnforced`).
- Move `src/features/feature-schema.ts` → `src/core/feature-schema.ts` (`loadSddFeatures` depends on `FeatureFrontmatterSchema`; garden's three importers switch to core). This kills garden → features.
- Update importers: `src/features/{migrate-code-tags,fill-links-code-gaps,propose-pointers}.ts`, `src/sync/sync-spec-links.ts` (its `extractSpecSlug` import moves to core — kills sync → garden), `src/core/rename-plan-only-tier.ts`, `src/release/sdd-report-diff.ts`, `src/triage/triage-list-untriaged.ts`, `src/dashboard/{views,data}.ts`, `src/cli/manifest.ts`, plus garden internals.
- `sdd-report.ts` keeps its detectors, report assembly, and `main()`; it imports the loaders from core. Remaining garden → sync edges (`extractTags`, `sync-code-links`) are now one-directional — allowed.

### Unit 3 — rule-pair seed relocation (breaks garden ↔ invariants)

- Move `src/garden/garden-invariants.ts` → `src/invariants/rule-pairs.ts`; rename its exported `Invariant` interface to `RulePairInvariant` (avoids collision with `src/invariants/types.ts`'s architecture `Invariant`).
- Importers: `src/invariants/rule-conflicts.ts` (edge becomes module-internal) and `src/garden/garden-detect.ts:10` (edge becomes garden → invariants, same direction as its existing `makeInvariants` import at line 11).

### Unit 4 — boundary rules declaration

- Extend `BoundaryRuleSchema` in `src/core/consumer-config.ts` minimally: `from.path` becomes optional, `to` gains optional `circular: z.boolean()`, with a refine requiring at least one constraint per side used. This lets Noldor (and consumers) express dep-cruiser's canonical no-circular rule `{from: {}, to: {circular: true}}`, which `boundaries.ts` already forwards verbatim to `cruise(…, {ruleSet: {forbidden: [...boundaries]}})`.
- Fill Noldor's `.noldor/config.json` `consumer.boundaries` with:
  - `no-module-cycles` — `{from: {}, to: {circular: true}, severity: "error"}` — the backstop that catches any future cycle anywhere in `src/`.
  - `core-is-foundation` — `from: "^src/core"`, `to: "^src/(cr|garden|sync|features|invariants|release|autonomous|dashboard|prep|triage|verify|metrics|research|worktrees|hooks|checks|cli)"` — core imports nothing above itself.
  - `invariants-not-into-garden` — `from: "^src/invariants"`, `to: "^src/garden"`.
  - `sync-not-into-garden` — `from: "^src/sync"`, `to: "^src/garden"`.
  These directional rules are redundant with `no-module-cycles` for cycle *detection* but pin the layering *direction* so a future edge can't silently flip which module is on top.
- Update the scaffold/init config template's inline docs if it documents the boundaries shape (template value stays `[]`).

### Unit 5 — keyboard-binding retirement

- Delete `src/invariants/keyboard-binding.ts` and `src/checks/__tests__/invariants-keyboard-binding.test.ts`.
- Remove `keyboardBinding` / `makeKeyboardBindingInvariant` from both registries in `src/invariants/index.ts:12-32` (`invariants` array and `makeInvariants`).
- Update `src/garden/__tests__/garden-detect.test.ts:493-512` (asserts `keyboard-binding` appears in results) and doc mentions in `docs/features/architecture-invariants.md` + `docs/noldor/script-catalog.md`.

### Verification

- `pnpm noldor invariants run` → boundaries check now runs ≥4 rules; must pass post-refactor (proves cycles actually broken, since `no-module-cycles` is among them).
- Temporarily re-adding one old edge (e.g. `pr-flow-cli.ts` importing `../cr/config.js`) must flip `boundaries` red — this is the acceptance test that the check is no longer vacuous.

## Acceptance criteria

- `.noldor/config.json` `consumer.boundaries` contains ≥4 rules including a `circular: true` backstop; `BoundaryRuleSchema` validates them.
- `pnpm noldor invariants run` passes 3/3 (keyboard-binding gone) with boundaries running real rules.
- `grep -rn "from '\.\./cr/" src/core/` returns nothing; `grep -rn "from '\.\./garden/" src/features/ src/sync/` returns nothing; `grep -rn "from '\.\./garden/" src/invariants/` returns nothing.
- `loadConfig` lives in `src/core/config.ts`; no `src/cr/config.ts` re-export shim exists.
- `loadSddFeatures` + `walkRepo` + slug extractors live in `src/core/fd-load.ts`; `sdd-report.ts` shrinks accordingly and keeps only detector/report logic.
- Reverting any one moved import (spot-check) makes the boundaries invariant exit 1.
- Full suite (`pnpm verify`) green; no test references `keyboard-binding` except archived docs.

## Risks / trade-offs

- **Wide mechanical churn**: ~25 files touch import paths. Pure moves, but merge-conflicts with any in-flight branch touching cr/garden. Mitigate: ship as one PR, moves-only commits separated from rule-declaration commit.
- **Consumer break — keyboard-binding**: any consumer with `area: web` FDs (Charuy) silently loses the check on next noldor upgrade. Accepted: it was Charuy-only debt; a consumer wanting it can re-add via a future custom-invariants seam (out of scope).
- **`BoundaryRuleSchema` loosening**: making `from.path` optional weakens validation for consumers who typo a rule. Mitigated by the refine (each rule must constrain something) and dep-cruiser erroring on nonsense rules at run time.
- **Public-API surface**: `src/index.ts` may re-export moved symbols; if so, re-export paths update but the package's public names stay identical (verify with `public-api-tsdoc` invariant staying green).
- **Timing**: dep-cruiser with real rules may run slower than the 262ms zero-rule baseline; retiring keyboard-binding (275ms) offsets it.

## User Story

As a framework maintainer, I want Noldor to declare and enforce boundary rules for its own module graph, so that the `boundaries` invariant actually guards against dependency cycles instead of passing vacuously with zero rules.

## Usage

```bash
# run all invariants — boundaries now enforces 4 real rules, 3 invariants total
pnpm noldor invariants run
# alias
pnpm noldor checks invariants
```

Rules live in `.noldor/config.json` under `consumer.boundaries` (dependency-cruiser forbidden-rule shape; regex strings, plus the `{from: {}, to: {circular: true}}` no-cycle backstop). Agents hitting a red `boundaries` check must move code to respect the layering (`cli/orchestration → domain modules → core`), never edit the rules to pass.

## Open questions (resolved)

1. *Where should the relocated config loader live — `src/core/config.ts`, or a new top-level `src/config/` module?* -> `src/core/config.ts`. (D1) Core is the declared foundation layer, the loader already imports `core/agent-runner/types.js`, and `src/core/consumer-config.ts` (the sibling loader for the `consumer:` block) is already there — co-location beats a new module.
2. *Should `src/cr/` keep re-export shims for moved symbols to reduce churn?* -> No — update all importers. (D2) A shim keeps the `core → cr`-shaped edge reachable and the repo is a single package with ~25 internal import sites; dep-cruiser would still see the old path and the cycle-break would be cosmetic.
3. *Express cycle-safety as pairwise directional rules only, or extend the schema for dep-cruiser's `circular: true`?* -> Extend `BoundaryRuleSchema` and ship a `no-module-cycles` backstop plus 3 directional rules. (D3) Pairwise rules only guard the 4 cycles we know about; the `circular` backstop catches the next one for free, and the schema change is ~5 lines in `consumer-config.ts`.
4. *Retire `keyboard-binding` outright or demote it to config-gated opt-in?* -> Retire outright (delete plugin + registry entries). (D4) Zero `area: web` FDs exist in this repo, the framework is opinionated-not-configurable (vision.md), and no custom-invariants config seam exists today — building one for a dying check is inverted effort.
5. *Should the FD-loading extraction also move detector helpers like `isLinkEnforced`/`compareSemver`?* -> Yes, move them with the loaders. (D5) `loadSddFeatures`'s consumers filter records via `isLinkEnforced` (which needs `compareSemver`/`MIN_ENFORCED_VERSION`); leaving them in garden would recreate a `features → garden` edge immediately.
