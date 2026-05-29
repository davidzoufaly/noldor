# Noldor Package Lift — Design

**Status:** Draft
**Parent FD:** [`noldor`](../../features/noldor.md)
**Date:** 2026-05-26

## Problem

Noldor — the dev-loop framework that ships embedded in Charuy — is spread across the repo:

- `docs/noldor/` — 19 framework pages.
- `scripts/{noldor,garden,triage,features,milestones,sync,validate,release,hooks,checks,graphify,dashboard,cr,docs,worktrees,invariants,lib,utils}/` — 18 framework dirs of TS source.
- `scripts/fixtures/` — test fixtures referenced by framework tests in multiple groups (docs-check, features, etc.).
- `scripts/tsconfig.json` + `scripts/package.json` — TS config + script-side manifest for the in-repo framework code.
- `.claude/skills/{gate,garden,triage,promote,draft-feature-md,new-feature,milestone,release-sweep,refactor}/` — 9 framework skills (all 9 in `.claude/skills/` are framework — none are Charuy product-specific).
- `.claude/CLAUDE.md` + `.claude/engineering-rules.md` — framework imports interleaved with Charuy-specific overlays.
- `lefthook.yml` — framework hooks interleaved with project hooks.
- `.noldor/` — runtime state (config, receipts, markers).
- Root `package.json` — ~50 noldor-_ / garden:_ / cr:_ / docs:_ / validate:\* / etc. pnpm script entries, plus `test:scripts` + `typecheck:scripts` that target `scripts/tsconfig.json`.

(Charuy-specific dirs that stay at repo root: `scripts/samples/` — sample-scene builder. `scripts/graphify-out/` — gitignored output dir for graphify runs; not source.)

`docs/noldor/adoption-guide.md` notes the standalone-package lift is in the backlog: paths are hard-coded to `scripts/<group>/`, examples cite Vitest + Manifold WASM, lefthook assumes the live pnpm script set. Other repos can't adopt without copy-and-mangle. Charuy itself can't separate Noldor versioning from Charuy versioning.

## Goal

Lift the entire framework into a single workspace package `noldor` consumed by Charuy via `workspace:*` today, publishable to npm in a followup. Charuy becomes the framework's first real consumer through the same `noldor init` flow any future adopter will use. Operator UX moves from `pnpm garden:detect` to `pnpm noldor garden detect` — a single CLI surface with subcommand discovery.

## Non-Goals

- **No npm publish** in this PR. Package declares `private: false` but no publish CI / npm org / release tag work happens here. Followup.
- **No multi-package split** (`@noldor/core` + `@noldor/cr` etc.). Single `noldor` package. Split later if scale justifies.
- **No second adopter** validated. Only Charuy. Generic-stripping pass (revisit `adoption-guide.md`) is a followup once a second consumer exists.
- **No behavior changes** to validators, hooks, garden detectors, CR pipeline, FD schema, gate paths. This is a pure lift + rename — same code, new home.
- **No semver-major / 1.0 cut.** Pre-1.0 convention holds; bump Charuy to 0.7.0.

## Architecture

### Package shape

`packages/noldor/` in the existing pnpm workspace.

```
packages/noldor/
├── src/
│   ├── cli/
│   │   ├── index.ts                  # bin entry, subcommand router
│   │   └── commands/
│   │       ├── garden.ts             # noldor garden <subsubcommand>
│   │       ├── cr.ts
│   │       ├── triage.ts
│   │       ├── features.ts
│   │       ├── milestones.ts
│   │       ├── sync.ts
│   │       ├── validate.ts
│   │       ├── release.ts
│   │       ├── hooks.ts
│   │       ├── checks.ts
│   │       ├── graphify.ts
│   │       ├── dashboard.ts
│   │       ├── docs.ts               # docs api/howto/check/transclude/build
│   │       ├── invariants.ts         # boundaries/keyboard-binding/public-api-tsdoc/rule-conflicts
│   │       ├── worktrees.ts          # status/launch
│   │       ├── pr-flow.ts
│   │       ├── changelog.ts          # hoisted from noldor/ (top-level)
│   │       ├── next-priority.ts      # hoisted
│   │       ├── init.ts               # scaffold templates → consumer
│   │       └── doctor.ts             # drift check
│   ├── garden/                       # lifted from scripts/garden/
│   ├── cr/
│   ├── triage/
│   ├── features/
│   ├── milestones/
│   ├── sync/
│   ├── validate/
│   ├── release/
│   ├── hooks/
│   ├── checks/
│   ├── graphify/
│   ├── dashboard/
│   ├── docs/                         # lifted from scripts/docs/ (docs-api/howto/check/transclude)
│   ├── worktrees/                    # lifted from scripts/worktrees/
│   ├── invariants/                   # lifted from scripts/invariants/
│   ├── noldor/                       # lifted from scripts/noldor/
│   ├── utils/                        # from scripts/utils/
│   ├── lib/                          # from scripts/lib/
│   ├── fixtures/                     # lifted from scripts/fixtures/ (test fixtures)
│   ├── templates/                    # init/doctor RESOLVER helpers (NOT the asset dir below):
│   │   ├── manifest.ts               #   TEMPLATES_ROOT = join(dirname(fileURLToPath(import.meta.url)),'..','..','templates') + templateFiles()
│   │   ├── diff.ts                   #   computeDrift() — doctor
│   │   └── copy.ts                   #   copyTemplate()/adoptTemplate() — init
│   └── index.ts                      # library exports
├── templates/                        # ASSET dir (shipped in files[]); resolved from src/templates/ via the 2-level walk above
│   ├── docs/noldor/                  # mirror of current docs/noldor/ minus engineering-principles.md (excluded at step 5; consumer copy dropped at 7.3)
│   ├── .claude/
│   │   ├── skills/                   # framework skills only
│   │   ├── noldor.md                 # framework imports fragment
│   │   └── engineering-rules.md      # Noldor baseline (current engineering-principles.md content)
│   └── lefthook/
│       └── noldor.yml                # framework hook block
├── bin/
│   └── noldor.mjs                    # tsx-runtime wrapper (bin entry; see package.json)
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

Test files are colocated next to the modules they cover as `src/<group>/__tests__/*.test.ts` (the `tsconfig.json` `exclude` and `vitest.config.ts` `include` globs in the plan both key off `src/**/__tests__/**`). There is no top-level `__tests__/` dir — the earlier draft's sibling-of-`src/` entry was dropped to match the plan's colocated layout. `src/fixtures/` holds shared test fixtures and is excluded from the build.

### `package.json`

```json
{
  "name": "noldor",
  "version": "0.0.0",
  "private": false,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": { "noldor": "./bin/noldor.mjs" },
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./templates/*": "./templates/*"
  },
  "files": ["dist", "bin", "templates"],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist .turbo"
  }
}
```

**Bin entry shape (decided):** `bin/noldor.mjs` is a tsx-runtime wrapper, not compiled output. Shape:

```js
#!/usr/bin/env node
import { register } from 'tsx/esm/api';
register();
await import('../src/cli/index.ts');
```

Rationale: workspace consumption (Charuy) and dev iteration need zero-build-step invocation — every hook fires pre-commit, so requiring `pnpm build` before any `pnpm noldor ...` invocation would break the verify chain (Critical finding from review). The wrapper loads TS source directly via tsx. Compiled `dist/` is still produced for typed library exports (`import { foo } from 'noldor'`) and for future npm-published consumers who prefer plain JS — that route gets a different `bin` (`./dist/cli/index.js`) selected at publish time via a publishConfig override or two-manifest build. Windows: pnpm generates `.cmd` shim from `bin` automatically; the wrapper's `#!/usr/bin/env node` shebang is portable.

**Dependencies (final partition):**

| Dep                                                  | Lives in `noldor` pkg | Stays in root devDeps | Reason                                                                 |
| ---------------------------------------------------- | --------------------- | --------------------- | ---------------------------------------------------------------------- |
| `@inquirer/prompts`                                  | ✓                     |                       | Used by triage, gate skill scripts                                     |
| `gray-matter`                                        | ✓                     |                       | Frontmatter parsing across all framework modules                       |
| `yaml`                                               | ✓                     |                       | Noldor config + frontmatter                                            |
| `zod` + `zod-to-json-schema`                         | ✓                     |                       | Schemas for FD / CR findings / config                                  |
| `semver`                                             | ✓                     |                       | Versioning + release                                                   |
| `minimatch`                                          | ✓                     |                       | Garden detector globs                                                  |
| `marked` + `marked-highlight` + `highlight.js`       | ✓                     |                       | Dashboard markdown rendering                                           |
| `dependency-cruiser`                                 | ✓                     |                       | Invariants (boundaries check)                                          |
| `tsx`                                                | ✓                     | ✓                     | Pkg for bin wrapper; root keeps for `scripts/samples/build-samples.ts` |
| `typescript` + `vitest` + `@types/node`              | ✓                     | ✓                     | Per-pkg devDeps standard; root keeps for monorepo tooling              |
| `oxfmt`, `oxlint`, `lefthook`                        |                       | ✓                     | Repo-wide tooling, consumer concern                                    |
| `playwright`, `three`, `@types/three`, `manifold-3d` |                       | ✓                     | Charuy product deps                                                    |
| `turbo`                                              |                       | ✓                     | Monorepo orchestrator                                                  |

Final list reconciled when imports are codemodded — any missing dep surfaces as typecheck failure.

### CLI router

`src/cli/index.ts` — switch on `argv[2]`, dispatch to `commands/<group>.ts`. Each `commands/<group>.ts` re-switches on `argv[3]` to its subsubcommand. Pure stdlib; no `commander` / `yargs` dependency. `noldor --help` prints a table of `<group> <subcmd>` rows derived from a static manifest.

### Library exports

`src/index.ts` re-exports public APIs (`garden.detect`, `cr.orchestrate`, `features.validate`, `triage.score`, etc.) for programmatic use. Consumer scripts may import them directly — preserves the option for Charuy-internal tooling to call framework code without spawning a CLI.

### Working-dir contract

Two distinct roots, never conflated:

- **Consumer state → `process.cwd()`.** All consumer-owned and template-managed files are read/written relative to the consumer repo root: `<cwd>/.noldor/`, `<cwd>/docs/noldor/`, `<cwd>/.claude/`, `<cwd>/docs/features/`, etc. The package never reads its own install location for consumer state.
- **Package assets → `import.meta.url`.** The pkg's own bundled `templates/` dir is a package asset, not consumer state, so it resolves relative to the running module's location, never `cwd`. Resolution mechanism (single helper, `src/templates/manifest.ts`): `TEMPLATES_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates')`. This works identically whether the pkg is consumed via `workspace:*` symlink (Charuy today) or installed flat under `node_modules/noldor/` (future npm adopter), because `import.meta.url` always points at the real on-disk module. `require.resolve('noldor/templates/...')` is the fallback if the relative walk ever proves brittle; the `exports["./templates/*"]` subpath in `package.json` keeps that route open. No `cwd`-relative path ever reaches into `templates/`.

This is why the contract is not violated by `init`/`doctor` reading `templates/` from the pkg dir: those are pkg assets resolved via `import.meta.url`; only the diff/copy _targets_ resolve via `cwd`.

### Templates and drift model

Pkg ships canonical templates. `noldor init` copies to consumer paths (committed). `noldor doctor` diffs consumer copy vs pkg version. Drift is an error.

| Template path                              | Consumer path                    | Owner         |
| ------------------------------------------ | -------------------------------- | ------------- |
| `templates/docs/noldor/*.md`               | `docs/noldor/*.md`               | template      |
| `templates/.claude/skills/<name>/SKILL.md` | `.claude/skills/<name>/SKILL.md` | template      |
| `templates/.claude/noldor.md`              | `.claude/noldor.md`              | template      |
| `templates/.claude/engineering-rules.md`   | `.claude/engineering-rules.md`   | template      |
| `templates/lefthook/noldor.yml`            | `lefthook/noldor.yml`            | template      |
| —                                          | `.claude/CLAUDE.md`              | consumer      |
| —                                          | `.claude/<consumer>-overlay.md`  | consumer      |
| —                                          | `lefthook.yml`                   | consumer      |
| —                                          | `.noldor/` (runtime state)       | consumer (rt) |

#### Commands

- `noldor init` — first-time scaffold. Refuses if any target file exists unless `--adopt`. Writes templates → consumer paths. Creates empty `.noldor/` and `.noldor/config.json` with defaults.
- `noldor init --update` — re-copies all template-managed files. Idempotent. Reports each file: `unchanged | updated | added`.
- `noldor init --adopt` — Charuy migration mode. Reads current consumer files, copies them INTO `packages/noldor/templates/` (one-time bootstrap from real-world state), then runs init normally. Post-run diff must be empty — proves templates == consumer state. **Monorepo-bootstrap-only:** adopt writes into the pkg's own `templates/` dir, which is only editable when the pkg lives in-tree (`workspace:*`). For an npm-installed pkg under `node_modules/noldor/` the write is ephemeral (blown away on reinstall), so adopt is meaningless there — it exists solely to bootstrap the first-party templates from Charuy's pre-lift state, never as a general adopter flow. Downstream adopters use `init` / `init --update` only.
- `noldor doctor` — diffs every template-managed file (sha256) against pkg version. Reports drift per file. Exit code 1 on any drift. Suggests `init --update` or `init --adopt`.

Skill files are copied (not symlinked) — Claude Code resolves `.claude/skills/` relative to repo without symlink follow.

#### Evolving the framework in the first-party dev repo (Charuy)

`noldor doctor` treats consumer drift as an error and runs inside `verify`. That is correct for a downstream adopter, but Charuy is the **first-party development repo** — the place where the framework itself changes. The two are reconciled by a single rule: **in Charuy, the canonical source for any template-managed file is the template under `packages/noldor/templates/…`, not the consumer copy.**

So a framework edit (new `docs/noldor/*.md` rule, skill change, baseline-rule change) is a two-file commit:

1. Edit the template: `packages/noldor/templates/docs/noldor/<page>.md` (or the skill / rules template).
2. Run `pnpm noldor init --update` to propagate the change to the consumer path (`docs/noldor/<page>.md`).
3. Commit both together. `noldor doctor` stays green because consumer == template after the sync.

Never hand-edit the consumer `docs/noldor/*.md` / `.claude/skills/*` / `.claude/engineering-rules.md` copies directly in Charuy — that is exactly the drift `doctor` exists to catch. The consumer copies are build output of `init --update`, kept committed only so Claude Code can read them at consumer-root paths (`@docs/noldor/...`, `.claude/skills/...`).

**Consumer-doc convention update (lands in step 7):** the current `.claude/CLAUDE.md` line "save project-framework rules to the matching `docs/noldor/*.md`" is rewritten to "edit the matching `packages/noldor/templates/docs/noldor/*.md`, then `pnpm noldor init --update`." A pre-commit guard (followup, not gating this PR) can reject staged hand-edits to template-managed consumer paths when the corresponding template is unchanged — surfaced as an open question below, not built here.

A pure downstream adopter (no `packages/noldor/` in their tree, pkg installed from npm) cannot edit templates and simply consumes `init --update` on framework version bumps — the drift=error rule is unambiguous for them. The first-party-dev workflow above applies only to repos that vendor the pkg source.

### Consumer-side surface (Charuy post-migration)

**Root `package.json` (slimmed):**

```json
{
  "name": "charuy",
  "private": true,
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "clean": "turbo run clean",
    "lint": "oxlint --deny-warnings",
    "lint:fix": "oxlint --fix",
    "fmt": "oxfmt --ignore-path=.gitignore --ignore-path=.prettierignore --ignore-path=\"$(git rev-parse --git-common-dir)/info/exclude\"",
    "fmt:check": "oxfmt --check --ignore-path=.gitignore --ignore-path=.prettierignore --ignore-path=\"$(git rev-parse --git-common-dir)/info/exclude\"",
    "dashboard": "noldor dashboard",
    "test:smoke": "pnpm --filter @charuy/web exec playwright test --config=playwright.config.ts --grep @smoke",
    "test:e2e": "pnpm --filter @charuy/web exec playwright test --config=playwright.config.ts",
    "test:coverage": "turbo run test -- --coverage",
    "build:samples": "tsx scripts/samples/build-samples.ts apps/web/public/samples",
    "verify": "pnpm lint && pnpm fmt:check && pnpm typecheck && pnpm build:samples && pnpm test && pnpm noldor doctor",
    "postinstall": "lefthook install"
  },
  "devDependencies": {
    "noldor": "workspace:*"
  }
}
```

All ~50 framework script entries removed. Operator typing `pnpm noldor <group> <cmd>` for everything framework.

**`.claude/CLAUDE.md` (short, consumer-owned):**

```markdown
# Charuy — Project Rules

@.claude/noldor.md
@.claude/charuy-overlay.md

## Project

See README.md for project description, architecture, packages, tech stack, pipeline overview.

## Where project rules live

Framework-scoped rules are template-managed: edit the matching `packages/noldor/templates/docs/noldor/*.md` page, then `pnpm noldor init --update` to sync the consumer copy, and commit both. Never hand-edit `docs/noldor/*.md` directly — `noldor doctor` (in `verify`) treats that as drift. Charuy-specific overlays go to `.claude/charuy-overlay.md`. CLAUDE.md stays short.
```

**`.claude/noldor.md` (template-managed):**

```markdown
# Noldor Framework

@docs/noldor/README.md
@.claude/engineering-rules.md

`docs/noldor/README.md` is the framework's route table. Before any change open the matching page from there. `.claude/engineering-rules.md` carries the Noldor baseline (single source; the old `docs/noldor/engineering-principles.md` page is dropped — see resolved open question).

## Gate

`/gate` mandatory before any code edit. Bypass via `Noldor-Path-Override: <reason>` only when genuinely unavoidable.
```

**`.claude/engineering-rules.md` (template-managed):** Noldor baseline (current `docs/noldor/engineering-principles.md` content lifted as the framework's baseline rules). Read-only from consumer perspective.

**`.claude/charuy-overlay.md` (consumer-owned):** Charuy-specific engineering rules (current `.claude/engineering-rules.md` overlay content moved here).

**`lefthook.yml` (consumer-owned):**

```yaml
extends:
  - ./lefthook/noldor.yml

pre-commit:
  parallel: true
  commands:
    samples-build:
      glob: 'scripts/samples/**'
      run: pnpm build:samples
    # Charuy-specific hooks only
```

**`lefthook/noldor.yml` (template-managed):** framework hooks (inject-trailers, validate-trailer, enforce-review-receipt, pre-commit validators, pre-push). All `run:` lines call `pnpm noldor hooks <name>`.

**`docs/noldor/*` + `.claude/skills/*` (template-managed):** copies of pkg templates. `noldor doctor` enforces no drift.

**`.noldor/` (consumer-owned runtime):** unchanged. config.json, rollout-marker, garden-receipt/, review-receipt/, release-pushes.log, overrides.log.

### Operator cheatsheet (committed alongside PR)

| Old                           | New                                           |
| ----------------------------- | --------------------------------------------- |
| `pnpm garden:detect`          | `pnpm noldor garden detect`                   |
| `pnpm cr:orchestrate`         | `pnpm noldor cr orchestrate`                  |
| `pnpm cr:codex`               | `pnpm noldor cr codex`                        |
| `pnpm cr:aggregate`           | `pnpm noldor cr aggregate`                    |
| `pnpm cr:escalate`            | `pnpm noldor cr escalate`                     |
| `pnpm validate:noldor`        | `pnpm noldor validate noldor`                 |
| `pnpm validate:features`      | `pnpm noldor validate features`               |
| `pnpm validate:milestones`    | `pnpm noldor validate milestones`             |
| `pnpm validate:triage`        | `pnpm noldor validate triage`                 |
| `pnpm validate:skill-catalog` | `pnpm noldor validate skill-catalog`          |
| `pnpm noldor:changelog`       | `pnpm noldor changelog`                       |
| `pnpm next-priority`          | `pnpm noldor next-priority`                   |
| `pnpm pr-flow`                | `pnpm noldor pr-flow`                         |
| `pnpm sdd:report`             | `pnpm noldor garden sdd-report`               |
| `pnpm garden:receipt`         | `pnpm noldor garden receipt`                  |
| `pnpm sync:doc-links`         | `pnpm noldor sync doc-links`                  |
| `pnpm sync:test-links`        | `pnpm noldor sync test-links`                 |
| `pnpm sync:spec-links`        | `pnpm noldor sync spec-links`                 |
| `pnpm sync:fd-resources`      | `pnpm noldor sync fd-resources`               |
| `pnpm triage:list-untriaged`  | `pnpm noldor triage list-untriaged`           |
| `pnpm triage:score`           | `pnpm noldor triage score`                    |
| `pnpm release`                | `pnpm noldor release`                         |
| `pnpm docs:build`             | `pnpm noldor docs build`                      |
| `pnpm docs:api`               | `pnpm noldor docs api`                        |
| `pnpm docs:howto`             | `pnpm noldor docs howto`                      |
| `pnpm docs:check`             | `pnpm noldor docs check`                      |
| `pnpm docs:transclude`        | `pnpm noldor docs transclude`                 |
| `pnpm check:invariants`       | `pnpm noldor check invariants`                |
| `pnpm check:shared-files`     | `pnpm noldor check shared-files`              |
| `pnpm hook:noldor:*`          | `pnpm noldor hooks <name>`                    |
| `pnpm dashboard`              | `pnpm noldor dashboard` (root alias retained) |
| `pnpm verify`                 | unchanged (root alias)                        |

Subcommand naming follows current script names — minimal cognitive load. Final mapping reconciled at implementation; the table is illustrative.

## Migration Plan

Big-bang single PR on `feat/noldor-package-lift` in a worktree per `worktree-discipline.md`.

### Order of operations

1. **Scaffold pkg shell** — create `packages/noldor/{package.json, tsconfig.json, vitest.config.ts, src/cli/index.ts, src/index.ts}`. CLI prints "noldor v0" stub. `pnpm install` picks up workspace.
2. **Move script groups** — `git mv` each of `scripts/{noldor,garden,triage,features,milestones,sync,validate,release,hooks,checks,graphify,dashboard,cr,docs,worktrees,invariants,lib,utils,fixtures}/` → `packages/noldor/src/<group>/`. Preserves git history per file. Update any test-side `scripts/fixtures/<file>` path literals to `<relative-path>/fixtures/<file>` post-move.
3. **Fix imports** — codemod relative paths inside moved files. Most stay intra-package (relative). External imports lift to `packages/noldor/package.json` deps.
4. **Build subcommand router** — author `src/cli/index.ts` + `src/cli/commands/<group>.ts` files. Each dispatches subsubcommand to existing group entrypoints.
5. **Templates dir** — copy current `docs/noldor/` (**excluding `engineering-principles.md`** — it is being dropped, step 7.3), `.claude/skills/{gate,garden,triage,promote,draft-feature-md,new-feature,milestone,release-sweep,refactor}/`, derive `templates/.claude/noldor.md` from current `.claude/CLAUDE.md` framework block, derive `templates/.claude/engineering-rules.md` from current `docs/noldor/engineering-principles.md`, derive `templates/lefthook/noldor.yml` by extracting framework hooks from current `lefthook.yml`. (The `templates/.claude/engineering-rules.md` derived here is later overwritten by an identical consumer copy during step 7.6 adopt — this derivation is a convenience so the template exists pre-adopt, not load-bearing.)
6. **Implement `init` + `doctor`** — file copy + sha256 diff. `--adopt` mode for Charuy bootstrap.
7. **Charuy consumer wire-up.** `init --adopt` snapshots whatever currently sits at each consumer path _into_ the template, so every consumer file must already be in its final post-migration shape **before** adopt runs. Ordering is load-bearing — especially for `.claude/engineering-rules.md`, whose meaning flips owner (today = Charuy overlay; post-lift = template-owned Noldor baseline). Execute in this exact order:
   1. **Relocate the Charuy overlay out of the baseline path first.** Author `.claude/charuy-overlay.md` from the Charuy-specific content currently in `.claude/engineering-rules.md` + `.claude/CLAUDE.md`. This empties the overlay out of `.claude/engineering-rules.md`.
   2. **Write the Noldor baseline into the consumer baseline path.** Overwrite `.claude/engineering-rules.md` with the content of `docs/noldor/engineering-principles.md` (the framework baseline). Step 5 ("Templates dir") already derived `templates/.claude/engineering-rules.md` from that same content, so the template is the canonical home; the standalone `docs/noldor/engineering-principles.md` page **is dropped** (substep 3 below performs the deletion). Now the consumer path holds the baseline, not the overlay.
   3. **Drop `docs/noldor/engineering-principles.md`.** Its content is now captured in both the template baseline (`templates/.claude/engineering-rules.md`) and the consumer baseline (`.claude/engineering-rules.md`), so the standalone page is removed on both sides: `git rm docs/noldor/engineering-principles.md`, and delete `templates/docs/noldor/engineering-principles.md` if step 5's `docs/noldor/` copy captured it (step 5 is instructed to exclude it). **Orphan caveat:** `noldor doctor` only diffs files still present in the template manifest, so a dropped page leaves _no_ drift coverage for a leftover consumer copy — the deletion must be explicit in this PR (both sides), never deferred to `init --update`. Step 10's reference sweep repoints the `@docs/noldor/engineering-principles.md` imports and the `docs/noldor/README.md` route-table link.
   4. **Rewrite `.claude/CLAUDE.md`** to the short product head + `@.claude/noldor.md` + `@.claude/charuy-overlay.md` imports.
   5. **Rewrite `lefthook.yml`** to `extends: ./lefthook/noldor.yml` + Charuy-only hooks (samples / web / playwright).
   6. **Run `noldor init --adopt`** — now snapshots the _correct_ consumer state (baseline at `.claude/engineering-rules.md`, synced `docs/noldor/` with `engineering-principles.md` already removed, framework skills, `lefthook/noldor.yml`) into `packages/noldor/templates/`. Must produce zero diff after, proving templates == post-migration consumer state.
   7. **Run `noldor doctor`** — must report zero drift. If non-empty, a consumer file was not in final shape before adopt (re-check ordering above), or a template needs a manual fix.

   After adopt completes, the template is canonical; subsequent framework edits follow the first-party-dev two-file workflow (edit template → `init --update` → commit both), never the consumer path directly.

8. **Delete legacy `scripts/` dirs** — all moved groups deleted from repo root. `scripts/samples/` stays (Charuy-specific). `scripts/graphify-out/` stays (gitignored output dir). Verify `scripts/` final contents: `samples/` (source) + `graphify-out/` (gitignored). Delete `scripts/tsconfig.json` and `scripts/package.json` — pkg has its own. `scripts/samples/` doesn't need a tsconfig (root `tsconfig.base.json` + tsx runtime cover it); confirm via `pnpm build:samples` post-delete.
9. **Strip root `package.json` scripts** — drop ~50 framework entries including `test:scripts` and `typecheck:scripts`. Keep Charuy-only: build, dev, test, typecheck, clean, fmt, lint, verify, test:smoke, test:e2e, test:coverage, build:samples, dashboard, postinstall. Framework test coverage now flows through `turbo run test` (which picks up `noldor` pkg's `vitest run`) — verify gate retains framework tests automatically.
10. **Rewrite framework command references** — every `pnpm hook:noldor:*` → `pnpm noldor hooks <name>`, every SKILL.md script ref in moved skill files → `pnpm noldor <group> <cmd>`, every doc ref in `docs/noldor/script-catalog.md` + adjacent pages + the `docs/noldor/README.md` route table, plus the `@docs/noldor/engineering-principles.md` import repoint from step 7.3.

    **Sequencing (load-bearing — these are template-managed files, edited after step 7.6 adopt).** The command-ref targets at template-managed paths are `docs/noldor/*`, `.claude/skills/*`, and `.claude/noldor.md`. `lefthook/noldor.yml` is also template-managed but is authored fresh in step 5 already using the new `pnpm noldor hooks <name>` form, so it needs no migration sweep here; if it ever did, it would route through the template the same way. The only consumer-owned files are root `lefthook.yml` and root `package.json`, both already finalized (steps 7.5 / 9) and outside this content sweep. Adopt (7.6) already snapshotted the pre-sweep content of the template-managed docs/skills into the template, so editing the consumer copies directly here would re-introduce drift and fail step 11's `doctor`. Do the sweep the steady-state way: **edit the `packages/noldor/templates/…` copy, then `pnpm noldor init --update` to propagate to the consumer paths, then commit both.** A final `pnpm noldor doctor` (or step 11's `verify`, which runs it) then passes because template == consumer. This is the same first-party-dev two-file workflow prescribed in "Evolving the framework"; the only ordering rule is that template-managed content edits route through the template + `init --update`, never the consumer copy, once adopt has run.

11. **Run validation gates** — see below.
12. **CHANGELOG + version bump** — Charuy 0.6.0 → 0.7.0 per Noldor `versioning.md`. Noldor pkg ships `0.0.0` (no publish in this PR).

### Charuy-specific overlay extraction

Current `.claude/CLAUDE.md` (~80 lines) split:

- Framework section (`## Framework — ALWAYS READ FIRST`, `## Engineering Rules` imports, `## Gate`) → `templates/.claude/noldor.md`.
- Charuy product header (`# Charuy — Project Rules`, `## Project`, `## Where project rules live`) → consumer `.claude/CLAUDE.md`.
- Current `.claude/engineering-rules.md` Charuy-specific overlays → `.claude/charuy-overlay.md`.
- Current `docs/noldor/engineering-principles.md` content → `templates/.claude/engineering-rules.md` (becomes the framework baseline, surfaced at the consumer as `.claude/engineering-rules.md`). **Decided:** `docs/noldor/engineering-principles.md` is dropped as a standalone page — single source is the template baseline. Step 10's reference sweep must catch every `@docs/noldor/engineering-principles.md` import (notably `.claude/noldor.md`) and every route-table link in `docs/noldor/README.md`, repointing them to `.claude/engineering-rules.md` or removing them.

### Skill manifest

Framework skills (all 9 currently in `.claude/skills/`): gate, garden, triage, promote, draft-feature-md, new-feature, milestone, release-sweep, refactor. All move to `templates/.claude/skills/`. None identified as Charuy product-specific. Confirmation pass at implementation.

Out of scope: the user-global `~/.claude/skills/graphify/` skill (and `graphify-setup`) lives at user level — not project `.claude/skills/`. The pkg ships `src/graphify/` as the _runner_ that those global skills invoke via `pnpm noldor graphify ...`. Template manifest is project-skills-only.

### Validation gates (must pass pre-PR)

- `pnpm verify` green end-to-end.
- `pnpm noldor doctor` reports zero drift.
- Pre-migration baselines captured before any move:
  - `pnpm garden:detect > /tmp/garden-pre.txt`
  - `pnpm sdd:report > /tmp/sdd-pre.txt`
  - `pnpm validate:noldor > /tmp/val-pre.txt`
    Post-migration equivalents (`pnpm noldor garden detect`, etc.) must produce diffs only in path references (acceptable when receipt files cite the new package path). No semantic deltas.
- Lefthook pre-commit + pre-push fire and pass on a sample commit.
- Manually run gate path: scaffold dummy FD, `pnpm noldor features validate`, `pnpm noldor cr orchestrate` (dry-run). Confirm OK.
- Existing FDs in `docs/features/` validated by new code paths — no regressions.

### Risks

| Risk                                                                                                                                                                                                                                                   | Mitigation                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Huge PR (touching ~200+ files), reviewer fatigue                                                                                                                                                                                                       | PR description includes mapping table + per-step diff anchors + before/after CLI cheatsheet. Worktree commit boundaries follow order-of-ops list.                                                                                                                                                 |
| Subagent / skill memory bias issuing old `pnpm scripts/...` commands                                                                                                                                                                                   | Grep all SKILL.md for old script refs; rewrite all in same PR. Add `garden:detect`-style stub scripts that error with hint message? Decide at implementation.                                                                                                                                     |
| Garden detectors glob `scripts/**` and miss new `packages/noldor/src/**` location                                                                                                                                                                      | Audit each detector at `scripts/garden/detectors/`; rewrite globs to `packages/noldor/src/**` where applicable. Verify against pre-migration baseline.                                                                                                                                            |
| `.noldor/config.json` may need schema update (path roots)                                                                                                                                                                                              | Bump config schema if needed; include in-place migrator triggered by `noldor doctor` / `noldor init --update`. Validate against existing Charuy config.                                                                                                                                           |
| Test fixtures hardcode `scripts/...` paths                                                                                                                                                                                                             | Grep `__tests__/` for `scripts/` string literals; fix referenced paths. Run full test suite as part of validation gates.                                                                                                                                                                          |
| Lefthook `extends:` semantics — order of merge, conflict resolution between framework + project hooks                                                                                                                                                  | Verify against lefthook docs at implementation. Fall back to inline framework hooks if `extends` proves insufficient.                                                                                                                                                                             |
| Charuy `noldor doctor` produces non-empty diff post-migration                                                                                                                                                                                          | Means templates ≠ current state. Iterate: re-run `init --adopt`, inspect diff, fix template. Block PR until diff empty.                                                                                                                                                                           |
| Big-bang failure mid-PR — partially migrated state checked in to worktree                                                                                                                                                                              | Worktree is throwaway. Rollback = drop branch. No production state changed until merge.                                                                                                                                                                                                           |
| `pnpm noldor` resolves to compiled `dist/` that may not exist on first install / cold cache → every hook breaks                                                                                                                                        | Decided above: `bin` points at `bin/noldor.mjs` tsx wrapper loading `src/` directly. No build step required for CLI invocation. Compiled `dist/` produced for library imports + future npm publish, separate route.                                                                               |
| Turbo `test.dependsOn: ["build"]` will trigger `noldor build` before tests; chain depth grows with apps consuming `noldor`. Stale `dist/` between rebuilds yields stale library imports for any Charuy script that uses `import { foo } from 'noldor'` | Charuy currently has zero such imports — root scripts all run through CLI. Audit during step 3 (fix imports). If a Charuy-side TS file imports from `noldor` library, mark turbo `dependsOn: ["noldor#build"]` explicitly. Document in turbo task chain.                                          |
| `scripts/release/` cwd / monorepo-layout assumptions — release pipeline reads `CHANGELOG.md` at repo root, expects monorepo working dir                                                                                                                | Working-dir contract says `process.cwd()` is consumer root. Audit `release/index.ts` + sub-scripts at step 3; any hardcoded `scripts/`-relative paths get rewritten relative to `process.cwd()`. Test by running `pnpm noldor release --dry-run` post-migration before stripping legacy scripts.  |
| Windows bin resolution: `bin/noldor.mjs` shebang `#!/usr/bin/env node` is portable; pnpm generates `.cmd` shim automatically. But `tsx/esm/api` register hook may behave differently on Win32.                                                         | Charuy is darwin/linux only today. Defer Windows validation to first Windows-using adopter (followup PR). Flag in `adoption-guide.md`.                                                                                                                                                            |
| Claude Code `@.claude/noldor.md` import resolution — `@` paths in CLAUDE.md resolve relative to consumer repo root, not pkg root. Templates target consumer-root paths.                                                                                | Templates ship as files copied to consumer repo paths; Claude reads them at consumer root. No pkg-relative `@` imports anywhere. Confirmed in section "Templates and drift model" — re-verify in implementation by grepping `templates/.claude/noldor.md` for stray `@packages/noldor/...` paths. |

### Rollback

Drop the branch. Worktree contains all work. No production state changed until merge. Pre-migration baselines (`/tmp/garden-pre.txt`, etc.) inform any post-merge debugging.

## Out of Scope

- npm publish workflow (private: false set, publish CI is followup PR).
- Multi-consumer story validated. `noldor init` implemented but only Charuy proves the flow.
- Test fixtures for `noldor init` against synthetic external repo. Useful but not gating.
- Generic-stripping documentation review per current `adoption-guide.md`. Stays a stub; rewrite is followup once second adopter validates the flow.
- Splitting `noldor` into `@noldor/core` + `@noldor/cr` etc. Single package now; split later only if scale demands.
- Behavior changes inside any framework module (CR pipeline schemas, garden detectors, FD schema, etc.). Pure lift.

## Open Questions (resolve at implementation)

- Final subcommand naming for hoisted top-level commands (`changelog`, `pr-flow`, `next-priority`, `dashboard`). Two viable patterns: hoist as top-level (`noldor changelog`) or keep grouped (`noldor noldor changelog`). Cheatsheet table shows hoisted; finalize during CLI router build.
- ~~`docs/noldor/engineering-principles.md` fate~~ **Resolved: dropped.** Single source is the template baseline (`templates/.claude/engineering-rules.md` → consumer `.claude/engineering-rules.md`). Step 10's reference sweep repoints/removes the `@docs/noldor/engineering-principles.md` imports and route-table links.
- **Pre-commit guard for hand-edited template-managed consumer paths** (rejects a staged edit to `docs/noldor/*.md` / `.claude/skills/*` / `.claude/engineering-rules.md` when the corresponding `packages/noldor/templates/…` file is unchanged in the same commit, steering edits through the template + `init --update` workflow): worth adding but **out of scope for this PR** — `noldor doctor` in `verify` already catches the drift after the fact. Flag for a followup.
- Stub scripts (`garden:detect`, etc.) in root `package.json` that error out with "renamed to `pnpm noldor garden detect`" — convenience for muscle memory or noise? Default: no stubs; clean break.
- Migration helper script (`packages/noldor/scripts/migrate-from-monorepo.ts`) — author or skip? Default: skip. PR diff IS the migration; commits follow order-of-ops list and are reproducible by inspection. Add only if reviewer asks.
- Version pinning between Charuy and Noldor pkg once npm-published. For now `workspace:*` is fine.
- Two-manifest publish vs single-manifest with `publishConfig` override for the npm-flavor `bin` swap (`bin/noldor.mjs` tsx wrapper → `dist/cli/index.js` compiled). Defer to first publish PR.
- Drift-allowance mechanism for templates: future consumers may need to customize `lefthook/noldor.yml` (e.g., `npm` instead of `pnpm` prefix). Either template variables (mustache-style) or per-file `.noldor-drift-allowed` opt-in. Out of scope for Charuy-only flow; flag for second-adopter pass.
- Shell-completion: current `pnpm <TAB>` completes script names; post-lift `pnpm noldor <TAB>` won't enumerate subcommands. DX regression, not blocking. Optional: ship completion scripts under `templates/completions/` in followup.

## Related

- `docs/noldor/adoption-guide.md` — current stub describing the lift as a backlog item.
- `docs/backlog.md` — "Lifting Noldor into a standalone repo / npm package" entry (to mark resolved by this PR).
- `docs/features/noldor.md` — parent FD.
