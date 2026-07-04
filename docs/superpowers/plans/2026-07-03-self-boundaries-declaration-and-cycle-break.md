# Self-Boundaries Declaration and Cycle Break Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Make the `boundaries` invariant real for Noldor itself: break every dependency cycle in `src/` (4 directory-level cycles from the spec plus 2 file-level cycles found during plan research), declare 4 dependency-cruiser rules in `.noldor/config.json` `consumer.boundaries` (including the `{from: {}, to: {circular: true}}` backstop), extend `BoundaryRuleSchema` to express them, and retire the Charuy-inherited `keyboard-binding` invariant — so `pnpm noldor invariants run` passes 3/3 with real rules and flips red when any forbidden edge is reintroduced.

**Architecture:** Layering direction: `cli / hooks / autonomous / release / dashboard (orchestration) → cr / garden / sync / features / invariants / … (domain) → core / lib / utils / rules (foundation)`. Pure relocations, no behavior change: the repo-wide config loader (`loadConfig`/`loadConfigSync`) moves `src/cr/config.ts → src/core/config.ts` with its deps (`review-profile.ts`, `prompt-stdin.ts`, lane enums into new `src/core/lanes.ts`); the FD-loading library extracts from `src/garden/sdd-report.ts` into new `src/core/fd-load.ts` (including `Gap` — required to break the `sdd-report ↔ graph-fd-lookup` file cycle the spec missed); `feature-schema.ts` moves `src/features/ → src/core/` content-exact; the rule-pair seed list moves `src/garden/garden-invariants.ts → src/invariants/rule-pairs.ts` (interface renamed `Invariant → RulePairInvariant`); `ensureCleanTreeOnMain` extracts from `src/release/index.ts` into new `src/release/clean-tree.ts` (breaks the deliberate `index ↔ release-publish` ESM cycle the backstop would flag). No re-export shims anywhere (spec D2). Rules ship only in Noldor's own config; the scaffold template `templates/.noldor/config.json` keeps `"boundaries": []`.

**Tech Stack:** TypeScript ESM (`.js` import specifiers), zod v3, dependency-cruiser ^16 (`tsPreCompilationDeps: true` — type-only imports count as edges), vitest 3 (globals on — `src/checks/__tests__/` style uses bare `describe`/`it`), `git mv` for history-preserving moves, oxlint/oxfmt via `pnpm verify`.

**Drain sequencing context (read before Task 1):** This plan executes FOURTH in a 5-plan drain.

- An earlier plan (framework-script-test-migration-cleanup) may already have deleted `src/index.ts` and the package.json `main`/`"."` export. This plan never touches either — as of plan-writing, `src/index.ts` re-exports nothing (it exports only the empty `NoldorLibrary` type), so no re-export fixups exist here. If a post-move grep in Tasks 1–3 unexpectedly surfaces `src/index.ts` importing a moved path, update it like any other importer; if the file is gone, skip.
- An earlier plan may have added `src/invariants/__tests__/boundaries.test.ts` (asserts rules parse against `BoundaryRuleSchema`) and `src/invariants/__tests__/rule-conflicts.test.ts`. Keep them green: Task 4's post-move grep catches any `garden-invariants` import they hold; Task 6's schema change is strictly additive (the old `{from:{path},to:{path}}` shape still parses). Wherever a step says `pnpm vitest run src/checks/__tests__/...`, also run `pnpm vitest run src/invariants/__tests__` if that directory exists.
- A LATER plan (stable-entry-ids) adds an optional entry-id field to `FeatureFrontmatterSchema`. Task 2's `feature-schema.ts` move must therefore be a pure `git mv` — file content byte-identical, only importer paths change elsewhere.
- Line numbers below were verified 2026-07-03 and drift only if an earlier drain plan touched the same lines; symbol names and quoted old-code are the authoritative anchors.

---

## File Structure

- `src/core/config.ts` — (moved from `src/cr/config.ts`) repo-wide `.noldor/config.json` loader: `loadConfig`, `loadConfigSync`, `resolveSessionTtlHours`, `resolveReviewProfile`, all block schemas
- `src/core/review-profile.ts` — (moved from `src/cr/review-profile.ts`) review effort/dimension/profile schemas + `DEFAULT_REVIEW_PROFILES`
- `src/core/prompt-stdin.ts` — (moved from `src/cr/prompt-stdin.ts`) generic `@inquirer/prompts` stdin helpers
- `src/core/lanes.ts` — NEW: `laneSchema`/`artifactKindSchema` enums (extracted from `src/cr/findings-schema.ts`)
- `src/cr/findings-schema.ts` — re-imports lane enums from core (cr → core is the allowed direction), keeps everything else
- `src/core/__tests__/config.test.ts`, `src/core/__tests__/review-profile.test.ts`, `src/core/__tests__/prompt-stdin.test.ts` — (moved with their modules from `src/cr/__tests__/`)
- `src/core/pr-flow-cli.ts` — config/prompt imports become core-local (kills the core → cr edges)
- `src/validate/noldor-config.ts`, `src/garden/garden-detect.ts`, `src/garden/sdd-report.ts`, `src/release/index.ts`, `src/release/release-publish.ts`, `src/hooks/noldor-pre-commit.ts`, `src/autonomous/watch.ts`, `src/autonomous/queue-drain.ts`, `src/cr/escalate-cli.ts`, `src/cr/orchestrate.ts` — `cr/config` importers repointed to `core/config`
- `src/cr/escalate.ts`, `src/cr/lanes/manual.ts`, `src/cr/lane-types.ts`, `src/cr/lanes/subagent-dispatch.ts` — prompt-stdin / review-profile importers repointed to core
- `src/cr/__tests__/overwrite-guard.test.ts`, `src/cr/__tests__/escalate.test.ts`, `src/cr/__tests__/lanes/manual.test.ts`, `src/cr/__tests__/lanes/subagent-dispatch.test.ts` — `vi.mock`/import paths follow the moved modules
- `src/release/release-cr-gate.ts`, `src/garden/detectors/override-audit.ts` — comment-only `cr/config` mentions updated (they do NOT import it — spec listed them as importers; that claim is false)
- `src/core/feature-schema.ts` — (moved content-exact from `src/features/feature-schema.ts`) `FeatureFrontmatterSchema`, `FeatureFrontmatter`, `LOST_SENTINEL`, `Category`
- `src/core/__tests__/feature-schema.test.ts`, `src/core/__tests__/feature-schema-since.test.ts` — (moved from `src/features/__tests__/`; their `../feature-schema` imports resolve unchanged)
- `src/metrics/types.ts`, `src/metrics/facts.ts`, `src/metrics/__tests__/fixtures.ts`, `src/core/next-priority.ts`, `src/garden/plan-resolution.ts`, `src/garden/detectors/milestone-shipped-incomplete.ts`, `src/garden/detectors/tier-mismatch.ts`, `src/garden/detectors/fd-without-plan.ts`, `src/garden/detectors/fd-link-rot.ts`, `src/garden/__tests__/graph-fd-lookup.test.ts`, `src/garden/__tests__/sdd-report.test.ts`, `src/features/fill-links-code-gaps.ts`, `src/features/validate-features.ts`, `src/features/migrate-link-rot.ts`, `src/features/__tests__/feature-milestone.test.ts`, `src/features/__tests__/fill-links-code-gaps.test.ts`, `src/release/release-notes.ts`, `src/docs/docs-howto.ts`, `src/dashboard/data.ts`, `src/lib/area-category.ts`, `src/sync/sync-fd-resources.ts`, `src/graphify/enrich-doc-nodes.ts` — feature-schema importers repointed to `core/feature-schema`
- `src/core/fd-load.ts` — NEW: FD-loading library extracted from sdd-report (`Gap`, `FeatureRecord`, `MIN_ENFORCED_VERSION`, `compareSemver`, `isLinkEnforced`, `isInfraFile`, `walkRepo`, `loadSddFeatures`, `listSpecs`, `listPlans`, `extractSpecSlug`, `extractPlanSlug`, `readTextFiles`)
- `src/garden/sdd-report.ts` — keeps detectors, report assembly, `main()`; loads the library from core
- `src/garden/graph-fd-lookup.ts` — `FeatureRecord`/`Gap` types from core (kills the `sdd-report ↔ graph-fd-lookup` file cycle)
- `src/garden/detectors/code-links-drift.ts` — `Gap` type from core
- `src/features/migrate-code-tags.ts`, `src/features/propose-pointers.ts`, `src/sync/sync-spec-links.ts`, `src/dashboard/views.ts` — moved-symbol importers repointed to `core/fd-load`
- `src/invariants/rule-pairs.ts` — (moved from `src/garden/garden-invariants.ts`) rule-pair seed list; interface renamed `RulePairInvariant`
- `src/invariants/rule-conflicts.ts` — imports become module-internal (`./rule-pairs.js`)
- `src/garden/__tests__/garden-detect.test.ts` — rule-pair type import follows the move; keyboard-binding test block rewritten in Task 7
- `src/release/clean-tree.ts` — NEW: `ensureCleanTreeOnMain` extracted from `src/release/index.ts` (breaks the `index ↔ release-publish` file cycle)
- `src/core/consumer-config.ts` — `BoundaryRuleSchema` extension: optional `from.path`, optional `to.circular`, refine requiring `to` to constrain something
- `src/core/__tests__/consumer-config-boundaries.test.ts` — NEW: schema-shape tests (failing-test moment 1)
- `src/checks/__tests__/invariants-boundaries.test.ts` — new e2e case: two-file cycle flagged via the circular backstop
- `.noldor/config.json` — `consumer.boundaries` filled with the 4 rules (spec Unit 4)
- `src/invariants/keyboard-binding.ts` — DELETED (Charuy-only UI check, slowest invariant)
- `src/checks/__tests__/invariants-keyboard-binding.test.ts` — DELETED
- `src/invariants/index.ts` — `keyboardBinding`/`makeKeyboardBindingInvariant` removed from both registries
- `docs/features/architecture-invariants.md` — keyboard-binding entries dropped from `links.code`/`links.tests` and body
- `docs/noldor/script-catalog.md`, `templates/docs/noldor/script-catalog.md` — invariant list in the `invariants run` outputs line updated (page + template twin edited together)

---

## Task 1: Move the repo config loader (+ review-profile, prompt-stdin, lane enums) into src/core

Breaks the `core → cr` half of cycle 1: `src/core/pr-flow-cli.ts:6-7` imports `../cr/config.js` and `../cr/prompt-stdin.js` while 7 cr files import core. Pure move — TDD adapts: move → update importers → typecheck + suite green → commit.

**Files:**
- Move: `src/cr/config.ts` → `src/core/config.ts`
- Move: `src/cr/review-profile.ts` → `src/core/review-profile.ts`
- Move: `src/cr/prompt-stdin.ts` → `src/core/prompt-stdin.ts`
- Move: `src/cr/__tests__/config.test.ts` → `src/core/__tests__/config.test.ts`
- Move: `src/cr/__tests__/review-profile.test.ts` → `src/core/__tests__/review-profile.test.ts`
- Move: `src/cr/__tests__/prompt-stdin.test.ts` → `src/core/__tests__/prompt-stdin.test.ts`
- Create: `src/core/lanes.ts`
- Modify: `src/cr/findings-schema.ts`, `src/core/pr-flow-cli.ts`, `src/validate/noldor-config.ts`, `src/garden/garden-detect.ts`, `src/garden/sdd-report.ts`, `src/release/index.ts`, `src/release/release-publish.ts`, `src/hooks/noldor-pre-commit.ts`, `src/autonomous/watch.ts`, `src/autonomous/queue-drain.ts`, `src/cr/escalate-cli.ts`, `src/cr/orchestrate.ts`, `src/cr/escalate.ts`, `src/cr/lanes/manual.ts`, `src/cr/lane-types.ts`, `src/cr/lanes/subagent-dispatch.ts`, `src/cr/__tests__/overwrite-guard.test.ts`, `src/cr/__tests__/escalate.test.ts`, `src/cr/__tests__/lanes/manual.test.ts`, `src/cr/__tests__/lanes/subagent-dispatch.test.ts`, `src/release/release-cr-gate.ts`, `src/garden/detectors/override-audit.ts`
- Test: `src/core/__tests__/config.test.ts`, `src/core/__tests__/review-profile.test.ts`, `src/core/__tests__/prompt-stdin.test.ts`, `pnpm vitest run src/cr`

- [ ] **Step 1: git-mv the three modules and their three test files**

  The three test files import `../config.js` / `../review-profile.js` / `../prompt-stdin.js` — the same relative depth holds under `src/core/__tests__/`, so their content needs no edit.

  ```bash
  git mv src/cr/config.ts src/core/config.ts
  git mv src/cr/review-profile.ts src/core/review-profile.ts
  git mv src/cr/prompt-stdin.ts src/core/prompt-stdin.ts
  git mv src/cr/__tests__/config.test.ts src/core/__tests__/config.test.ts
  git mv src/cr/__tests__/review-profile.test.ts src/core/__tests__/review-profile.test.ts
  git mv src/cr/__tests__/prompt-stdin.test.ts src/core/__tests__/prompt-stdin.test.ts
  ```

  Expected output: silent (exit 0); `git status` shows six renames.

- [ ] **Step 2: Create src/core/lanes.ts with the lane enums extracted from findings-schema**

  ```typescript
  import { z } from 'zod';

  /**
   * CR review lanes. `subagent` is the only lane that runs fully unattended —
   * see DEFAULT_CR_LANES in `./config.ts`. Lives in core (not `cr/`) because
   * the repo-wide config loader validates `crLanes` blocks against it.
   */
  export const laneSchema = z.enum(['manual', 'codex', 'subagent', 'standalone', 'verify']);
  export type Lane = z.infer<typeof laneSchema>;

  /** Reviewable artifact kinds — the keys of a `crLanes` config block. */
  export const artifactKindSchema = z.enum(['spec', 'plan', 'code']);
  export type ArtifactKind = z.infer<typeof artifactKindSchema>;
  ```

- [ ] **Step 3: Point src/cr/findings-schema.ts at core/lanes (delete its own enum definitions)**

  In `src/cr/findings-schema.ts` delete the four enum lines (old lines 15-16 and 27-28):

  ```typescript
  export const laneSchema = z.enum(['manual', 'codex', 'subagent', 'standalone', 'verify']);
  export type Lane = z.infer<typeof laneSchema>;
  ```

  ```typescript
  export const artifactKindSchema = z.enum(['spec', 'plan', 'code']);
  export type ArtifactKind = z.infer<typeof artifactKindSchema>;
  ```

  and add below `import { z } from 'zod';` (the schemas are still used locally by `laneFindingsSchema`, so import-then-re-export, not `export … from`):

  ```typescript
  import { artifactKindSchema, laneSchema } from '../core/lanes.js';

  export { artifactKindSchema, laneSchema };
  export type { ArtifactKind, Lane } from '../core/lanes.js';
  ```

  Every existing importer of `findings-schema.js` (cr internals, `src/metrics/*`) keeps working unchanged; the edge direction is now cr → core.

- [ ] **Step 4: Fix src/core/config.ts's own imports and the stale TTL comment**

  Replace its first three import lines:

  ```typescript
  import { artifactKindSchema, laneSchema } from './findings-schema.js';
  import type { ArtifactKind, Lane } from './findings-schema.js';
  import { agentsConfigSchema } from '../core/agent-runner/types.js';
  ```

  with:

  ```typescript
  import { artifactKindSchema, laneSchema } from './lanes.js';
  import type { ArtifactKind, Lane } from './lanes.js';
  import { agentsConfigSchema } from './agent-runner/types.js';
  ```

  (`./review-profile.js` needs no change — it moved alongside.) Then rewrite the now-obsolete `DEFAULT_SESSION_TTL_HOURS` doc comment (it currently ends "…so `session.ts` keeps no `core → cr` import edge"):

  ```typescript
  /**
   * Default session-marker time-to-live, in hours. A stale-eligible session
   * (`micro-chore` / `release-sweep`) older than this reads as stale at
   * pre-commit. Lives beside {@link resolveSessionTtlHours} in the core config
   * loader, naturally next to its `core/session.ts` consumers.
   */
  ```

- [ ] **Step 5: Repoint every `cr/config` importer (9 real import sites outside cr/, 2 inside)**

  Apply these exact one-line swaps:

  | File | Old | New |
  |---|---|---|
  | `src/core/pr-flow-cli.ts:6` | `from '../cr/config.js'` | `from './config.js'` |
  | `src/validate/noldor-config.ts:1` | `from '../cr/config.js'` | `from '../core/config.js'` |
  | `src/garden/garden-detect.ts:7` | `from '../cr/config.js'` | `from '../core/config.js'` |
  | `src/garden/sdd-report.ts:19` | `from '../cr/config.js'` | `from '../core/config.js'` |
  | `src/release/index.ts:6` | `from '../cr/config.js'` | `from '../core/config.js'` |
  | `src/release/release-publish.ts:10` | `from '../cr/config.js'` | `from '../core/config.js'` |
  | `src/hooks/noldor-pre-commit.ts:9` | `from '../cr/config'` | `from '../core/config'` |
  | `src/autonomous/watch.ts:5` | `from '../cr/config.js'` | `from '../core/config.js'` |
  | `src/autonomous/queue-drain.ts:4` | `from '../cr/config.js'` | `from '../core/config.js'` |
  | `src/cr/escalate-cli.ts:3` | `from './config.js'` | `from '../core/config.js'` |
  | `src/cr/orchestrate.ts:5` and `:6` | `from './config.js'` | `from '../core/config.js'` |

- [ ] **Step 6: Repoint prompt-stdin and review-profile importers (including test mocks)**

  | File | Old | New |
  |---|---|---|
  | `src/core/pr-flow-cli.ts:7` | `from '../cr/prompt-stdin.js'` | `from './prompt-stdin.js'` |
  | `src/cr/escalate.ts:11` | `from './prompt-stdin.js'` | `from '../core/prompt-stdin.js'` |
  | `src/cr/orchestrate.ts:14` | `from './prompt-stdin.js'` | `from '../core/prompt-stdin.js'` |
  | `src/cr/lanes/manual.ts:5` | `from '../prompt-stdin.js'` | `from '../../core/prompt-stdin.js'` |
  | `src/cr/lane-types.ts:3` | `from './review-profile.js'` | `from '../core/review-profile.js'` |
  | `src/cr/lanes/subagent-dispatch.ts:2` and `:3` | `from '../review-profile.js'` | `from '../../core/review-profile.js'` |
  | `src/cr/__tests__/overwrite-guard.test.ts:8` | `vi.mock('../prompt-stdin.js', …)` | `vi.mock('../../core/prompt-stdin.js', …)` |
  | `src/cr/__tests__/escalate.test.ts:12` | `vi.mock('../prompt-stdin.js', …)` | `vi.mock('../../core/prompt-stdin.js', …)` |
  | `src/cr/__tests__/lanes/manual.test.ts:12` | `vi.mock('../../prompt-stdin.js', …)` | `vi.mock('../../../core/prompt-stdin.js', …)` |
  | `src/cr/__tests__/lanes/subagent-dispatch.test.ts:4` | `from '../../review-profile.js'` | `from '../../../core/review-profile.js'` |

  A `vi.mock` path must resolve to the same module file the source now imports, otherwise the mock silently stops applying — that is why the three mock paths change.

- [ ] **Step 7: Update the two comment-only mentions of the old path**

  `src/release/release-cr-gate.ts:12`: change `cr/config` to `core/config` inside the doc comment. `src/garden/detectors/override-audit.ts:56`: change `src/cr/config.ts` to `src/core/config.ts` inside the doc comment. (These two files were listed by the spec as importers — they are not; comments only.)

- [ ] **Step 8: Run typecheck and prove no old-path references survive**

  ```bash
  pnpm typecheck
  grep -rn "cr/config\|cr/prompt-stdin\|cr/review-profile" src --include="*.ts"
  ```

  Expected output: typecheck silent exit 0; grep finds nothing (exit 1).

- [ ] **Step 9: Run the moved and touched test suites — verify PASS**

  ```bash
  pnpm vitest run src/core/__tests__/config.test.ts src/core/__tests__/review-profile.test.ts src/core/__tests__/prompt-stdin.test.ts src/cr
  ```

  Expected output: all test files pass, 0 failures.

- [ ] **Step 10: Commit**

  ```bash
  git add src/core src/cr src/validate/noldor-config.ts src/garden/garden-detect.ts src/garden/sdd-report.ts src/garden/detectors/override-audit.ts src/release/index.ts src/release/release-publish.ts src/release/release-cr-gate.ts src/hooks/noldor-pre-commit.ts src/autonomous/watch.ts src/autonomous/queue-drain.ts
  git commit -m "refactor(core): relocate repo config loader, review profiles, and stdin prompts out of src/cr" -m "Noldor-FD: self-boundaries-declaration-and-cycle-break"
  ```

---

## Task 2: Move feature-schema.ts from src/features to src/core (content-exact)

Kills garden → features (3 garden importers) and core → features (`next-priority.ts`). MUST be a pure `git mv` — the later stable-entry-ids plan edits this schema at its new path. Pure move — adapted TDD.

**Files:**
- Move: `src/features/feature-schema.ts` → `src/core/feature-schema.ts`
- Move: `src/features/__tests__/feature-schema.test.ts` → `src/core/__tests__/feature-schema.test.ts`
- Move: `src/features/__tests__/feature-schema-since.test.ts` → `src/core/__tests__/feature-schema-since.test.ts`
- Modify: `src/metrics/types.ts`, `src/metrics/facts.ts`, `src/metrics/__tests__/fixtures.ts`, `src/core/next-priority.ts`, `src/garden/garden-detect.ts`, `src/garden/plan-resolution.ts`, `src/garden/sdd-report.ts`, `src/garden/detectors/milestone-shipped-incomplete.ts`, `src/garden/detectors/tier-mismatch.ts`, `src/garden/detectors/fd-without-plan.ts`, `src/garden/detectors/fd-link-rot.ts`, `src/garden/__tests__/graph-fd-lookup.test.ts`, `src/garden/__tests__/sdd-report.test.ts`, `src/features/fill-links-code-gaps.ts`, `src/features/validate-features.ts`, `src/features/migrate-link-rot.ts`, `src/features/__tests__/feature-milestone.test.ts`, `src/features/__tests__/fill-links-code-gaps.test.ts`, `src/release/release-notes.ts`, `src/docs/docs-howto.ts`, `src/dashboard/data.ts`, `src/lib/area-category.ts`, `src/sync/sync-fd-resources.ts`, `src/graphify/enrich-doc-nodes.ts`
- Test: `pnpm vitest run src/core/__tests__ src/features src/garden/__tests__/graph-fd-lookup.test.ts`

- [ ] **Step 1: git-mv the schema and its two pure schema tests**

  `feature-schema.test.ts` and `feature-schema-since.test.ts` import only `../feature-schema(.js)` — same relative depth after the move, zero content edits. `feature-milestone.test.ts` stays put (it also imports `../validate-features.js`, which remains in features).

  ```bash
  git mv src/features/feature-schema.ts src/core/feature-schema.ts
  git mv src/features/__tests__/feature-schema.test.ts src/core/__tests__/feature-schema.test.ts
  git mv src/features/__tests__/feature-schema-since.test.ts src/core/__tests__/feature-schema-since.test.ts
  ```

  Expected output: silent; three renames staged. Do not edit `src/core/feature-schema.ts` content at all.

- [ ] **Step 2: Repoint all importers**

  Exact swaps (each line keeps its imported names, only the specifier changes):

  | File | Old specifier | New specifier |
  |---|---|---|
  | `src/metrics/types.ts:5` | `'../features/feature-schema.js'` | `'../core/feature-schema.js'` |
  | `src/metrics/facts.ts:5` | `'../features/feature-schema.js'` | `'../core/feature-schema.js'` |
  | `src/metrics/__tests__/fixtures.ts:2` | `'../../features/feature-schema'` | `'../../core/feature-schema'` |
  | `src/core/next-priority.ts:9` | `'../features/feature-schema.js'` | `'./feature-schema.js'` |
  | `src/garden/garden-detect.ts:9` and `:36` | `'../features/feature-schema.js'` | `'../core/feature-schema.js'` |
  | `src/garden/plan-resolution.ts:7` and `:8` | `'../features/feature-schema.js'` | `'../core/feature-schema.js'` |
  | `src/garden/sdd-report.ts:7` and `:33` | `'../features/feature-schema.js'` | `'../core/feature-schema.js'` |
  | `src/garden/detectors/milestone-shipped-incomplete.ts:6` | `'../../features/feature-schema.js'` | `'../../core/feature-schema.js'` |
  | `src/garden/detectors/tier-mismatch.ts:6` | `'../../features/feature-schema.js'` | `'../../core/feature-schema.js'` |
  | `src/garden/detectors/fd-without-plan.ts:8` | `'../../features/feature-schema.js'` | `'../../core/feature-schema.js'` |
  | `src/garden/detectors/fd-link-rot.ts:10` | `'../../features/feature-schema.js'` | `'../../core/feature-schema.js'` |
  | `src/garden/__tests__/graph-fd-lookup.test.ts:21` | `'../../features/feature-schema.js'` | `'../../core/feature-schema.js'` |
  | `src/garden/__tests__/sdd-report.test.ts:33` | `'../../features/feature-schema.js'` | `'../../core/feature-schema.js'` |
  | `src/features/fill-links-code-gaps.ts:22` | `'./feature-schema.js'` | `'../core/feature-schema.js'` |
  | `src/features/validate-features.ts:7` | `'./feature-schema.js'` | `'../core/feature-schema.js'` |
  | `src/features/migrate-link-rot.ts:17` | `'./feature-schema.js'` | `'../core/feature-schema.js'` |
  | `src/features/__tests__/feature-milestone.test.ts:7` | `'../feature-schema.js'` | `'../../core/feature-schema.js'` |
  | `src/features/__tests__/fill-links-code-gaps.test.ts:17` | `'../feature-schema.js'` | `'../../core/feature-schema.js'` |
  | `src/release/release-notes.ts:6` and `:10` | `'../features/feature-schema.js'` | `'../core/feature-schema.js'` |
  | `src/docs/docs-howto.ts:9` | `'../features/feature-schema.js'` | `'../core/feature-schema.js'` |
  | `src/dashboard/data.ts:14` | `'../features/feature-schema.js'` | `'../core/feature-schema.js'` |
  | `src/lib/area-category.ts:13` | `'../features/feature-schema.js'` | `'../core/feature-schema.js'` |
  | `src/sync/sync-fd-resources.ts:7` | `'../features/feature-schema.js'` | `'../core/feature-schema.js'` |
  | `src/graphify/enrich-doc-nodes.ts:7` | `'../features/feature-schema.js'` | `'../core/feature-schema.js'` |

- [ ] **Step 3: Update the source-drift pair path literal in garden-detect**

  In `src/garden/garden-detect.ts` `SOURCE_DRIFT_PAIRS` (≈line 475), change:

  ```typescript
      sources: ['src/features/feature-schema.ts'],
  ```

  to:

  ```typescript
      sources: ['src/core/feature-schema.ts'],
  ```

- [ ] **Step 4: Typecheck and prove no stale path survives**

  ```bash
  pnpm typecheck
  grep -rn "features/feature-schema" src --include="*.ts"
  ```

  Expected output: typecheck exit 0; grep empty (exit 1).

- [ ] **Step 5: Run the affected suites — verify PASS**

  ```bash
  pnpm vitest run src/core/__tests__ src/features src/metrics src/garden/__tests__/graph-fd-lookup.test.ts
  ```

  Expected output: all pass, 0 failures.

- [ ] **Step 6: Commit**

  ```bash
  git add -A src
  git commit -m "refactor(core): move feature-schema from src/features to src/core" -m "Noldor-FD: self-boundaries-declaration-and-cycle-break"
  ```

---

## Task 3: Extract the FD-loading library into src/core/fd-load.ts

Breaks features → garden (3 importers of `loadSddFeatures`/`walkRepo`/`isInfraFile`), sync → garden (`sync-spec-links.ts` imports `extractSpecSlug`), AND the file-level cycle `src/garden/sdd-report.ts ↔ src/garden/graph-fd-lookup.ts` that dependency-cruiser's `circular: true` flags today (verified 2026-07-03) — which is why `Gap` moves too, beyond the spec's symbol list: `graph-fd-lookup.ts:4` type-imports `{ FeatureRecord, Gap }` from sdd-report while sdd-report value-imports 5 functions back, and `tsPreCompilationDeps: true` counts type-only edges. Pure move — adapted TDD.

**Files:**
- Create: `src/core/fd-load.ts`
- Modify: `src/garden/sdd-report.ts`, `src/garden/graph-fd-lookup.ts`, `src/garden/detectors/code-links-drift.ts`, `src/garden/detectors/fd-link-rot.ts`, `src/features/migrate-code-tags.ts`, `src/features/fill-links-code-gaps.ts`, `src/features/propose-pointers.ts`, `src/sync/sync-spec-links.ts`, `src/dashboard/data.ts`, `src/dashboard/views.ts`, `src/garden/__tests__/sdd-report.test.ts`, `src/garden/__tests__/graph-fd-lookup.test.ts`
- Test: `pnpm vitest run src/garden src/features src/sync src/dashboard`

- [ ] **Step 1: Create src/core/fd-load.ts with this exact header, then relocate the listed blocks verbatim**

  File header (write exactly):

  ```typescript
  import { readFile, readdir } from 'node:fs/promises';
  import { basename, join, relative } from 'node:path';

  import matter from 'gray-matter';

  import { FeatureFrontmatterSchema } from './feature-schema.js';

  import type { Dirent } from 'node:fs';
  import type { FeatureFrontmatter } from './feature-schema.js';
  ```

  Then CUT (do not retype — move each block verbatim, including its full preceding doc comment) these blocks from `src/garden/sdd-report.ts` and paste them into `fd-load.ts` in this order:

  1. `export interface Gap` (≈lines 36-44)
  2. `export interface FeatureRecord` (≈lines 46-52)
  3. `export const MIN_ENFORCED_VERSION` (≈lines 54-63)
  4. `export function compareSemver` (≈lines 65-80)
  5. `export function isLinkEnforced` (≈lines 82-97)
  6. `const INFRA_FILE_PATTERNS` (≈lines 296-303) and `export function isInfraFile` (≈lines 305-316)
  7. `const EXCLUDED_WALK_DIRS` (≈lines 594-601) and `export async function walkRepo` (≈lines 603-636)
  8. `export async function loadSddFeatures` (≈lines 638-669)
  9. `export async function listSpecs` (≈lines 671-688)
  10. `export async function listPlans` (≈lines 690-707)
  11. `export function extractSpecSlug` (≈lines 709-720)
  12. `export function extractPlanSlug` (≈lines 722-739)
  13. `export async function readTextFiles` (≈lines 767-779)

  Do NOT move `TESTS_EXEMPT_SENTINEL`, `detectPlansWithoutSpec`, `ReportInput`, `collectGaps`, or any `detect*` function — detectors stay in garden (spec non-goal). No re-export shim in sdd-report.

- [ ] **Step 2: Re-import the library in src/garden/sdd-report.ts and prune dead imports**

  Add where the moved blocks were imported from (top import section):

  ```typescript
  import {
    MIN_ENFORCED_VERSION,
    compareSemver,
    extractPlanSlug,
    extractSpecSlug,
    isInfraFile,
    isLinkEnforced,
    listPlans,
    listSpecs,
    loadSddFeatures,
    readTextFiles,
    walkRepo,
  } from '../core/fd-load.js';
  import type { FeatureRecord, Gap } from '../core/fd-load.js';
  ```

  Then delete imports the file no longer uses: `matter` (gray-matter — its only use was inside `loadSddFeatures`), `relative` from `node:path`, `type { Dirent }`, `FeatureFrontmatterSchema` and `type { FeatureFrontmatter }` from `../core/feature-schema.js`. KEEP `basename` (used by the entry guard at the bottom) and `join` (used by `buildGateComplianceSection` ≈line 933 and others). Run `pnpm lint` afterwards and remove exactly the names it flags unused (including any of the newly imported fd-load names sdd-report's remaining code doesn't reference — e.g. `MIN_ENFORCED_VERSION`/`compareSemver` if only `isLinkEnforced` used them).

- [ ] **Step 3: Repoint the external importers of moved symbols**

  | File | Old line | New line |
  |---|---|---|
  | `src/garden/graph-fd-lookup.ts:4` | `import type { FeatureRecord, Gap } from './sdd-report.js';` | `import type { FeatureRecord, Gap } from '../core/fd-load.js';` |
  | `src/garden/detectors/code-links-drift.ts:4` | `import type { Gap } from '../sdd-report.js';` | `import type { Gap } from '../../core/fd-load.js';` |
  | `src/garden/detectors/fd-link-rot.ts:11` | `import type { Gap } from '../sdd-report.js';` | `import type { Gap } from '../../core/fd-load.js';` |
  | `src/features/migrate-code-tags.ts:6` | `import { loadSddFeatures } from '../garden/sdd-report.js';` | `import { loadSddFeatures } from '../core/fd-load.js';` |
  | `src/features/fill-links-code-gaps.ts:17` | `import { isInfraFile, loadSddFeatures, walkRepo } from '../garden/sdd-report.js';` | `import { isInfraFile, loadSddFeatures, walkRepo } from '../core/fd-load.js';` |
  | `src/features/propose-pointers.ts:12` | `import { loadSddFeatures } from '../garden/sdd-report.js';` | `import { loadSddFeatures } from '../core/fd-load.js';` |
  | `src/sync/sync-spec-links.ts:7` | `import { extractSpecSlug } from '../garden/sdd-report.js';` | `import { extractSpecSlug } from '../core/fd-load.js';` |
  | `src/dashboard/views.ts:7` | `import type { Gap } from '../garden/sdd-report.js';` | `import type { Gap } from '../core/fd-load.js';` |

- [ ] **Step 4: Split the two dashboard/data.ts import blocks**

  Replace lines 21-28:

  ```typescript
  import {
    collectGaps,
    listPlans,
    listSpecs,
    loadSddFeatures,
    readTextFiles,
    walkRepo,
  } from '../garden/sdd-report.js';
  ```

  with:

  ```typescript
  import { collectGaps } from '../garden/sdd-report.js';
  import {
    listPlans,
    listSpecs,
    loadSddFeatures,
    readTextFiles,
    walkRepo,
  } from '../core/fd-load.js';
  ```

  Replace line 64:

  ```typescript
  import type { FeatureRecord as SddFeatureRecord, Gap, ReportInput } from '../garden/sdd-report.js';
  ```

  with:

  ```typescript
  import type { ReportInput } from '../garden/sdd-report.js';
  import type { FeatureRecord as SddFeatureRecord, Gap } from '../core/fd-load.js';
  ```

- [ ] **Step 5: Split the test imports**

  In `src/garden/__tests__/sdd-report.test.ts` remove `compareSemver`, `extractPlanSlug`, `extractSpecSlug`, `isInfraFile`, `isLinkEnforced` from the `'../sdd-report.js'` import block (the `detect*`, `buildGateComplianceSection`, `resolveReportOutPath` names stay), replace line 31's `import type { FeatureRecord } from '../sdd-report.js';`, and add:

  ```typescript
  import {
    compareSemver,
    extractPlanSlug,
    extractSpecSlug,
    isInfraFile,
    isLinkEnforced,
  } from '../../core/fd-load.js';
  import type { FeatureRecord } from '../../core/fd-load.js';
  ```

  In `src/garden/__tests__/graph-fd-lookup.test.ts:20` change `import type { FeatureRecord } from '../sdd-report.js';` to `import type { FeatureRecord } from '../../core/fd-load.js';`.

- [ ] **Step 6: Typecheck, lint, and prove the forbidden directions are gone**

  ```bash
  pnpm typecheck && pnpm lint
  grep -rn "from '\.\./garden/" src/features src/sync
  grep -n "sdd-report" src/garden/graph-fd-lookup.ts
  ```

  Expected output: typecheck+lint exit 0; both greps empty — features→garden, sync→garden, and the graph-fd-lookup→sdd-report edge no longer exist.

- [ ] **Step 7: Run the affected suites — verify PASS**

  ```bash
  pnpm vitest run src/garden src/features src/sync src/dashboard
  ```

  Expected output: all pass, 0 failures.

- [ ] **Step 8: Commit**

  ```bash
  git add -A src
  git commit -m "refactor(core): extract FD-loading library from sdd-report into src/core/fd-load" -m "Noldor-FD: self-boundaries-declaration-and-cycle-break"
  ```

---

## Task 4: Move the rule-pair seed list into src/invariants/rule-pairs.ts

Breaks garden ↔ invariants: `src/invariants/rule-conflicts.ts:4-6` imports back from `../garden/garden-invariants.js`. After the move that import is module-internal, and garden-detect's import flips to the allowed garden → invariants direction. Pure move — adapted TDD.

**Files:**
- Move: `src/garden/garden-invariants.ts` → `src/invariants/rule-pairs.ts`
- Modify: `src/invariants/rule-pairs.ts` (rename `Invariant` → `RulePairInvariant`), `src/invariants/rule-conflicts.ts`, `src/garden/garden-detect.ts`, `src/garden/__tests__/garden-detect.test.ts`
- Test: `pnpm vitest run src/checks/__tests__/invariants-rule-conflicts.test.ts src/garden/__tests__/garden-detect.test.ts` (+ `src/invariants/__tests__` if it exists)

- [ ] **Step 1: git-mv the seed list**

  ```bash
  git mv src/garden/garden-invariants.ts src/invariants/rule-pairs.ts
  ```

- [ ] **Step 2: Rename the exported interface to RulePairInvariant inside rule-pairs.ts**

  Two declaration edits (entry objects and doc comments otherwise byte-identical). Change:

  ```typescript
  export interface Invariant {
  ```

  to:

  ```typescript
  export interface RulePairInvariant {
  ```

  and:

  ```typescript
  export const INVARIANTS: readonly Invariant[] = [
  ```

  to:

  ```typescript
  export const INVARIANTS: readonly RulePairInvariant[] = [
  ```

  The rename avoids colliding with `src/invariants/types.ts`'s architecture `Invariant` now that both live in the same module.

- [ ] **Step 3: Make rule-conflicts.ts module-internal**

  In `src/invariants/rule-conflicts.ts` replace:

  ```typescript
  import { INVARIANTS } from '../garden/garden-invariants.js';

  import type { Invariant as RuleInvariant } from '../garden/garden-invariants.js';
  ```

  with:

  ```typescript
  import { INVARIANTS } from './rule-pairs.js';

  import type { RulePairInvariant as RuleInvariant } from './rule-pairs.js';
  ```

  (function body unchanged — it already uses the `RuleInvariant` alias). Also update its doc comment "Wraps the existing `garden-invariants.ts` data" → "Wraps the `rule-pairs.ts` seed data".

- [ ] **Step 4: Flip garden-detect's imports to the invariants module**

  In `src/garden/garden-detect.ts` replace line 10:

  ```typescript
  import { INVARIANTS } from './garden-invariants.js';
  ```

  with:

  ```typescript
  import { INVARIANTS } from '../invariants/rule-pairs.js';
  ```

  and line 37:

  ```typescript
  import type { Invariant } from './garden-invariants.js';
  ```

  with:

  ```typescript
  import type { RulePairInvariant as Invariant } from '../invariants/rule-pairs.js';
  ```

  (aliasing keeps the file body and the `detectContradictions` signature untouched). Update the `detectContradictions` doc-comment mention "seed list in `garden-invariants.ts`" (≈line 432) → "seed list in `src/invariants/rule-pairs.ts`".

- [ ] **Step 5: Update the test import and sweep for stragglers (including earlier-drain-plan tests)**

  In `src/garden/__tests__/garden-detect.test.ts:20` replace:

  ```typescript
  import type { Invariant } from '../garden-invariants.js';
  ```

  with:

  ```typescript
  import type { RulePairInvariant as Invariant } from '../../invariants/rule-pairs.js';
  ```

  Then sweep:

  ```bash
  grep -rn "garden-invariants" src --include="*.ts"
  ```

  Expected output: empty. If an earlier plan in this drain added `src/invariants/__tests__/rule-conflicts.test.ts` (or any other file) importing `garden-invariants`, apply the same swap there (`'../../garden/garden-invariants.js'` → `'../rule-pairs.js'` from within `src/invariants/__tests__/`, alias `Invariant as …` → `RulePairInvariant as …`) and re-run the grep until empty.

- [ ] **Step 6: Typecheck and run the affected suites — verify PASS**

  ```bash
  pnpm typecheck
  pnpm vitest run src/checks/__tests__/invariants-rule-conflicts.test.ts src/garden/__tests__/garden-detect.test.ts
  ls src/invariants/__tests__ 2>/dev/null && pnpm vitest run src/invariants/__tests__ || true
  ```

  Expected output: typecheck exit 0; all suites pass.

- [ ] **Step 7: Commit**

  ```bash
  git add -A src
  git commit -m "refactor(invariants): move rule-pair seed list from garden into src/invariants/rule-pairs" -m "Noldor-FD: self-boundaries-declaration-and-cycle-break"
  ```

---

## Task 5: Break the release/index ↔ release/release-publish file cycle

NOT in the spec's cycle list — found during plan research by running dependency-cruiser with `{from: {}, to: {circular: true}}` over `src/`: `src/release/release-publish.ts:14` imports `ensureCleanTreeOnMain` from `./index.js` while `index.ts` imports `awaitPublish`/`isVersionOnRegistry`/`readPkgIdentity` back (a comment in release-publish.ts even documents it as "a deliberate ESM cycle"). The Task 6 backstop rule would flag it, so extract the shared guard. Pure extraction — adapted TDD.

**Files:**
- Create: `src/release/clean-tree.ts`
- Modify: `src/release/index.ts`, `src/release/release-publish.ts`
- Test: `pnpm vitest run src/release`

- [ ] **Step 1: Create src/release/clean-tree.ts**

  ```typescript
  import { execFile } from 'node:child_process';
  import { promisify } from 'node:util';

  const execFileP = promisify(execFile);

  /** Run a git command, forwarding stderr (fetch progress etc.) like index.ts's `run`. */
  async function git(args: string[]): Promise<string> {
    const { stdout, stderr } = await execFileP('git', args);
    if (stderr) {
      process.stderr.write(stderr);
    }
    return stdout.trim();
  }

  /**
   * Guard shared by the release pipeline entry and the registry-publish resume
   * path: refuse to proceed unless HEAD is `main`, the working tree is clean,
   * and local main matches `origin/main`. Extracted from `release/index.ts` so
   * `release-publish.ts` no longer imports the pipeline entry module back —
   * that import was one of the repo's two intra-module file cycles, which the
   * `no-module-cycles` boundary rule now forbids.
   */
  export async function ensureCleanTreeOnMain(): Promise<void> {
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch !== 'main') {
      throw new Error(`Release must be run from main branch (currently on ${branch}).`);
    }
    const status = await git(['status', '--porcelain']);
    if (status.length > 0) {
      throw new Error('Working tree is not clean. Commit or stash first.');
    }
    await git(['fetch', 'origin', 'main']);
    const local = await git(['rev-parse', 'HEAD']);
    const remote = await git(['rev-parse', 'origin/main']);
    if (local !== remote) {
      throw new Error('Local main is not up to date with origin/main.');
    }
  }
  ```

  The function body is copied verbatim from `src/release/index.ts:46-61`; only the exec helper is local (behavior-identical to `run` with default options: stderr forwarded, stdout trimmed).

- [ ] **Step 2: Delete the definition from index.ts and import it instead**

  In `src/release/index.ts` delete the whole `export async function ensureCleanTreeOnMain(): Promise<void> { … }` block (lines 46-61) and add to the import section:

  ```typescript
  import { ensureCleanTreeOnMain } from './clean-tree.js';
  ```

  The internal call site (≈line 343) and the comment mention (≈line 260) need no change.

- [ ] **Step 3: Repoint release-publish.ts and delete the obsolete cycle apology**

  In `src/release/release-publish.ts` delete the four comment lines (6-9):

  ```typescript
  // `./index.js` ↔ this module is a deliberate ESM cycle — both sides export
  // hoisted function declarations referenced only at call time, and index.ts's
  // own entry guard keys on `process.argv[1]`, so importing it here never fires
  // a release run.
  ```

  and replace line 14:

  ```typescript
  import { ensureCleanTreeOnMain } from './index.js';
  ```

  with:

  ```typescript
  import { ensureCleanTreeOnMain } from './clean-tree.js';
  ```

- [ ] **Step 4: Typecheck and run the release suite — verify PASS**

  ```bash
  pnpm typecheck && pnpm vitest run src/release
  grep -rn "from './index" src/release --include="*.ts"
  ```

  Expected output: typecheck exit 0, release tests pass; grep empty — no file inside release imports the entry module anymore.

- [ ] **Step 5: Commit**

  ```bash
  git add src/release
  git commit -m "refactor(release): extract ensureCleanTreeOnMain to break the index/release-publish cycle" -m "Noldor-FD: self-boundaries-declaration-and-cycle-break"
  ```

---

## Task 6: Extend BoundaryRuleSchema and declare Noldor's 4 boundary rules (failing test first)

The real red-green moment: dep-cruiser's canonical no-cycle rule `{from: {}, to: {circular: true}}` cannot parse under today's schema (`from.path`/`to.path` both required). Test first, watch it fail, extend, watch it pass, then fill `.noldor/config.json` and prove `pnpm noldor invariants run` goes green with real rules.

**Files:**
- Create: `src/core/__tests__/consumer-config-boundaries.test.ts`
- Modify: `src/checks/__tests__/invariants-boundaries.test.ts`, `src/core/consumer-config.ts`, `.noldor/config.json`
- Test: `pnpm vitest run src/core/__tests__/consumer-config-boundaries.test.ts src/checks/__tests__/invariants-boundaries.test.ts`

- [ ] **Step 1: Write the failing schema-shape test**

  Create `src/core/__tests__/consumer-config-boundaries.test.ts` (checks-suite style — vitest globals, no imports from 'vitest'):

  ```typescript
  // @tests: self-boundaries-declaration-and-cycle-break

  import { BoundaryRuleSchema } from '../consumer-config.js';

  describe('BoundaryRuleSchema', () => {
    it('parses the canonical no-cycle backstop rule (empty from, circular to)', () => {
      const rule = {
        name: 'no-module-cycles',
        severity: 'error',
        from: {},
        to: { circular: true },
      };
      const parsed = BoundaryRuleSchema.parse(rule);
      expect(parsed.to.circular).toBe(true);
      expect(parsed.from.path).toBeUndefined();
    });

    it('still parses the classic directional shape', () => {
      const rule = {
        name: 'core-is-foundation',
        severity: 'error',
        from: { path: '^src/core' },
        to: { path: '^src/cr' },
      };
      expect(BoundaryRuleSchema.parse(rule)).toStrictEqual(rule);
    });

    it('rejects a rule whose `to` side constrains nothing', () => {
      const rule = { name: 'vacuous', severity: 'error', from: { path: '^src/core' }, to: {} };
      expect(() => BoundaryRuleSchema.parse(rule)).toThrow(/must constrain/);
    });
  });
  ```

- [ ] **Step 2: Write the failing end-to-end circular test**

  Append inside the `describe('boundaries plugin', …)` block of `src/checks/__tests__/invariants-boundaries.test.ts` (after the last `it`):

  ```typescript
    it('flags a two-file import cycle via a circular backstop rule', async () => {
      await writeFile(
        join(repo, '.noldor/config.json'),
        JSON.stringify({
          consumer: {
            ...TEST_CONFIG.consumer,
            boundaries: [
              { name: 'no-cycles', severity: 'error', from: {}, to: { circular: true } },
            ],
          },
        }),
      );
      await writeFile(
        join(repo, 'packages/engine/src/a.ts'),
        `import { b } from './b.js';\nexport const a: number = b;\n`,
      );
      await writeFile(
        join(repo, 'packages/engine/src/b.ts'),
        `import { a } from './a.js';\nexport const b: number = a;\n`,
      );
      const inv = makeBoundariesInvariant(repo);
      const result = await inv.run();
      expect(result.violations.length).toBeGreaterThanOrEqual(1);
      expect(result.violations[0]?.message).toContain('no-cycles');
    });
  ```

- [ ] **Step 3: Run both tests — verify they FAIL**

  ```bash
  pnpm vitest run src/core/__tests__/consumer-config-boundaries.test.ts src/checks/__tests__/invariants-boundaries.test.ts
  ```

  Expected output: the first and third schema tests fail and the e2e test fails, all with a ZodError containing `"to" … "path" … Required` (the non-strict inner `to` object strips the unknown `circular` key, then requires `path`); the pre-existing boundaries tests still pass.

- [ ] **Step 4: Extend BoundaryRuleSchema in src/core/consumer-config.ts**

  Replace the schema and its stale header comment (the current comment points at removed `FORBIDDEN_RULES` examples):

  ```typescript
  // Boundary rules mirror dependency-cruiser's forbidden-rule shape.
  // `from.path` / `to.path` are REGEX STRINGS consumed by dep-cruiser, not
  // globs. `from` may be empty (`{}` = "any module") and `to.circular: true`
  // expresses dep-cruiser's canonical no-cycle backstop
  // (`{from: {}, to: {circular: true}}`). Each rule must still constrain the
  // `to` side — a rule that forbids nothing is a config typo, not a rule.
  // See this repo's own `.noldor/config.json` consumer.boundaries for live examples.
  export const BoundaryRuleSchema = z
    .object({
      name: z.string().min(1),
      severity: z.enum(['error', 'warn', 'info']),
      from: z.object({ path: z.string().min(1).optional() }),
      to: z.object({
        path: z.string().min(1).optional(),
        circular: z.boolean().optional(),
      }),
    })
    .strict()
    .refine((rule) => rule.to.path !== undefined || rule.to.circular !== undefined, {
      message: 'boundary rule must constrain `to`: set to.path and/or to.circular',
      path: ['to'],
    });
  ```

  `boundaries.ts` already forwards parsed rules verbatim to `cruise(…, { ruleSet: { forbidden: [...boundaries] } })`, so no plugin change is needed.

- [ ] **Step 5: Re-run the tests — verify PASS (old shape still green)**

  ```bash
  pnpm vitest run src/core/__tests__/consumer-config-boundaries.test.ts src/checks/__tests__/invariants-boundaries.test.ts
  ls src/invariants/__tests__ 2>/dev/null && pnpm vitest run src/invariants/__tests__ || true
  ```

  Expected output: all pass — including the two pre-existing directional-rule tests (the extension is additive) and, if present, the earlier drain plan's `src/invariants/__tests__/boundaries.test.ts`.

- [ ] **Step 6: Declare the 4 rules in .noldor/config.json**

  Replace `"boundaries": [],` in the `consumer` block with:

  ```json
  "boundaries": [
    { "name": "no-module-cycles", "severity": "error", "from": {}, "to": { "circular": true } },
    {
      "name": "core-is-foundation",
      "severity": "error",
      "from": { "path": "^src/core" },
      "to": {
        "path": "^src/(cr|garden|sync|features|invariants|release|autonomous|dashboard|prep|triage|verify|metrics|research|worktrees|hooks|checks|cli)"
      }
    },
    {
      "name": "invariants-not-into-garden",
      "severity": "error",
      "from": { "path": "^src/invariants" },
      "to": { "path": "^src/garden" }
    },
    {
      "name": "sync-not-into-garden",
      "severity": "error",
      "from": { "path": "^src/sync" },
      "to": { "path": "^src/garden" }
    }
  ],
  ```

  The directional rules are what catch a re-added `core → cr` edge (dep-cruiser's `circular: true` is file-level and would NOT flag `pr-flow-cli.ts → cr/config`-style directory cycles unless a file-level loop closes); the backstop catches any future file-level cycle anywhere. Scaffold templates are untouched: `templates/.noldor/config.json` keeps `"boundaries": []` and documents no rule shape, so there are no inline docs to update (verified).

- [ ] **Step 7: Run the invariants CLI — verify green with real rules**

  ```bash
  pnpm noldor invariants run
  ```

  Expected output: `✓ 4 invariants passed (…ms wall)` with a `Timings:` block listing `rule-conflicts`, `keyboard-binding`, `public-api-tsdoc`, `boundaries` — proving all six broken cycles stay broken under the live rules. If `boundaries` reports violations here, a moved import from Tasks 1-5 was missed: fix the offending import (never the rules) and re-run.

- [ ] **Step 8: Commit**

  ```bash
  git add src/core/consumer-config.ts src/core/__tests__/consumer-config-boundaries.test.ts src/checks/__tests__/invariants-boundaries.test.ts .noldor/config.json
  git commit -m "feat(invariants): declare real boundary rules for noldor's own module graph" -m "Noldor-FD: self-boundaries-declaration-and-cycle-break"
  ```

---

## Task 7: Retire the keyboard-binding invariant

Charuy-only UI check (zero `area: web` FDs here) and the slowest invariant. Registry shrinks 4 → 3. The garden-detect test that used keyboard-binding as its vehicle for repo-arg forwarding is rewritten against `boundaries` (a bare temp repo has no `.noldor/config.json`, so `boundaries` fails there — but only when the `repo` argument is actually forwarded).

**Files:**
- Delete: `src/invariants/keyboard-binding.ts`, `src/checks/__tests__/invariants-keyboard-binding.test.ts`
- Modify: `src/invariants/index.ts`, `src/garden/__tests__/garden-detect.test.ts`, `docs/features/architecture-invariants.md`, `docs/noldor/script-catalog.md`, `templates/docs/noldor/script-catalog.md`
- Test: `pnpm vitest run src/checks src/garden/__tests__/garden-detect.test.ts`, `pnpm noldor invariants run`

- [ ] **Step 1: Delete the plugin and its test**

  ```bash
  git rm src/invariants/keyboard-binding.ts src/checks/__tests__/invariants-keyboard-binding.test.ts
  ```

- [ ] **Step 2: Remove keyboard-binding from both registries in src/invariants/index.ts**

  Delete line 2 (`import { keyboardBinding, makeKeyboardBindingInvariant } from './keyboard-binding.js';`) and the two registry entries, leaving:

  ```typescript
  export const invariants: readonly Invariant[] = [
    ruleConflicts,
    publicApiTsdoc,
    boundaries,
  ] as const;
  ```

  and:

  ```typescript
  export function makeInvariants(repoRoot: string): readonly Invariant[] {
    return [
      makeRuleConflictsInvariant(repoRoot),
      makePublicApiTsdocInvariant(repoRoot),
      makeBoundariesInvariant(repoRoot),
    ] as const;
  }
  ```

- [ ] **Step 3: Rewrite the repo-arg test in garden-detect.test.ts**

  In the `describe(detectInvariants, …)` suite, replace the entire `it('uses the repo argument instead of process.cwd()', …)` block (≈lines 471-516 — the one that writes `docs/features/keyboard-shortcuts.md` fixtures and asserts `toContain('keyboard-binding')`) with:

  ```typescript
    it('uses the repo argument instead of process.cwd()', async () => {
      const repo = await makeRepo();
      try {
        // The bare temp repo has no .noldor/config.json, so the boundaries
        // invariant fails there — but only if `repo` is actually forwarded
        // (this workspace's own config parses clean and passes).
        const result = await detectInvariants(repo);
        expect(result.map((r) => r.invariant)).toContain('boundaries');
      } finally {
        await rm(repo, { force: true, recursive: true });
      }
    });
  ```

  Then confirm no keyboard reference is left in tests:

  ```bash
  grep -rn "keyboard" src --include="*.ts"
  ```

  Expected output: empty.

- [ ] **Step 4: Update docs/features/architecture-invariants.md**

  Remove from frontmatter `links.code`: the `- src/invariants/keyboard-binding.ts` line; from `links.tests`: the `- src/checks/__tests__/invariants-keyboard-binding.test.ts` line. In the body remove: the `- **keyboard-binding** — every UI feature MD …` bullet (line ≈39), the sentence `Opting out of `keyboard-binding` for a passive UI feature: add `<!-- keyboard: not-applicable -->` to the feature MD body.` (line ≈63), and the two link-list bullets for `src/invariants/keyboard-binding.ts` (≈75) and `src/checks/__tests__/invariants-keyboard-binding.test.ts` (≈82). Add one line to the FD's Changelog section: `- keyboard-binding invariant retired (Charuy-only UI concern; registry is rule-conflicts + public-api-tsdoc + boundaries) — see self-boundaries-declaration-and-cycle-break.`

- [ ] **Step 5: Update the invariants outputs line in the script catalog page AND its template twin**

  In BOTH `docs/noldor/script-catalog.md:58` and `templates/docs/noldor/script-catalog.md:58` replace:

  ```markdown
  - **Outputs:** exit 0 when every invariant passes (rule conflicts, keyboard-binding collisions, public-API tsdoc coverage, package boundaries); exit 1 with the violating rule named.
  ```

  with:

  ```markdown
  - **Outputs:** exit 0 when every invariant passes (rule conflicts, public-API tsdoc coverage, package boundaries); exit 1 with the violating rule named.
  ```

- [ ] **Step 6: Typecheck, run the suites, and see 3/3 green**

  ```bash
  pnpm typecheck
  pnpm vitest run src/checks src/garden/__tests__/garden-detect.test.ts
  pnpm noldor invariants run
  ```

  Expected output: typecheck exit 0; suites pass; CLI prints `✓ 3 invariants passed (…ms wall)` with `keyboard-binding` absent from Timings.

- [ ] **Step 7: Commit code + FD, then the docs/noldor page split (noldor-scope hook)**

  The pre-commit noldor-scope hook requires `docs/noldor/` changes in their own `(noldor)`-scoped commit; the template twin rides with its page (template-sync check).

  ```bash
  git add src/invariants src/checks src/garden/__tests__/garden-detect.test.ts docs/features/architecture-invariants.md
  git commit -m "feat(invariants): retire keyboard-binding invariant" -m "Noldor-FD: self-boundaries-declaration-and-cycle-break"
  git add docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md
  git commit -m "docs(noldor): drop keyboard-binding from the invariants catalog line" -m "Noldor-FD: self-boundaries-declaration-and-cycle-break"
  ```

  Note: if the shared-files guard blocks the twin edit, re-run the second commit as `NOLDOR_ALLOW_SHARED=1 git commit …`.

---

## Task 8: Red-check acceptance — a re-added forbidden edge must flip boundaries red

Spec Verification: the boundaries check is only proven non-vacuous if reintroducing an old edge exits 1. The original `pr-flow-cli.ts → ../cr/config.js` edge can't be re-added literally (that file moved), so re-add the same SHAPE of edge — core importing a still-existing cr module. A type-only import suffices because `boundaries.ts` cruises with `tsPreCompilationDeps: true`. No commit — this task must leave the tree byte-identical.

**Files:**
- Modify (temporarily, then revert): `src/core/pr-flow-cli.ts`
- Test: `pnpm noldor invariants run` (expect exit 1, then exit 0), `pnpm verify`

- [ ] **Step 1: Inject the forbidden core → cr edge and watch boundaries go red**

  ```bash
  printf "\nimport type { Lane as _BoundaryRedCheck } from '../cr/findings-schema.js';\n" >> src/core/pr-flow-cli.ts
  pnpm noldor invariants run; echo "invariants-exit=$?"
  ```

  Expected output: stderr contains `✗ boundaries` with a violation line `forbidden import (core-is-foundation): src/core/pr-flow-cli.ts -> src/cr/findings-schema.ts`, and the final line prints `invariants-exit=1`. If this exits 0, STOP — the rules are vacuous; do not proceed until the red check works.

- [ ] **Step 2: Revert the temporary edge and confirm green again**

  ```bash
  git checkout -- src/core/pr-flow-cli.ts
  pnpm noldor invariants run; echo "invariants-exit=$?"
  ```

  Expected output: `✓ 3 invariants passed (…ms wall)` and `invariants-exit=0`.

- [ ] **Step 3: Run the spec's acceptance greps**

  ```bash
  grep -rn "from '\.\./cr/" src/core; echo "core->cr rc=$?"
  grep -rn "from '\.\./garden/" src/features src/sync; echo "features|sync->garden rc=$?"
  grep -rn "from '\.\./garden/" src/invariants; echo "invariants->garden rc=$?"
  ls src/cr/config.ts 2>/dev/null; echo "shim-check rc=$?"
  ```

  Expected output: every grep empty with `rc=1`, and no `src/cr/config.ts` exists (`shim-check rc=1`) — `loadConfig` lives in `src/core/config.ts` with no re-export shim.

- [ ] **Step 4: Full gate — pnpm verify and a clean tree**

  ```bash
  pnpm verify
  git status --porcelain
  ```

  Expected output: lint + fmt:check + typecheck + full vitest suite all green; `git status --porcelain` prints nothing (all work is in Task 1-7 commits; no commit in this task).
