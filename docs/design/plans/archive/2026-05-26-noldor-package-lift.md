# Noldor Package Lift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the entire Noldor framework — code, docs, skills, hooks, runtime state contract — out of Charuy's scattered locations into a single workspace package at `packages/noldor/`, consumed by Charuy via `workspace:*`, with a copy-on-init + drift-check template model where Charuy is the first consumer.

**Architecture:** Single workspace package `noldor` with a tsx-runtime CLI bin (`bin/noldor.mjs` loads `src/cli/index.ts` directly — no build step for invocation), subcommand router dispatching to `src/cli/commands/<group>.ts`, templates dir mirroring consumer-side framework files. `noldor init` scaffolds consumer paths; `noldor doctor` enforces zero drift. Charuy migrates by running `noldor init --adopt` against a templates dir bootstrapped from its current real-world state.

**Tech Stack:** pnpm workspace, TypeScript, tsx, vitest, oxlint/oxfmt, lefthook, gray-matter, zod, semver, marked. All deps lift from current root `package.json` (full partition in spec).

**Spec:** [`docs/design/specs/2026-05-26-noldor-package-lift-design.md`](../specs/2026-05-26-noldor-package-lift-design.md)

**Branch:** `feat/noldor-package-lift` (worktree per `worktree-discipline.md`).

---

## File Structure (target end-state)

```
packages/noldor/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── bin/
│   └── noldor.mjs                       # tsx wrapper loading src/cli/index.ts
├── src/
│   ├── cli/
│   │   ├── index.ts                     # subcommand router
│   │   ├── help.ts                      # --help table (static manifest)
│   │   └── commands/
│   │       ├── garden.ts, cr.ts, triage.ts, features.ts, milestones.ts,
│   │       ├── sync.ts, validate.ts, release.ts, hooks.ts, checks.ts,
│   │       ├── graphify.ts, dashboard.ts, docs.ts, invariants.ts,
│   │       ├── worktrees.ts, pr-flow.ts, changelog.ts, next-priority.ts,
│   │       ├── init.ts, doctor.ts
│   ├── garden/, cr/, triage/, features/, milestones/, sync/, validate/,
│   ├── release/, hooks/, checks/, graphify/, dashboard/, docs/, worktrees/,
│   ├── invariants/, noldor/, utils/, lib/, fixtures/
│   └── index.ts                         # library re-exports
└── templates/
    ├── docs/noldor/                     # 19 framework pages
    ├── .claude/
    │   ├── skills/                      # 9 framework skills
    │   ├── noldor.md                    # framework-imports fragment
    │   └── engineering-rules.md         # Noldor baseline rules
    └── lefthook/
        └── noldor.yml                   # framework hooks fragment

# Charuy consumer-side (root)
.claude/CLAUDE.md                        # short product head + @-imports
.claude/charuy-overlay.md                # Charuy engineering overlays
.claude/noldor.md                        # (template-managed, sha-locked)
.claude/engineering-rules.md             # (template-managed, sha-locked)
.claude/skills/<framework>/              # (template-managed, sha-locked)
docs/noldor/*.md                         # (template-managed, sha-locked)
lefthook.yml                             # consumer config, extends:
lefthook/noldor.yml                      # (template-managed, sha-locked)
.noldor/                                 # consumer runtime state
scripts/samples/                         # Charuy-only (build-samples)
```

Files removed from root: `scripts/{noldor,garden,triage,features,milestones,sync,validate,release,hooks,checks,graphify,dashboard,cr,docs,worktrees,invariants,lib,utils,fixtures}/`, `scripts/tsconfig.json`, `scripts/package.json`. Root `package.json` loses ~50 framework script entries.

---

## Task 1: Create worktree and pkg scaffold

**Files:**

- Create: `packages/noldor/package.json`
- Create: `packages/noldor/tsconfig.json`
- Create: `packages/noldor/vitest.config.ts`
- Create: `packages/noldor/bin/noldor.mjs`
- Create: `packages/noldor/src/cli/index.ts`
- Create: `packages/noldor/src/index.ts`
- Create: `packages/noldor/src/cli/__tests__/cli.test.ts`

- [x] **Step 1.1: Worktree — already created by `/gate` at entry**

The gate created the worktree at `.worktrees/noldor-package-lift` on branch `feat/noldor-package-lift` (base `main`) and ran `pnpm install` inside it. **Do not run `pnpm worktree:launch` / create a second worktree** — note the path is `.worktrees/noldor-package-lift` (slug), not the original plan's `.worktrees/feat-noldor-package-lift`.

- [x] **Step 1.2: Session is already in the worktree.**

All subsequent steps run from the worktree root `.worktrees/noldor-package-lift`. No `cd` needed — the gate switched the session in.

- [ ] **Step 1.3: Write failing CLI smoke test**

Create `packages/noldor/src/cli/__tests__/cli.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const BIN = resolve(__dirname, '../../../bin/noldor.mjs');

describe('noldor CLI', () => {
  it('prints version on --version', () => {
    const out = execFileSync('node', [BIN, '--version'], { encoding: 'utf8' });
    expect(out.trim()).toBe('noldor v0');
  });

  it('prints help on --help', () => {
    const out = execFileSync('node', [BIN, '--help'], { encoding: 'utf8' });
    expect(out).toContain('Usage: noldor');
  });
});
```

- [ ] **Step 1.4: Run test to verify it fails**

Run: `pnpm --filter noldor test` (will fail — pkg doesn't exist yet)
Expected: error "noldor: No projects matched the filters"

- [ ] **Step 1.5: Create `packages/noldor/package.json`**

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
  "files": ["dist", "src", "bin", "templates"],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist .turbo"
  },
  "dependencies": {
    "@inquirer/prompts": "^8.4.3",
    "dependency-cruiser": "^16.10.0",
    "gray-matter": "^4.0.3",
    "highlight.js": "^11.10.0",
    "marked": "^18.0.3",
    "marked-highlight": "^2.2.1",
    "minimatch": "^10.2.5",
    "semver": "^7.7.4",
    "tsx": "^4.21.0",
    "yaml": "^2.8.3",
    "zod": "^3.24.0",
    "zod-to-json-schema": "^3.25.2"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/semver": "^7.7.1",
    "typescript": "^5.8.0",
    "vitest": "^3.1.0"
  }
}
```

**Why `src` is in `files[]`:** the `bin/noldor.mjs` wrapper tsx-loads `../src/cli/index.ts` directly (no build step for invocation). If only `dist` shipped, a future npm-published consumer's binary couldn't resolve `src` and would break. Shipping `src` keeps the tsx-bin path working both in-workspace and when published. (Publish is a Non-Goal of this PR; at publish time the bin may instead be swapped to `dist/cli/index.js` via a `publishConfig` override — see spec — at which point `src` could drop from `files`. Until then, ship it to avoid the latent contradiction.)

- [ ] **Step 1.6: Create `packages/noldor/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2023", "DOM"],
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/__tests__/**", "src/**/*.test.ts", "src/fixtures/**"]
}
```

- [ ] **Step 1.7: Create `packages/noldor/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/__tests__/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 1.8: Create `packages/noldor/bin/noldor.mjs`**

```js
#!/usr/bin/env node
import { register } from 'tsx/esm/api';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

register();
const here = dirname(fileURLToPath(import.meta.url));
await import(resolve(here, '../src/cli/index.ts'));
```

Make it executable:

```bash
chmod +x packages/noldor/bin/noldor.mjs
```

- [ ] **Step 1.9: Create `packages/noldor/src/cli/index.ts` (stub)**

```ts
const arg = process.argv[2];

if (arg === '--version') {
  console.log('noldor v0');
  process.exit(0);
}

if (arg === '--help' || arg === undefined) {
  console.log('Usage: noldor <command> [args]\n\nNo commands wired yet.');
  process.exit(0);
}

console.error(`Unknown command: ${arg}`);
process.exit(1);
```

- [ ] **Step 1.10: Create `packages/noldor/src/index.ts` (stub)**

```ts
// Library re-exports populated as modules are migrated.
export {};
```

- [ ] **Step 1.11: Install workspace**

Run from repo root: `pnpm install`
Expected: pnpm picks up `packages/noldor`, no errors.

- [ ] **Step 1.12: Run smoke test to verify it passes**

Run: `pnpm --filter noldor test`
Expected: 2 tests pass.

- [ ] **Step 1.13: Run typecheck**

Run: `pnpm --filter noldor typecheck`
Expected: no errors.

- [ ] **Step 1.14: Capture pre-migration baselines (from main branch, in main worktree)**

In the main repo (not worktree):

```bash
pnpm garden:detect > /tmp/noldor-lift-garden-pre.txt 2>&1 || true
pnpm sdd:report > /tmp/noldor-lift-sdd-pre.txt 2>&1 || true
pnpm validate:noldor > /tmp/noldor-lift-validate-pre.txt 2>&1 || true
pnpm verify > /tmp/noldor-lift-verify-pre.txt 2>&1 || true
```

Used later in Task 22 to validate semantic parity.

- [ ] **Step 1.15: Commit**

In worktree:

```bash
git add packages/noldor
git commit -m "feat(noldor-pkg): scaffold noldor workspace package shell

Empty CLI stub responds to --version + --help. Templates dir, src
modules, and command router come in followup tasks.

Refs: docs/design/specs/2026-05-26-noldor-package-lift-design.md"
```

**Gate flow note (corrected):** This work entered via `/gate` `full-new` at the start of the session — the worktree, the `.noldor/session.json` session marker (`{ path: 'full-new', slug: 'noldor-package-lift' }`), and the FD scaffold at `docs/features/noldor-package-lift.md` (committed at the spec checkpoint) all **already exist**. The `prepare-commit-msg` hook therefore injects `Noldor-FD: noldor-package-lift` into every commit automatically from the session marker. **No `Noldor-Path-Override:` trailers are needed anywhere in this plan** — the per-task commit blocks below that still show `Noldor-FD: noldor-package-lift` are obsolete; drop that line (the hook supplies `Noldor-FD:`). Task 14's "land the FD" work is consequently a verification-only no-op (see Task 14).

---

## Task 2: Move leaf-dependency groups (utils, lib, fixtures)

These have zero cross-group deps. Safe to move first.

**Files:**

- Move: `scripts/utils/` → `packages/noldor/src/utils/`
- Move: `scripts/lib/` → `packages/noldor/src/lib/`
- Move: `scripts/fixtures/` → `packages/noldor/src/fixtures/`

- [ ] **Step 2.1: git mv utils**

```bash
git mv scripts/utils packages/noldor/src/utils
```

- [ ] **Step 2.2: git mv lib**

```bash
git mv scripts/lib packages/noldor/src/lib
```

- [ ] **Step 2.3: git mv fixtures**

```bash
git mv scripts/fixtures packages/noldor/src/fixtures
```

- [ ] **Step 2.4: Audit fixture path references**

Run: `git grep -n "scripts/fixtures" -- ':!CHANGELOG.md'`
For each hit (outside CHANGELOG / archived docs), rewrite path to use `packages/noldor/src/fixtures/...` if the consumer is moved code, or to use a relative path if the consumer also moves later.

For tests inside `packages/noldor/src/<group>/__tests__/`, paths to fixtures become relative: `../../fixtures/<file>` (computed by `path.resolve(__dirname, '../../fixtures', name)`).

- [ ] **Step 2.5: Run pkg tests**

Run: `pnpm --filter noldor test`
Expected: tests for moved utils + lib pass. If any test fails due to fixture path resolution, fix relative paths.

- [ ] **Step 2.6: Run pkg typecheck**

Run: `pnpm --filter noldor typecheck`
Expected: no errors. If `verbatimModuleSyntax: true` flags type imports, add `type` qualifiers.

- [ ] **Step 2.7: Commit**

```bash
git add packages/noldor scripts
git commit -m "feat(noldor-pkg): move utils, lib, fixtures into pkg

git-mv preserves history. Fixture path literals in moved tests
rewritten to relative paths.

Noldor-FD: noldor-package-lift"
```

---

## Task 3: Move features and noldor groups

`features/` has FD schema + validators. `noldor/` has session/trailers/changelog/cr-retry. `features` depends on `utils/slugify`, `lib/area-category`. `noldor` depends on `utils`.

**Files:**

- Move: `scripts/features/` → `packages/noldor/src/features/`
- Move: `scripts/noldor/` → `packages/noldor/src/noldor/`

- [ ] **Step 3.1: git mv features**

```bash
git mv scripts/features packages/noldor/src/features
```

- [ ] **Step 3.2: git mv noldor (avoid path collision)**

```bash
git mv scripts/noldor packages/noldor/src/noldor
```

- [ ] **Step 3.3: Fix cross-references**

Run: `git grep -nE "from ['\"]\\.\\./[a-z-]+/(features|noldor)" -- 'packages/noldor/src'`
Most internal imports stay relative (`../utils/slugify.js`), no change. External imports from outside the pkg are addressed in later tasks.

- [ ] **Step 3.4: Run pkg tests**

Run: `pnpm --filter noldor test`
Expected: all moved tests pass.

- [ ] **Step 3.5: Run pkg typecheck**

Run: `pnpm --filter noldor typecheck`
Expected: clean.

- [ ] **Step 3.6: Commit**

```bash
git add packages/noldor scripts
git commit -m "feat(noldor-pkg): move features + noldor groups into pkg

Noldor-FD: noldor-package-lift"
```

---

## Task 4: Move garden, triage, milestones, sync

Mid-tier deps (depend on features, utils, lib).

**Files:**

- Move: `scripts/garden/` → `packages/noldor/src/garden/`
- Move: `scripts/triage/` → `packages/noldor/src/triage/`
- Move: `scripts/milestones/` → `packages/noldor/src/milestones/`
- Move: `scripts/sync/` → `packages/noldor/src/sync/`

- [ ] **Step 4.1: git mv all four**

```bash
git mv scripts/garden packages/noldor/src/garden
git mv scripts/triage packages/noldor/src/triage
git mv scripts/milestones packages/noldor/src/milestones
git mv scripts/sync packages/noldor/src/sync
```

- [ ] **Step 4.2: Audit garden detector globs**

Garden detectors (`packages/noldor/src/garden/detectors/`) may glob `scripts/**` looking for source. Run: `git grep -n "scripts/" packages/noldor/src/garden/`. For each hit, decide:

- Glob targets framework code → rewrite to `packages/noldor/src/**`
- Glob targets consumer-owned code → keep as `scripts/**` (will continue to match `scripts/samples/`)

- [ ] **Step 4.3: Run pkg tests**

Run: `pnpm --filter noldor test`
Expected: pass. Garden detector tests may use fixture paths now under `packages/noldor/src/fixtures/`; verify.

- [ ] **Step 4.4: Run pkg typecheck**

Run: `pnpm --filter noldor typecheck`
Expected: clean.

- [ ] **Step 4.5: Commit**

```bash
git add packages/noldor scripts
git commit -m "feat(noldor-pkg): move garden, triage, milestones, sync into pkg

Detector globs audited; framework-targeted globs rewritten to
packages/noldor/src/**. Consumer-targeted globs preserved.

Noldor-FD: noldor-package-lift"
```

---

## Task 5: Move validate, cr, hooks, release, checks

**Files:**

- Move: `scripts/validate/` → `packages/noldor/src/validate/`
- Move: `scripts/cr/` → `packages/noldor/src/cr/`
- Move: `scripts/hooks/` → `packages/noldor/src/hooks/`
- Move: `scripts/release/` → `packages/noldor/src/release/`
- Move: `scripts/checks/` → `packages/noldor/src/checks/`

- [ ] **Step 5.1: git mv all five**

```bash
git mv scripts/validate packages/noldor/src/validate
git mv scripts/cr packages/noldor/src/cr
git mv scripts/hooks packages/noldor/src/hooks
git mv scripts/release packages/noldor/src/release
git mv scripts/checks packages/noldor/src/checks
```

- [ ] **Step 5.2: Audit `release/` cwd assumptions (M4 from spec review)**

Run: `git grep -nE "(process\\.cwd|__dirname|repo[-_ ]?root|'scripts/'|\"scripts/\")" packages/noldor/src/release/`
For each hit, confirm path is resolved relative to `process.cwd()` (consumer root), not pkg dir. Rewrite any pkg-relative path to consumer-relative.

- [ ] **Step 5.3: Audit hooks/ pnpm-script invocations**

Hooks at `packages/noldor/src/hooks/*.ts` may shell out to `pnpm <script>` (the current `hook:noldor:*` pattern). Run: `git grep -nE "'pnpm\\s+" packages/noldor/src/hooks/`. Replace internal `pnpm hook:noldor:*` calls with direct function imports or with `pnpm noldor hooks <name>` once CLI is wired (Task 8). For now leave as-is and add a TODO comment — Task 8 sweep fixes them.

- [ ] **Step 5.4: Run pkg tests**

Run: `pnpm --filter noldor test`
Expected: pass.

- [ ] **Step 5.5: Run pkg typecheck**

Run: `pnpm --filter noldor typecheck`
Expected: clean.

- [ ] **Step 5.6: Commit**

```bash
git add packages/noldor scripts
git commit -m "feat(noldor-pkg): move validate, cr, hooks, release, checks into pkg

Release scripts audited for cwd assumptions; all paths resolve
relative to process.cwd() (consumer root). Hook shell-out calls
TODO'd for Task 8 sweep.

Noldor-FD: noldor-package-lift"
```

---

## Task 6: Move dashboard, graphify, docs, worktrees, invariants

**Files:**

- Move: `scripts/dashboard/` → `packages/noldor/src/dashboard/`
- Move: `scripts/graphify/` → `packages/noldor/src/graphify/`
- Move: `scripts/docs/` → `packages/noldor/src/docs/`
- Move: `scripts/worktrees/` → `packages/noldor/src/worktrees/`
- Move: `scripts/invariants/` → `packages/noldor/src/invariants/`

- [ ] **Step 6.1: git mv all five**

```bash
git mv scripts/dashboard packages/noldor/src/dashboard
git mv scripts/graphify packages/noldor/src/graphify
git mv scripts/docs packages/noldor/src/docs
git mv scripts/worktrees packages/noldor/src/worktrees
git mv scripts/invariants packages/noldor/src/invariants
```

- [ ] **Step 6.2: Audit dashboard static-asset paths**

Dashboard serves static HTML/CSS. Run: `git grep -nE "'(static|public|assets)/'" packages/noldor/src/dashboard/`. If a static dir is bundled with dashboard source, ensure it moved (was inside `scripts/dashboard/`). Otherwise update path.

- [ ] **Step 6.3: Audit graphify output dir reference**

Graphify writes to `graphify-out/` at consumer root. Run: `git grep -nE "graphify-out" packages/noldor/src/graphify/`. Confirm path is computed via `process.cwd()`, not `__dirname`.

- [ ] **Step 6.4: Confirm `scripts/` final contents**

Run: `ls scripts/`
Expected: only `samples/`, `graphify-out/` (if it survived as gitignored output), `tsconfig.json`, `package.json`. The last two are deleted in Task 7.

- [ ] **Step 6.5: Run pkg tests**

Run: `pnpm --filter noldor test`
Expected: pass.

- [ ] **Step 6.6: Run pkg typecheck**

Run: `pnpm --filter noldor typecheck`
Expected: clean.

- [ ] **Step 6.7: Commit**

```bash
git add packages/noldor scripts
git commit -m "feat(noldor-pkg): move dashboard, graphify, docs, worktrees, invariants into pkg

Dashboard static-asset paths verified. Graphify output dir paths
verified to resolve under process.cwd().

Noldor-FD: noldor-package-lift"
```

---

## Task 7: Delete legacy `scripts/tsconfig.json` and `scripts/package.json`

**Files:**

- Delete: `scripts/tsconfig.json`
- Delete: `scripts/package.json`

- [ ] **Step 7.1: Verify scripts/samples/ builds without scripts/tsconfig.json**

scripts/samples/build-samples.ts runs via tsx (which uses root tsconfig.base). Confirm:

```bash
rm scripts/tsconfig.json scripts/package.json
pnpm build:samples
```

Expected: samples build succeeds.

- [ ] **Step 7.2: Verify root typecheck still passes for remaining scripts/**

```bash
pnpm typecheck
```

Expected: clean. Root tsconfig (currently picks up `apps/*` and `packages/*` via project refs or `turbo run typecheck`) handles workspace. `scripts/samples/` is run by tsx; not typechecked separately. If a separate typecheck step is desired, add a project-ref in Task 13.

- [ ] **Step 7.3: Commit**

```bash
git add scripts
git commit -m "chore(noldor-pkg): delete scripts/tsconfig.json + scripts/package.json

scripts/ now contains only samples/ (Charuy-specific) + gitignored
graphify-out/. tsconfig + package.json no longer needed.

Noldor-FD: noldor-package-lift"
```

---

## Task 8: Build CLI subcommand router

**Files:**

- Create: `packages/noldor/src/cli/index.ts` (replace stub)
- Create: `packages/noldor/src/cli/help.ts`
- Create: `packages/noldor/src/cli/manifest.ts`
- Create: `packages/noldor/src/cli/commands/{garden,cr,triage,features,milestones,sync,validate,release,hooks,checks,graphify,dashboard,docs,worktrees,invariants}.ts`
- Create: `packages/noldor/src/cli/commands/{pr-flow,changelog,next-priority}.ts` (hoisted)
- Create: `packages/noldor/src/cli/commands/{init,doctor}.ts` **as stubs** — MANIFEST registers them and `printHelp()` eager-imports every entry, so they must exist now or `--help` (and router test 8.1) throws on the missing dynamic import. Real implementations land in T10 (doctor) / T11 (init); the Task 8 stubs export a `CommandGroup` with a `''` subcommand whose `run` prints "not implemented yet" + exits 0. (`dashboard.ts` is listed once in the group line above — the earlier duplicate in the hoisted line is removed.)
- Create: `packages/noldor/src/cli/__tests__/router.test.ts`

- [ ] **Step 8.1: Write failing router test**

Replace `packages/noldor/src/cli/__tests__/cli.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const BIN = resolve(__dirname, '../../../bin/noldor.mjs');

function run(args: string[]) {
  return execFileSync('node', [BIN, ...args], { encoding: 'utf8' });
}

describe('noldor CLI router', () => {
  it('--version prints version', () => {
    expect(run(['--version']).trim()).toBe('noldor v0');
  });

  it('--help lists all command groups', () => {
    const out = run(['--help']);
    expect(out).toContain('garden');
    expect(out).toContain('cr');
    expect(out).toContain('triage');
    expect(out).toContain('init');
    expect(out).toContain('doctor');
  });

  it('unknown group exits non-zero', () => {
    expect(() => run(['no-such-group'])).toThrow();
  });

  it('garden --help shows garden subcommands', () => {
    const out = run(['garden', '--help']);
    expect(out).toContain('detect');
    expect(out).toContain('receipt');
    expect(out).toContain('sdd-report');
  });
});
```

- [ ] **Step 8.2: Run test to verify it fails**

Run: `pnpm --filter noldor test cli/__tests__/router.test.ts`
Expected: fails — no router yet.

- [ ] **Step 8.3: Create command manifest**

`packages/noldor/src/cli/manifest.ts`:

```ts
export interface SubCommand {
  name: string;
  description: string;
  run: (args: string[]) => Promise<void> | void;
}

export interface CommandGroup {
  name: string;
  description: string;
  subcommands: Record<string, SubCommand>;
}

export const MANIFEST: Record<string, () => Promise<CommandGroup>> = {
  garden: () => import('./commands/garden.js').then((m) => m.default),
  cr: () => import('./commands/cr.js').then((m) => m.default),
  triage: () => import('./commands/triage.js').then((m) => m.default),
  features: () => import('./commands/features.js').then((m) => m.default),
  milestones: () => import('./commands/milestones.js').then((m) => m.default),
  sync: () => import('./commands/sync.js').then((m) => m.default),
  validate: () => import('./commands/validate.js').then((m) => m.default),
  release: () => import('./commands/release.js').then((m) => m.default),
  hooks: () => import('./commands/hooks.js').then((m) => m.default),
  checks: () => import('./commands/checks.js').then((m) => m.default),
  graphify: () => import('./commands/graphify.js').then((m) => m.default),
  dashboard: () => import('./commands/dashboard.js').then((m) => m.default),
  docs: () => import('./commands/docs.js').then((m) => m.default),
  worktrees: () => import('./commands/worktrees.js').then((m) => m.default),
  invariants: () => import('./commands/invariants.js').then((m) => m.default),
  'pr-flow': () => import('./commands/pr-flow.js').then((m) => m.default),
  changelog: () => import('./commands/changelog.js').then((m) => m.default),
  'next-priority': () => import('./commands/next-priority.js').then((m) => m.default),
  init: () => import('./commands/init.js').then((m) => m.default),
  doctor: () => import('./commands/doctor.js').then((m) => m.default),
};
```

- [ ] **Step 8.4: Create help printer**

`packages/noldor/src/cli/help.ts`:

```ts
import { MANIFEST } from './manifest.js';

export async function printHelp(group?: string): Promise<void> {
  if (!group) {
    console.log('Usage: noldor <command> [args]\n\nCommands:');
    for (const name of Object.keys(MANIFEST)) {
      const mod = await MANIFEST[name]();
      console.log(`  ${name.padEnd(16)} ${mod.description}`);
    }
    return;
  }

  const loader = MANIFEST[group];
  if (!loader) {
    console.error(`Unknown command: ${group}`);
    process.exit(1);
  }
  const mod = await loader();
  console.log(`Usage: noldor ${group} <subcommand> [args]\n\n${mod.description}\n\nSubcommands:`);
  for (const [name, sub] of Object.entries(mod.subcommands)) {
    console.log(`  ${name.padEnd(20)} ${sub.description}`);
  }
}
```

- [ ] **Step 8.5: Replace router stub**

`packages/noldor/src/cli/index.ts`:

```ts
import { MANIFEST } from './manifest.js';
import { printHelp } from './help.js';

async function main(): Promise<void> {
  const [, , group, sub, ...rest] = process.argv;

  if (group === '--version') {
    console.log('noldor v0');
    return;
  }

  if (group === '--help' || group === undefined) {
    await printHelp();
    return;
  }

  const loader = MANIFEST[group];
  if (!loader) {
    console.error(`Unknown command: ${group}`);
    process.exit(1);
  }

  const mod = await loader();

  // Leaf command (e.g. init/doctor): declares a single '' subcommand and takes
  // flags directly after the group name (`noldor init --update`, `noldor doctor`).
  // The flag (or nothing) lands in the `sub` slot, so dispatch to '' with all
  // remaining argv — UNLESS the user explicitly asked for help. This must come
  // before the generic help/undefined check below, or `noldor init` (sub===undefined)
  // would print group help instead of running, and `noldor init --update` would
  // fall through to an undefined subcommand lookup.
  if (mod.subcommands['']) {
    if (sub === '--help') {
      await printHelp(group);
      return;
    }
    await mod.subcommands[''].run(sub === undefined ? rest : [sub, ...rest]);
    return;
  }

  if (sub === '--help' || sub === undefined) {
    await printHelp(group);
    return;
  }

  const subcommand = mod.subcommands[sub];
  if (!subcommand) {
    console.error(`Unknown subcommand: ${group} ${sub}`);
    process.exit(1);
  }

  await subcommand.run(rest);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 8.6: Create command group files (template)**

For each group in `MANIFEST`, create `packages/noldor/src/cli/commands/<group>.ts` following this pattern (example: garden):

```ts
import type { CommandGroup } from '../manifest.js';

const group: CommandGroup = {
  name: 'garden',
  description: 'Garden detect + SDD report + receipt helpers',
  subcommands: {
    detect: {
      name: 'detect',
      description: 'Detect framework drift sentinels',
      run: async (args) => {
        const { main } = await import('../../garden/garden-detect.js');
        await main(args);
      },
    },
    receipt: {
      name: 'receipt',
      description: 'Write a garden receipt',
      run: async (args) => {
        const { main } = await import('../../garden/garden-receipt.js');
        await main(args);
      },
    },
    'sdd-report': {
      name: 'sdd-report',
      description: 'Produce the SDD report',
      run: async (args) => {
        const { main } = await import('../../garden/sdd-report.js');
        await main(args);
      },
    },
  },
};

export default group;
```

Repeat for every group. The subcommand list per group derives from the current root `package.json` pnpm scripts (full mapping in the operator cheatsheet in the spec).

**`init` + `doctor` stubs (required now):** these two have no migrated `src/` module yet (real code lands T10/T11), but MANIFEST registers them and `printHelp()` eager-imports every entry, so create minimal stubs here so `--help` and router test 8.1 don't throw on a missing import. Each stub exports a `CommandGroup` with a single `''` subcommand:

```ts
import type { CommandGroup } from '../manifest.js';
const group: CommandGroup = {
  name: 'doctor', // 'init' for init.ts
  description: 'Diff consumer files against pkg templates (drift check)', // init: 'Scaffold/sync framework files into the consumer repo'
  subcommands: {
    '': {
      name: '',
      description: 'run',
      run: async () => {
        console.log('not implemented yet');
      },
    },
  },
};
export default group;
```

T10 replaces `doctor.ts`, T11 replaces `init.ts` with the real implementations.

**Pattern requirement**: each `src/<group>/<file>.ts` must export a `main(args: string[]): Promise<void>` function. If a script currently runs side-effects at module load, wrap them: `export async function main(args: string[]): Promise<void> { ... }` and remove the bare top-level call (add an `if (import.meta.url === ...) main(process.argv.slice(2))` guard for legacy direct invocation if needed during transition).

- [ ] **Step 8.7: Refactor each `src/<group>/<file>.ts` to export `main`**

Run: `git grep -nE "^(if|await|const|let|console)" packages/noldor/src/*/*.ts | grep -v "^packages/noldor/src/[a-z-]*/[a-z-]*\\.ts:[0-9]*:export" | head -50`
For each script entrypoint that has top-level code, wrap in `main()` function with explicit `args: string[]` parameter. The current pattern uses `process.argv.slice(2)` directly — replace with the passed `args`.

- [ ] **Step 8.8: Run router test to verify it passes**

Run: `pnpm --filter noldor test cli/__tests__/router.test.ts`
Expected: all 4 router tests pass.

- [ ] **Step 8.9: Run full pkg test suite**

Run: `pnpm --filter noldor test`
Expected: all tests pass.

- [ ] **Step 8.10: Run pkg typecheck**

Run: `pnpm --filter noldor typecheck`
Expected: clean.

- [ ] **Step 8.11: Run a real command end-to-end**

Run: `node packages/noldor/bin/noldor.mjs garden detect`
Expected: garden detect runs against consumer files (worktree root), produces output equivalent to `pnpm garden:detect` did pre-migration.

- [ ] **Step 8.12: Sweep hooks/ TODO from Task 5**

Now CLI exists. Update `packages/noldor/src/hooks/*.ts` shell-outs from `pnpm hook:noldor:<x>` to use direct function imports (preferred — avoids subprocess overhead) or to `pnpm noldor hooks <x>` (preserves shell-out semantics if test isolation matters).

- [ ] **Step 8.13: Commit**

```bash
git add packages/noldor
git commit -m "feat(noldor-pkg): wire CLI router with command manifest

Single 'noldor <group> <subcommand>' surface. Each command group
declared in src/cli/commands/<group>.ts and lazy-loaded by the
router. Help printer enumerates groups + subcommands from manifest.

Every src/<group>/<file>.ts entrypoint refactored to export a
named main(args: string[]) function. Top-level side-effects removed.

Hooks/ internal shell-outs updated to import directly from sibling
modules instead of spawning pnpm subprocesses.

Noldor-FD: noldor-package-lift"
```

---

## Task 9: Extract templates dir

**Files:**

- Create: `packages/noldor/templates/docs/noldor/*.md` (copy of `docs/noldor/*.md`)
- Create: `packages/noldor/templates/.claude/skills/<framework>/SKILL.md` (copy of 9 framework skills)
- Create: `packages/noldor/templates/.claude/noldor.md` (extracted from current `.claude/CLAUDE.md`)
- Create: `packages/noldor/templates/.claude/engineering-rules.md` (from current `docs/noldor/engineering-principles.md`)
- Create: `packages/noldor/templates/lefthook/noldor.yml` (extracted from current `lefthook.yml`)

- [ ] **Step 9.1: Copy docs/noldor/ as template**

```bash
mkdir -p packages/noldor/templates/docs
cp -r docs/noldor packages/noldor/templates/docs/noldor
# engineering-principles.md is being dropped (its content becomes the baseline
# templates/.claude/engineering-rules.md, derived in Step 9.4). Exclude it from
# the docs/noldor template mirror so it is not re-introduced.
rm packages/noldor/templates/docs/noldor/engineering-principles.md
```

- [ ] **Step 9.2: Copy framework skills**

```bash
mkdir -p packages/noldor/templates/.claude/skills
for skill in gate garden triage promote draft-feature-md new-feature milestone release-sweep refactor; do
  cp -r ".claude/skills/$skill" "packages/noldor/templates/.claude/skills/$skill"
done
```

- [ ] **Step 9.3: Author `templates/.claude/noldor.md`**

Read current `.claude/CLAUDE.md`. Extract framework-only blocks (Framework section, Engineering Rules imports, Gate section). Write to `packages/noldor/templates/.claude/noldor.md`:

```markdown
# Noldor Framework

@docs/noldor/README.md
@.claude/engineering-rules.md

`docs/noldor/README.md` is the framework's route table — every workflow has a dedicated page. Before any change open the matching page from the route table.

## Gate

`/gate` mandatory before any code edit. Do not bypass — use `Noldor-Path-Override: <reason>` on the commit only when a hook genuinely cannot run.
```

- [ ] **Step 9.4: Author `templates/.claude/engineering-rules.md`**

```bash
cp docs/noldor/engineering-principles.md packages/noldor/templates/.claude/engineering-rules.md
```

This becomes the framework baseline rules file at the consumer side.

- [ ] **Step 9.5: Extract framework hooks → `templates/lefthook/noldor.yml`**

Read current `lefthook.yml`. Identify framework hooks (any line invoking `pnpm hook:noldor:*` or `pnpm validate:noldor*`). Write to `packages/noldor/templates/lefthook/noldor.yml`. Hooks now invoke `pnpm noldor hooks <name>` / `pnpm noldor validate <name>`. Example shape:

```yaml
pre-commit:
  parallel: true
  commands:
    noldor-pre-commit:
      run: pnpm noldor hooks pre-commit
    noldor-inject-trailers:
      run: pnpm noldor hooks inject-trailers
    noldor-validate-trailer:
      run: pnpm noldor hooks validate-trailer
    noldor-enforce-review-receipt:
      run: pnpm noldor hooks enforce-review-receipt
    validate-noldor-config:
      run: pnpm noldor validate noldor-config

pre-push:
  commands:
    noldor-pre-push:
      run: pnpm noldor hooks pre-push
```

(Final hook list reconciled by reading current `lefthook.yml` — the example shows shape only.)

- [ ] **Step 9.6: Commit**

```bash
git add packages/noldor/templates
git commit -m "feat(noldor-pkg): extract templates dir

Verbatim copies: docs/noldor/, .claude/skills/{gate,garden,triage,
promote,draft-feature-md,new-feature,milestone,release-sweep,refactor}/.

Derived: templates/.claude/noldor.md from current .claude/CLAUDE.md
framework block; templates/.claude/engineering-rules.md from current
docs/noldor/engineering-principles.md; templates/lefthook/noldor.yml
from framework hooks in current lefthook.yml.

Noldor-FD: noldor-package-lift"
```

---

## Task 10: Implement `noldor doctor`

**Files:**

- Create: `packages/noldor/src/cli/commands/doctor.ts` (replace stub)
- Create: `packages/noldor/src/templates/diff.ts`
- Create: `packages/noldor/src/templates/manifest.ts`
- Create: `packages/noldor/src/templates/__tests__/diff.test.ts`

- [ ] **Step 10.1: Write failing doctor diff test**

`packages/noldor/src/templates/__tests__/diff.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeDrift } from '../diff.js';

describe('computeDrift', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'noldor-doctor-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reports unchanged when files match', () => {
    const tplDir = join(dir, 'tpl');
    const consumerDir = join(dir, 'consumer');
    mkdirSync(tplDir);
    mkdirSync(consumerDir);
    writeFileSync(join(tplDir, 'a.md'), 'hello');
    writeFileSync(join(consumerDir, 'a.md'), 'hello');
    const result = computeDrift(tplDir, consumerDir, ['a.md']);
    expect(result).toEqual([{ path: 'a.md', status: 'unchanged' }]);
  });

  it('reports drifted when content differs', () => {
    const tplDir = join(dir, 'tpl');
    const consumerDir = join(dir, 'consumer');
    mkdirSync(tplDir);
    mkdirSync(consumerDir);
    writeFileSync(join(tplDir, 'a.md'), 'hello');
    writeFileSync(join(consumerDir, 'a.md'), 'modified');
    const result = computeDrift(tplDir, consumerDir, ['a.md']);
    expect(result).toEqual([{ path: 'a.md', status: 'drifted' }]);
  });

  it('reports missing when consumer file absent', () => {
    const tplDir = join(dir, 'tpl');
    const consumerDir = join(dir, 'consumer');
    mkdirSync(tplDir);
    mkdirSync(consumerDir);
    writeFileSync(join(tplDir, 'a.md'), 'hello');
    const result = computeDrift(tplDir, consumerDir, ['a.md']);
    expect(result).toEqual([{ path: 'a.md', status: 'missing' }]);
  });
});
```

- [ ] **Step 10.2: Run test to verify it fails**

Run: `pnpm --filter noldor test templates/__tests__/diff.test.ts`
Expected: fail — `computeDrift` not defined.

- [ ] **Step 10.3: Create template manifest**

`packages/noldor/src/templates/manifest.ts`:

```ts
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const TEMPLATES_ROOT = join(here, '..', '..', 'templates');

export function templateFiles(): string[] {
  const files: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else files.push(relative(TEMPLATES_ROOT, full));
    }
  }
  walk(TEMPLATES_ROOT);
  return files;
}
```

- [ ] **Step 10.4: Implement diff**

`packages/noldor/src/templates/diff.ts`:

```ts
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export type DriftStatus = 'unchanged' | 'drifted' | 'missing';

export interface DriftEntry {
  path: string;
  status: DriftStatus;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function computeDrift(
  templateRoot: string,
  consumerRoot: string,
  relativePaths: string[],
): DriftEntry[] {
  return relativePaths.map((rel) => {
    const tplPath = join(templateRoot, rel);
    const consumerPath = join(consumerRoot, rel);
    if (!existsSync(consumerPath)) {
      return { path: rel, status: 'missing' as const };
    }
    const tplHash = sha256(readFileSync(tplPath));
    const consumerHash = sha256(readFileSync(consumerPath));
    return {
      path: rel,
      status: tplHash === consumerHash ? 'unchanged' : 'drifted',
    };
  });
}
```

- [ ] **Step 10.5: Run test to verify it passes**

Run: `pnpm --filter noldor test templates/__tests__/diff.test.ts`
Expected: 3 tests pass.

- [ ] **Step 10.6: Wire `noldor doctor` command**

`packages/noldor/src/cli/commands/doctor.ts`:

```ts
import type { CommandGroup } from '../manifest.js';
import { TEMPLATES_ROOT, templateFiles } from '../../templates/manifest.js';
import { computeDrift } from '../../templates/diff.js';

const group: CommandGroup = {
  name: 'doctor',
  description: 'Diff consumer files against pkg templates; non-zero exit on drift',
  subcommands: {
    '': {
      name: '',
      description: 'Run drift check',
      run: async () => {
        const files = templateFiles();
        const drift = computeDrift(TEMPLATES_ROOT, process.cwd(), files);
        let bad = 0;
        for (const entry of drift) {
          if (entry.status === 'unchanged') continue;
          bad++;
          console.log(`${entry.status.padEnd(10)} ${entry.path}`);
        }
        if (bad === 0) {
          console.log(`OK — ${files.length} template files in sync`);
          return;
        }
        console.error(
          `\n${bad} drift entries. Run 'noldor init --update' to sync or 'noldor init --adopt' if pkg should adopt consumer state.`,
        );
        process.exit(1);
      },
    },
  },
};

export default group;
```

The `doctor` and `init` commands have no subcommands — they use an empty-string subcommand key and take flags directly after the group name. The router already handles this: the leaf-dispatch branch authored in Step 8.5 (`if (mod.subcommands[''])`, placed _before_ the generic help/undefined check) dispatches `noldor doctor`, `noldor init`, `noldor init --update`, and `noldor init --adopt` correctly — passing `rest` when no flag is present and `[sub, ...rest]` when the first token is a flag. **No additional router patch is needed here.** (The earlier draft of this step added a fragment that only fired on `sub === undefined || '--help'`, which broke `init --update`/`--adopt` — the flag lands in the `sub` slot. That logic is superseded by the Step 8.5 leaf branch.)

Verify with: `node packages/noldor/bin/noldor.mjs init --update` dispatches to the init command (not "Unknown subcommand"), and `node packages/noldor/bin/noldor.mjs doctor` runs the drift check.

- [ ] **Step 10.7: Run doctor against in-progress worktree**

Run: `cd <worktree-root> && node packages/noldor/bin/noldor.mjs doctor`
Expected: reports `missing` for every template file (consumer copies don't yet exist — `noldor init --adopt` lands them in Task 12).

- [ ] **Step 10.8: Commit**

```bash
git add packages/noldor
git commit -m "feat(noldor-pkg): implement noldor doctor (drift detection)

sha256-based file diff between templates/ dir and consumer files
resolved via process.cwd(). Exit 1 on any drift; exit 0 with file
count on clean.

Router patched to dispatch leaf commands (init, doctor) that have
no subcommands.

Noldor-FD: noldor-package-lift"
```

---

## Task 11: Implement `noldor init`, `init --update`, `init --adopt`

**Files:**

- Create: `packages/noldor/src/cli/commands/init.ts`
- Create: `packages/noldor/src/templates/copy.ts`
- Create: `packages/noldor/src/templates/__tests__/copy.test.ts`

- [ ] **Step 11.1: Write failing copy test**

`packages/noldor/src/templates/__tests__/copy.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { copyTemplate, adoptTemplate } from '../copy.js';

describe('copyTemplate', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'noldor-init-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('copies new files (added status)', () => {
    const tplDir = join(dir, 'tpl');
    const consumerDir = join(dir, 'consumer');
    mkdirSync(tplDir, { recursive: true });
    mkdirSync(consumerDir);
    writeFileSync(join(tplDir, 'a.md'), 'hello');
    const result = copyTemplate(tplDir, consumerDir, ['a.md'], { update: false });
    expect(result).toEqual([{ path: 'a.md', status: 'added' }]);
    expect(readFileSync(join(consumerDir, 'a.md'), 'utf8')).toBe('hello');
  });

  it('refuses overwrite without update flag', () => {
    const tplDir = join(dir, 'tpl');
    const consumerDir = join(dir, 'consumer');
    mkdirSync(tplDir);
    mkdirSync(consumerDir);
    writeFileSync(join(tplDir, 'a.md'), 'hello');
    writeFileSync(join(consumerDir, 'a.md'), 'old');
    expect(() => copyTemplate(tplDir, consumerDir, ['a.md'], { update: false })).toThrow(
      /already exists/,
    );
  });

  it('updates existing files with update flag (updated status)', () => {
    const tplDir = join(dir, 'tpl');
    const consumerDir = join(dir, 'consumer');
    mkdirSync(tplDir);
    mkdirSync(consumerDir);
    writeFileSync(join(tplDir, 'a.md'), 'hello');
    writeFileSync(join(consumerDir, 'a.md'), 'old');
    const result = copyTemplate(tplDir, consumerDir, ['a.md'], { update: true });
    expect(result).toEqual([{ path: 'a.md', status: 'updated' }]);
    expect(readFileSync(join(consumerDir, 'a.md'), 'utf8')).toBe('hello');
  });

  it('reports unchanged when content already matches', () => {
    const tplDir = join(dir, 'tpl');
    const consumerDir = join(dir, 'consumer');
    mkdirSync(tplDir);
    mkdirSync(consumerDir);
    writeFileSync(join(tplDir, 'a.md'), 'hello');
    writeFileSync(join(consumerDir, 'a.md'), 'hello');
    const result = copyTemplate(tplDir, consumerDir, ['a.md'], { update: true });
    expect(result).toEqual([{ path: 'a.md', status: 'unchanged' }]);
  });
});

describe('adoptTemplate', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'noldor-adopt-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('copies consumer files INTO templates dir', () => {
    const tplDir = join(dir, 'tpl');
    const consumerDir = join(dir, 'consumer');
    mkdirSync(tplDir);
    mkdirSync(consumerDir);
    writeFileSync(join(consumerDir, 'a.md'), 'consumer-canonical');
    adoptTemplate(tplDir, consumerDir, ['a.md']);
    expect(readFileSync(join(tplDir, 'a.md'), 'utf8')).toBe('consumer-canonical');
  });
});
```

- [ ] **Step 11.2: Run test to verify it fails**

Run: `pnpm --filter noldor test templates/__tests__/copy.test.ts`
Expected: fail.

- [ ] **Step 11.3: Implement copy + adopt**

`packages/noldor/src/templates/copy.ts`:

```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

export type CopyStatus = 'added' | 'updated' | 'unchanged';

export interface CopyEntry {
  path: string;
  status: CopyStatus;
}

export interface CopyOptions {
  update: boolean;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function copyTemplate(
  templateRoot: string,
  consumerRoot: string,
  relativePaths: string[],
  opts: CopyOptions,
): CopyEntry[] {
  return relativePaths.map((rel) => {
    const src = join(templateRoot, rel);
    const dest = join(consumerRoot, rel);
    const tplContent = readFileSync(src);

    if (!existsSync(dest)) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, tplContent);
      return { path: rel, status: 'added' };
    }

    const destContent = readFileSync(dest);
    if (sha256(tplContent) === sha256(destContent)) {
      return { path: rel, status: 'unchanged' };
    }

    if (!opts.update) {
      throw new Error(`Refusing to overwrite: ${rel} already exists (use --update to replace)`);
    }
    writeFileSync(dest, tplContent);
    return { path: rel, status: 'updated' };
  });
}

export function adoptTemplate(
  templateRoot: string,
  consumerRoot: string,
  relativePaths: string[],
): void {
  for (const rel of relativePaths) {
    const src = join(consumerRoot, rel);
    const dest = join(templateRoot, rel);
    if (!existsSync(src)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(src));
  }
}
```

- [ ] **Step 11.4: Run test to verify it passes**

Run: `pnpm --filter noldor test templates/__tests__/copy.test.ts`
Expected: 5 tests pass.

- [ ] **Step 11.5: Wire `noldor init` command**

`packages/noldor/src/cli/commands/init.ts`:

```ts
import type { CommandGroup } from '../manifest.js';
import { TEMPLATES_ROOT, templateFiles } from '../../templates/manifest.js';
import { copyTemplate, adoptTemplate } from '../../templates/copy.js';

function parseFlags(args: string[]): { update: boolean; adopt: boolean } {
  return {
    update: args.includes('--update'),
    adopt: args.includes('--adopt'),
  };
}

const group: CommandGroup = {
  name: 'init',
  description:
    'Scaffold framework files into consumer repo (use --update to sync, --adopt to bootstrap from consumer state)',
  subcommands: {
    '': {
      name: '',
      description: 'Run init',
      run: async (args) => {
        const flags = parseFlags(args);
        const consumer = process.cwd();
        const files = templateFiles();

        if (flags.adopt) {
          adoptTemplate(TEMPLATES_ROOT, consumer, files);
          console.log(`adopt: copied ${files.length} consumer files into pkg templates`);
          return;
        }

        const results = copyTemplate(TEMPLATES_ROOT, consumer, files, { update: flags.update });
        const counts = { added: 0, updated: 0, unchanged: 0 };
        for (const r of results) {
          counts[r.status]++;
          if (r.status !== 'unchanged') console.log(`${r.status.padEnd(10)} ${r.path}`);
        }
        console.log(
          `\n${counts.added} added, ${counts.updated} updated, ${counts.unchanged} unchanged`,
        );
      },
    },
  },
};

export default group;
```

- [ ] **Step 11.6: Smoke test against worktree (intermediate — not authoritative)**

Run from worktree root: `node packages/noldor/bin/noldor.mjs init --update`
Expected: reports `unchanged` / `updated` for template-managed files. This exercises the command against the **intermediate** state — the consumer's CLAUDE.md split + baseline rewrite are not done until Tasks 12-13. **Do not treat this as the final sync.** Per revised spec §7, the authoritative template bootstrap is `noldor init --adopt` run _after_ Tasks 12-13 finalize the consumer files (added as Step 13.8); that re-snapshots templates from the final consumer state so `doctor` is green on real end-state, not on the Task-9 extraction. A non-zero `doctor` here is acceptable and expected.

Run: `node packages/noldor/bin/noldor.mjs doctor`
Expected: may report drift at this intermediate point — fine. The gating `doctor` is Step 13.8 / Task 18.

- [ ] **Step 11.7: Commit**

```bash
git add packages/noldor
git commit -m "feat(noldor-pkg): implement noldor init / init --update / init --adopt

copy.ts: sha256-aware file copy with added/updated/unchanged states;
refuses overwrite without --update. adopt.ts: reverse direction —
consumer → templates, used for first-consumer bootstrap.

init command wires both modes. Doctor passes against worktree.

Noldor-FD: noldor-package-lift"
```

---

## Task 12: Charuy consumer wire-up — CLAUDE.md split

**Files:**

- Modify: `.claude/CLAUDE.md` (full rewrite)
- Create: `.claude/charuy-overlay.md`
- Create: `.claude/noldor.md` (from template — written by `noldor init`)
- Create: `.claude/engineering-rules.md` (template-managed; replaces current content)

- [ ] **Step 12.1: Read current `.claude/CLAUDE.md` and identify split boundaries**

Sections to extract to consumer-owned `.claude/CLAUDE.md`:

- `# Charuy — Project Rules` (header)
- `## Project` (Charuy product description)
- `## Where project rules live` (Charuy-specific memory routing rule)

Sections to extract to template-managed `.claude/noldor.md`:

- `## Framework — ALWAYS READ FIRST`
- `## Engineering Rules`
- `## Gate`

Read current `.claude/engineering-rules.md`. Charuy-specific overlays go to `.claude/charuy-overlay.md`. (The "Noldor baseline" reference content moves to template-managed `.claude/engineering-rules.md` derived from `docs/noldor/engineering-principles.md` — already done in Task 9.)

- [ ] **Step 12.2: Author new `.claude/CLAUDE.md` (consumer-owned, short)**

Overwrite `.claude/CLAUDE.md`:

```markdown
# Charuy — Project Rules

@.claude/noldor.md
@.claude/charuy-overlay.md

## Project

See `README.md` for project description, architecture, packages, tech stack, pipeline overview.

## Where project rules live

When user asks to "remember" project-framework scoped, save to matching `docs/noldor/*.md` framework page. Charuy-specific overlays go to `.claude/charuy-overlay.md`. CLAUDE.md stays short.
```

- [ ] **Step 12.3: Author `.claude/charuy-overlay.md`**

Extract Charuy-specific rules from current `.claude/engineering-rules.md` (3D/manifold/Three.js/scene-graph rules, etc.). Write to `.claude/charuy-overlay.md`. The exact content depends on what's currently in `.claude/engineering-rules.md` — copy Charuy-specific sections verbatim, drop the generic Noldor baseline (which lives in `.claude/engineering-rules.md` template now).

Run: `git show HEAD~10:.claude/engineering-rules.md > /tmp/old-eng-rules.md` (or read current file before Task 9 overwrote it via templates).

Manually split: anything specific to 3D / scene graph / R3F / Manifold / Charuy package names → `.claude/charuy-overlay.md`. Everything generic → already covered by template-managed `.claude/engineering-rules.md`.

- [ ] **Step 12.4: Drop the consumer `docs/noldor/engineering-principles.md` page**

Its content now lives canonically in the template baseline (`templates/.claude/engineering-rules.md`, Step 9.4) and at the consumer baseline `.claude/engineering-rules.md` (written by the Task 11 init run). The standalone page is therefore removed consumer-side:

```bash
git rm docs/noldor/engineering-principles.md
```

The matching template copy was already excluded in Step 9.1. **Orphan caveat** (per spec): `noldor doctor` only diffs files still present in the template manifest, so a dropped page leaves no drift coverage for a leftover consumer copy — the deletion must be explicit here, never deferred to `init --update`. The `@docs/noldor/engineering-principles.md` import is dropped naturally by the Step 12.2 CLAUDE.md rewrite (new `.claude/noldor.md` imports `@.claude/engineering-rules.md` only); the `docs/noldor/README.md` route-table link to the page is repointed/removed in the Task 16 doc sweep.

- [ ] **Step 12.5: Verify `.claude/noldor.md` and `.claude/engineering-rules.md` came from `noldor init` in Task 11**

Run: `ls -la .claude/noldor.md .claude/engineering-rules.md`
Expected: both files exist (written by Task 11 init run). Content matches `packages/noldor/templates/.claude/*.md`.

- [ ] **Step 12.6: Run doctor**

Run: `node packages/noldor/bin/noldor.mjs doctor`
Expected: clean. If `.claude/CLAUDE.md` or `.claude/charuy-overlay.md` show drift, they're consumer-owned — must NOT be in the template manifest. Confirm `packages/noldor/src/templates/manifest.ts` walks only `templates/` dir contents.

- [ ] **Step 12.7: Commit**

```bash
git add .claude
git commit -m "feat(noldor-consumer): split CLAUDE.md into product head + framework imports

.claude/CLAUDE.md now contains only Charuy product header + @-imports
to template-managed .claude/noldor.md and consumer-owned
.claude/charuy-overlay.md. Framework rules moved to template-managed
files via Task 9.

Noldor-FD: noldor-package-lift"
```

---

## Task 13: Charuy consumer wire-up — lefthook + root package.json

**Files:**

- Modify: `lefthook.yml` (full rewrite)
- Modify: `package.json` (strip ~50 framework scripts)
- Create: `lefthook/noldor.yml` (already created by `noldor init` from template in Task 11)

- [ ] **Step 13.1: Verify `lefthook/noldor.yml` exists from Task 11 init run**

Run: `cat lefthook/noldor.yml | head`
Expected: framework hook block from template.

- [ ] **Step 13.2: Rewrite root `lefthook.yml`**

Read current `lefthook.yml`. Identify Charuy-only hooks (samples-related, playwright-related, web-related). Author new root `lefthook.yml`:

```yaml
# Charuy lefthook config — extends framework hooks from packages/noldor/templates/.
extends:
  - ./lefthook/noldor.yml

pre-commit:
  parallel: true
  commands:
    samples-build:
      glob: 'scripts/samples/**'
      run: pnpm build:samples
    # (other Charuy-specific hooks copied verbatim from current lefthook.yml)
```

If `extends:` doesn't merge `pre-commit.commands` the way required, fall back to inlining `lefthook/noldor.yml` content into the root file via a manual concat at this step (acceptable per spec Risks section). Validate by running:

```bash
pnpm postinstall          # re-installs lefthook
pnpm exec lefthook run pre-commit  # actually fires the hook chain (git commit --dry-run does NOT run hooks)
```

- [ ] **Step 13.3: Strip framework scripts from root `package.json`**

Edit root `package.json`. Keep only these `scripts` entries:

```json
{
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
  }
}
```

Delete all other entries (~50 framework scripts including `test:scripts`, `typecheck:scripts`, `garden:detect`, `cr:codex`, `validate:noldor*`, `noldor:*`, `sync:*`, `triage:*`, `sdd:report`, `gaps:*`, `check:*`, `docs:*`, `release`, `hook:noldor:*`, `migrate:*`, `next-priority`, `pr-flow`, `lint:plan-snippets`).

Update `devDependencies`: remove framework-only deps that moved to `noldor` pkg (`@inquirer/prompts`, `gray-matter`, `marked*`, `highlight.js`, `minimatch`, `dependency-cruiser`, `zod*`, `semver`, `@types/semver`, `yaml`). Keep tooling-wide deps (`oxfmt`, `oxlint`, `lefthook`, `turbo`, `typescript`, `vitest`, `@types/node`, `tsx`, `playwright`, `three`, `@types/three`).

Add `"noldor": "workspace:*"` to `devDependencies`.

- [ ] **Step 13.4: pnpm install + verify lockfile**

Run: `pnpm install`
Expected: lockfile updates. Pkg `noldor` symlinked into `node_modules`.

- [ ] **Step 13.5: Smoke test consumer-side commands**

Run:

```bash
pnpm noldor --version
pnpm noldor garden detect
pnpm noldor doctor
```

Expected: all run, last reports zero drift.

- [ ] **Step 13.6: Run pnpm verify**

Run: `pnpm verify`
Expected: lint + fmt + typecheck + samples + tests + doctor all pass.

- [ ] **Step 13.7: Commit**

```bash
git add lefthook.yml lefthook/ package.json pnpm-lock.yaml
git commit -m "feat(noldor-consumer): rewrite lefthook.yml + strip framework scripts

lefthook.yml extends ./lefthook/noldor.yml (template-managed) and
retains only Charuy-specific hooks (samples + web/playwright).

Root package.json scripts dropped ~50 framework entries; framework
tests now flow through 'turbo run test' picking up the noldor pkg.
'noldor' added as workspace devDep. Framework deps removed from root
devDeps (now declared by the pkg).

verify now ends with 'pnpm noldor doctor'.

Noldor-FD: noldor-package-lift"
```

- [ ] **Step 13.8: Authoritative template bootstrap — `noldor init --adopt` (revised spec §7.6)**

Consumer files are now in their final post-migration shape (CLAUDE.md split, `.claude/engineering-rules.md` = baseline, `.claude/charuy-overlay.md` authored, `engineering-principles.md` dropped, `lefthook.yml` extends framework block). **Now** re-snapshot the templates from this final state so template == consumer exactly:

```bash
node packages/noldor/bin/noldor.mjs init --adopt
node packages/noldor/bin/noldor.mjs doctor
```

Expected: `init --adopt` reports the template-managed files it captured into `packages/noldor/templates/`; `doctor` then reports zero drift. This supersedes the intermediate Step 11.6 sync — adopt-after-finalization is the model the revised spec mandates (the Task-9 cp-extraction is just an initial draft so the package builds; this step makes it authoritative). If `doctor` is non-zero here, a consumer file was not in final shape before adopt — re-check the Task 12-13 ordering against spec §7.

**Ordering invariant (carry into Task 12):** `.claude/charuy-overlay.md` must be authored from the Charuy-overlay content that lived in `.claude/engineering-rules.md` _before_ the Task 11 init run overwrote that path with the baseline. Task 12.3 already provides the `git show <pre-migration>:.claude/engineering-rules.md` recovery for this; the cleaner alternative is to capture the overlay into `charuy-overlay.md` at Task 9 time (before any init runs) and skip the archaeology.

```bash
git add packages/noldor/templates .claude docs/noldor lefthook
git commit -m "feat(noldor-consumer): bootstrap templates from final consumer state (init --adopt)

Re-snapshots template-managed files from the finalized consumer wire-up
so doctor reports zero drift on real end-state, not the Task-9 draft.

Noldor-FD: noldor-package-lift"
```

---

## Task 14: FD — verification only (already landed at gate entry)

**Superseded.** The original plan landed the FD mid-stream here with an override-trailer scheme until this point. That is obsolete: `/gate` `full-new` at session start already scaffolded `docs/features/noldor-package-lift.md` (correct frontmatter per `feature-schema.ts`: `area`/`category`/`links.spec`+`links.plan`/`name`/`packages`/`phase: in-progress`/`noldor-tier: full`), filled User Story + Usage via `/draft-feature-md --from-spec`, and committed it at the spec checkpoint. The session marker drives `Noldor-FD:` injection on every commit. **Do not re-scaffold the FD** — the hand-scaffold frontmatter the original plan showed (`slug`/`title`/`parent`/`kind`/`status`/`introduced`) is invalid for this repo's schema and would fail `validate:features` (notably `phase: in-progress + introduced` is rejected, and `introduced` is release-owned, never hand-set).

- [ ] **Step 14.1: Verify the FD validates under the post-migration code path**

```bash
node packages/noldor/bin/noldor.mjs validate features
```

Expected: passes for all FDs including `noldor-package-lift.md`. (Pre-migration this is `pnpm validate:features`; post-Task-8 it routes through the new CLI.) No commit — the FD is already committed and unchanged.

- [ ] **Step 14.2: Confirm `phase` stays `in-progress`**

The `phase: in-progress → done` flip is owned by `/gate` end-of-flow (`flipPhaseToDone`), not by this plan. Leave `phase: in-progress` here; do not set `introduced` (release-markers fills it at the next `pnpm release`).

---

## Task 15: Sweep skill SKILL.md refs to use new `pnpm noldor` CLI

**Files:**

- Modify: `packages/noldor/templates/.claude/skills/<each>/SKILL.md` (9 skills)
- After modify, run `noldor init --update` to sync into `.claude/skills/`

- [ ] **Step 15.1: Grep all SKILL.md for old script invocations**

Run from worktree root:

```bash
git grep -nE "pnpm\\s+(garden|cr|triage|validate|sync|noldor|sdd|gaps|check|docs|hook|release|migrate|next-priority|pr-flow|lint):" packages/noldor/templates/.claude/skills/
```

For each match, rewrite. Mapping table (excerpt — full table in spec):

| Old                           | New                                  |
| ----------------------------- | ------------------------------------ |
| `pnpm garden:detect`          | `pnpm noldor garden detect`          |
| `pnpm cr:orchestrate`         | `pnpm noldor cr orchestrate`         |
| `pnpm cr:codex`               | `pnpm noldor cr codex`               |
| `pnpm cr:aggregate`           | `pnpm noldor cr aggregate`           |
| `pnpm cr:escalate`            | `pnpm noldor cr escalate`            |
| `pnpm validate:noldor`        | `pnpm noldor validate noldor`        |
| `pnpm validate:features`      | `pnpm noldor validate features`      |
| `pnpm validate:milestones`    | `pnpm noldor validate milestones`    |
| `pnpm validate:triage`        | `pnpm noldor validate triage`        |
| `pnpm validate:skill-catalog` | `pnpm noldor validate skill-catalog` |
| `pnpm noldor:changelog`       | `pnpm noldor changelog`              |
| `pnpm next-priority`          | `pnpm noldor next-priority`          |
| `pnpm pr-flow`                | `pnpm noldor pr-flow`                |
| `pnpm sdd:report`             | `pnpm noldor garden sdd-report`      |
| `pnpm garden:receipt`         | `pnpm noldor garden receipt`         |
| `pnpm sync:doc-links`         | `pnpm noldor sync doc-links`         |
| `pnpm sync:test-links`        | `pnpm noldor sync test-links`        |
| `pnpm sync:spec-links`        | `pnpm noldor sync spec-links`        |
| `pnpm sync:fd-resources`      | `pnpm noldor sync fd-resources`      |
| `pnpm triage:list-untriaged`  | `pnpm noldor triage list-untriaged`  |
| `pnpm triage:score`           | `pnpm noldor triage score`           |
| `pnpm release`                | `pnpm noldor release`                |
| `pnpm docs:build`             | `pnpm noldor docs build`             |
| `pnpm docs:api`               | `pnpm noldor docs api`               |
| `pnpm docs:howto`             | `pnpm noldor docs howto`             |
| `pnpm docs:check`             | `pnpm noldor docs check`             |
| `pnpm docs:transclude`        | `pnpm noldor docs transclude`        |
| `pnpm check:invariants`       | `pnpm noldor checks invariants`      |
| `pnpm check:shared-files`     | `pnpm noldor checks shared-files`    |
| `pnpm hook:noldor:<x>`        | `pnpm noldor hooks <x>`              |

- [ ] **Step 15.2: Apply rewrites to template SKILL.md files**

For each of the 9 skills (`gate`, `garden`, `triage`, `promote`, `draft-feature-md`, `new-feature`, `milestone`, `release-sweep`, `refactor`), open `packages/noldor/templates/.claude/skills/<skill>/SKILL.md` and rewrite per the table.

After edits, also check sub-files (some skills have helper MD pages like `<skill>/recipe.md`, `<skill>/checklist.md`).

- [ ] **Step 15.3: Sync templates → consumer via `noldor init --update`**

```bash
node packages/noldor/bin/noldor.mjs init --update
```

Expected: reports `updated` for every modified SKILL.md.

- [ ] **Step 15.4: Verify doctor passes**

Run: `node packages/noldor/bin/noldor.mjs doctor`
Expected: clean.

- [ ] **Step 15.5: Commit**

```bash
git add packages/noldor/templates .claude/skills
git commit -m "feat(noldor-skills): rewrite skill SKILL.md script invocations to use 'pnpm noldor' CLI

All 9 framework skills updated. Templates + consumer copies in sync
(doctor clean).

Noldor-FD: noldor-package-lift"
```

---

## Task 16: Sweep docs/noldor/ refs to use new `pnpm noldor` CLI

**Files:**

- Modify: `packages/noldor/templates/docs/noldor/script-catalog.md`
- Modify: `packages/noldor/templates/docs/noldor/*.md` (any page with script refs)
- After modify, `noldor init --update` to sync.

- [ ] **Step 16.1: Grep templates/docs/noldor/ for old script invocations**

Run:

```bash
git grep -nE "pnpm\\s+(garden|cr|triage|validate|sync|noldor|sdd|gaps|check|docs|hook|release|migrate|next-priority|pr-flow|lint):" packages/noldor/templates/docs/noldor/
```

- [ ] **Step 16.2: Rewrite per mapping table from Task 15**

Apply rewrites. `script-catalog.md` will need a substantial rewrite — its primary content is the table of pnpm scripts.

For `script-catalog.md`, restructure: replace per-script entries with per-CLI-group entries listing each subcommand and what it does. Example shape:

```markdown
## garden

| Subcommand                 | Description                      |
| -------------------------- | -------------------------------- |
| `noldor garden detect`     | Detect framework drift sentinels |
| `noldor garden receipt`    | Write a garden receipt           |
| `noldor garden sdd-report` | Produce the SDD report           |
```

Repeat for every group.

- [ ] **Step 16.3: Update `adoption-guide.md`**

Replace the "stub — framework still WIP" stub with concrete adoption recipe now that lift is done:

```markdown
# Adoption Guide

Adopt Noldor in any pnpm project:

1. `pnpm add -D noldor`
2. `pnpm noldor init` — scaffolds `docs/noldor/`, `.claude/skills/<framework>/`, `.claude/noldor.md`, `.claude/engineering-rules.md`, `lefthook/noldor.yml`.
3. Edit `.claude/CLAUDE.md` to `@-import .claude/noldor.md`.
4. Edit `lefthook.yml` to `extends: ./lefthook/noldor.yml`.
5. Author `.claude/<consumer>-overlay.md` for any consumer-specific engineering rules.
6. Run `pnpm noldor doctor` in CI to enforce template-managed files stay in sync with the pkg.
```

(Keep the stub paragraph below as "Status notes" describing what is and isn't validated yet — only Charuy has been through the flow.)

- [ ] **Step 16.4: Sync templates → consumer**

Run: `node packages/noldor/bin/noldor.mjs init --update`
Expected: reports `updated` for each rewritten doc.

- [ ] **Step 16.5: Verify doctor passes**

Run: `node packages/noldor/bin/noldor.mjs doctor`
Expected: clean.

- [ ] **Step 16.6: Commit**

```bash
git add packages/noldor/templates docs/noldor
git commit -m "feat(noldor-docs): rewrite script-catalog + sweep docs for new CLI

Adoption-guide rewritten now that the package lift is done — replaces
the prior 'standalone-package lift in backlog' stub with the actual
adoption recipe.

Noldor-FD: noldor-package-lift"
```

---

## Task 17: Update .noldor/config.json schema if needed

**Files:**

- Possibly modify: `.noldor/config.json`
- Possibly modify: `packages/noldor/src/noldor/config-schema.ts` (or similar)

- [ ] **Step 17.1: Inspect current `.noldor/config.json`**

```bash
cat .noldor/config.json
```

- [ ] **Step 17.2: Inspect schema**

Run: `git grep -nE "scripts/" packages/noldor/src/validate/noldor-config.ts packages/noldor/src/noldor/`
For each hit referencing `scripts/<group>/`, decide:

- Glob targets framework source code → rewrite to `packages/noldor/src/<group>/`
- Glob targets consumer's `scripts/samples/` → keep `scripts/`

- [ ] **Step 17.3: Run config validator**

Run: `node packages/noldor/bin/noldor.mjs validate noldor-config`
Expected: passes. If schema mismatch surfaces, update either schema or config to match.

- [ ] **Step 17.4: If config changed, commit**

```bash
git add .noldor/config.json packages/noldor/src
git commit -m "fix(noldor-config): update config schema for package layout

Noldor-FD: noldor-package-lift"
```

If no changes needed, skip this commit.

---

## Task 18: Run validation gates

- [ ] **Step 18.1: pnpm verify**

Run: `pnpm verify`
Expected: lint + fmt + typecheck + samples + tests + doctor all pass.

- [ ] **Step 18.2: Garden detect baseline comparison**

Run: `pnpm noldor garden detect > /tmp/noldor-lift-garden-post.txt 2>&1 || true`

Diff: `diff /tmp/noldor-lift-garden-pre.txt /tmp/noldor-lift-garden-post.txt`
Expected: differences only in path references (e.g., `scripts/garden/...` → `packages/noldor/src/garden/...`). No semantic deltas (no new drift entries, no missing detections).

- [ ] **Step 18.3: SDD report baseline comparison**

Run: `pnpm noldor garden sdd-report > /tmp/noldor-lift-sdd-post.txt 2>&1 || true`

Diff: `diff /tmp/noldor-lift-sdd-pre.txt /tmp/noldor-lift-sdd-post.txt`
Expected: minor path-ref differences only.

- [ ] **Step 18.4: Validate-noldor baseline comparison**

Run: `pnpm noldor validate noldor > /tmp/noldor-lift-validate-post.txt 2>&1 || true`

Diff: `diff /tmp/noldor-lift-validate-pre.txt /tmp/noldor-lift-validate-post.txt`
Expected: clean or path-ref only.

- [ ] **Step 18.5: Lefthook fires on test commit**

```bash
# Empty commit only — a /tmp path can't be git-added (outside the repo);
# --allow-empty still triggers the pre-commit hook chain.
git commit --allow-empty -m "test: lefthook smoke check (revert next)

Noldor-FD: noldor-package-lift"
```

Expected: pre-commit hooks fire and pass. If pass, revert the smoke commit:

```bash
git reset --soft HEAD~1
```

- [ ] **Step 18.6: Pre-push smoke**

Run: `pnpm noldor hooks pre-push` (dry-run if supported, else just confirm script exists and is callable).

- [ ] **Step 18.7: Gate path smoke — scaffold dummy FD and validate**

```bash
node packages/noldor/bin/noldor.mjs features validate
```

Expected: validates all FDs in `docs/features/`, including the new `noldor-package-lift.md`.

- [ ] **Step 18.8: CR pipeline smoke (dry-run)**

```bash
node packages/noldor/bin/noldor.mjs cr orchestrate --dry-run
```

Expected: runs without error. If `--dry-run` flag doesn't exist, invoke a read-only sub-step (e.g., `cr aggregate` against existing findings).

- [ ] **Step 18.9: No further action — proceed to release prep on green**

If any of 18.1-18.8 fail, do not proceed. Fix and re-run.

---

## Task 19: Version + CHANGELOG — owned by release automation, NOT this PR

**Corrected.** The original plan hand-bumped root `package.json` to `0.7.0` and hand-wrote a `CHANGELOG.md` entry inside the feature PR. That contradicts this repo's release model: `pnpm release` (`scripts/release/`, `release-markers.ts`) owns the version bump, the `CHANGELOG.md` entry, and the FD `introduced` field, run as a **separate post-merge step** (orchestrated by `/release-sweep`), not inside a feature branch. Hand-editing them here would collide with the automation and likely fail the release-time `sdd:report` idempotency / changelog checks.

- [ ] **Step 19.1: Do not bump version or edit CHANGELOG here.**

Leave root `package.json` at its current version and `CHANGELOG.md` untouched on this branch. The feature PR ships `phase: in-progress` on the FD; `/gate` end-of-flow flips it to `done`; the next `pnpm release` (separate session, via `/release-sweep`) cuts the version (Charuy → next minor), regenerates the changelog from the FD changelog blocks, and fills `introduced`. `packages/noldor/package.json` stays `0.0.0` (no publish in this PR — Non-Goal).

- [ ] **Step 19.2: Capture the FD changelog block instead.**

If a human-curated changelog line is wanted, add it to the `## Changelog` section of `docs/features/noldor-package-lift.md` (which the release tool reads), not to root `CHANGELOG.md`. Optional — release automation can derive it.

---

## Task 20: Ship — owned by `/gate` end-of-flow, NOT manual `gh pr create`

**Corrected.** The original plan pushed + opened the PR by hand. In this repo that is the gate's end-of-flow responsibility: `/gate` Step 4 runs `flipPhaseToDone` → code-stage CR (`cr:orchestrate --kind code`) → `cr:aggregate` → `pnpm pr-flow` (`openAndAutoMerge`: push `--force-with-lease` → `gh pr create` → `gh pr merge --auto --squash` → poll) → worktree cleanup → next-priority handoff. The PR body is derived from session + FD + commit trailers; do not hand-roll `gh pr create`.

- [ ] **Step 20.1: Hand control back to `/gate` end-of-flow.**

When all tasks (1-19) are complete and `pnpm verify` is green, signal "ready to ship". The gate controller runs the end-of-flow sequence above. No manual `git push` / `gh pr create` / `gh pr merge` — pr-flow handles all of it, including auto-merge polling and post-merge worktree removal + `main` fast-forward.

- [ ] **Step 20.2: PR description source.**

`pr-flow` builds the body from the FD + spec/plan links automatically. If a richer description is desired (operator cheatsheet table, test-plan checklist from the original draft), it can be added to the FD Summary/Usage or pasted into the PR post-creation — but the cheatsheet's canonical home is `docs/noldor/script-catalog.md` (rewritten in Task 16).

---

## Self-Review (run after plan complete)

- [x] **Spec coverage**: each spec section maps to one or more tasks. Pkg shape → T1. Moves → T2-T7. CLI → T8. Templates → T9 (eng-principles excluded). init/doctor → T10, T11. Consumer wire-up → T12 (incl. eng-principles consumer drop), T13 (incl. T13.8 authoritative `init --adopt` from final state). FD → T14 (verification only — landed at gate entry). Sweeps → T15, T16. Config → T17. Validation → T18. Version/CHANGELOG → T19 (deferred to `pnpm release` automation). Ship → T20 (deferred to `/gate` end-of-flow / pr-flow).
- [x] **Gate reconciliation (added)**: plan was written against the original spec + a stale "FD lands at T14 / override-trailers until then" model. Reconciled to the executed gate flow: FD + session marker established at entry (`Noldor-FD:` auto-injected; no override trailers), spec revised in CR (eng-principles dropped, adopt-after-finalization ordering, `src/templates/` resolver, step-10 template→`init --update` sweep), release + PR owned by automation/gate not hand-steps.
- [x] **Placeholders scanned**: no "TBD"/"TODO" outside acknowledged Step 17 conditional. No "implement later" / "add error handling" patterns.
- [x] **Type consistency**: `DriftEntry.status` ∈ `{unchanged, drifted, missing}` (Task 10); `CopyEntry.status` ∈ `{added, updated, unchanged}` (Task 11). Distinct types intentionally — doctor uses drift, init uses copy. Both used per their definition site.
- [x] **CLI function contract**: every group's `main(args: string[])` export is reaffirmed in Task 8 Step 8.7 — confirmed pattern used in Step 8.6 command-group template.
- [x] **Spec ↔ plan path consistency**: `packages/noldor/templates/.claude/noldor.md` referenced uniformly. `packages/noldor/src/<group>/` referenced uniformly. `bin/noldor.mjs` tsx wrapper referenced uniformly.

Open follow-ups (deferred to post-PR per spec Out of Scope):

- npm publish workflow
- Multi-consumer dogfood
- Template variables for drift-allowed customization
- Shell completion
- Windows validation
