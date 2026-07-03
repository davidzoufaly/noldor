# Scan-Roots Repo-Paths Provider Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** One consumer-aware provider (`src/core/repo-paths.ts`) becomes the single source of truth for scan roots and `packages/` discovery: consumer `scanPaths` wins when set, the 4-dir union `['packages', 'apps', 'scripts', 'src']` is the only fallback. `fill-links-code-gaps` (both flows), dashboard `loadSddInput()`, `sdd-report` `main()`, and `propose-pointers` all resolve through it — so standalone `src/` repos (self-host included) stop seeing empty walks, the twin `readdir('packages')` blocks collapse into one function, and unconfigured monorepos stop getting `propose-pointers`' private `['src']` fallback (which also desynced `requireFreshGraph` roots from the roots the graph was built with).

**Architecture:** New core module beside `src/core/doc-roots.ts` (the established roots-provider precedent) exporting `DEFAULT_SCAN_ROOTS`, `scanRoots(cwd?)` (moved from `src/sync/sync-code-links.ts:63-66`; gains the standard core-provider `cwd = process.cwd()` param à la `loadDocRoots`/`loadConsumerConfig` for fixture tests — zero behavior change for existing no-arg callers), and `actualPackageNames(cwd?)` (extracted from the byte-identical blocks at `src/garden/sdd-report.ts:1154-1176` and `src/dashboard/data.ts:1077-1093`; deliberately `packages/`-only per spec D2). `sync-code-links.ts` keeps a compatibility re-export so `sdd-report`'s existing import path stays valid until Task 4 migrates it. `fill-links-code-gaps.ts` gains one exported `collectCandidateFiles(referenced)` helper replacing both duplicated walk+filter blocks. Dashboard `loadSddInput()` is exported and mirrors post-#122 `sdd-report` `main()` exactly: single union walk, `testFiles` derived by filtering `allRepoPaths` (the separate `testRepoPaths` copy + extra `walkRepo('scripts')` die — `scripts` is already in the union), `graphSrcRoots` = the same roots. `propose-pointers` hands `scanRoots()` to `requireFreshGraph` so freshness roots match graph-build roots (PR #90/#122 semantics).

**Tech Stack:** TypeScript (ESM, `.js` import suffixes, oxfmt printWidth 100, oxlint `--deny-warnings`), zod-validated consumer config, vitest (mkdtemp fixtures + save/restore `process.chdir` per the `src/garden/__tests__/graph-fd-lookup.test.ts` precedent; `vitest.setup.ts` re-anchors cwd to the repo root between suites).

Spec: [docs/superpowers/specs/2026-07-03-scan-roots-repo-paths-provider-design.md](../specs/2026-07-03-scan-roots-repo-paths-provider-design.md)

---

## File Structure

- `src/core/repo-paths.ts` — create; the provider: `DEFAULT_SCAN_ROOTS`, `scanRoots(cwd?)` (consumer `scanPaths` else union), `actualPackageNames(cwd?)` (`packages/*/package.json` names, ENOENT-tolerant)
- `src/core/__tests__/repo-paths.test.ts` — create; configured/empty-union `scanRoots` tests, fallback-union monorepo regression, re-export identity pin, `actualPackageNames` fixtures (named pkg + pkg-less dir; no `packages/` → `[]`)
- `src/sync/sync-code-links.ts` — modify; `DEFAULT_SCAN_ROOTS` + `scanRoots()` move out; import + compatibility re-export from core; now-unused `loadConsumerConfig` import dropped
- `src/features/fill-links-code-gaps.ts` — modify; new exported `collectCandidateFiles(referenced)` walking `scanRoots()`, replacing both duplicated walk+filter blocks (interactive flow lines 398-414, `runAutoHigh()` lines 474-490)
- `src/features/__tests__/fill-links-code-gaps.test.ts` — modify; standalone-layout regression (chdir fixture: `src/`-only repo yields candidates)
- `src/dashboard/data.ts` — modify; `loadSddInput()` exported + single `scanRoots()` union walk, `testFiles` derived by filter, `actualPackageNames()`, `graphSrcRoots` from the same roots; stale `scripts/sdd-report.ts` path in `loadGaps` JSDoc corrected
- `src/dashboard/__tests__/dashboard-data.test.ts` — modify; standalone-layout parity test (`allRepoPaths` non-empty, `graphSrcRoots` = `scanRoots()`, `actualPackages` = `[]`)
- `src/garden/sdd-report.ts` — modify; inline `readdir('packages')` block (lines 1154-1176) → `await actualPackageNames()`; `scanRoots` import (line 20) switched from `../sync/sync-code-links.js` to the core provider
- `src/features/propose-pointers.ts` — modify; lines 118-119 `['src']` fallback → `scanRoots()`; `loadConsumerConfig` import (now unused) swapped for the provider import
- `src/features/__tests__/propose-pointers.test.ts` — modify; source-guard regression (module imports the core provider, contains no src-only fallback literal)

---

## Task 1: Core provider module + tests + compatibility re-export

**Files:**

- Create: `src/core/repo-paths.ts`
- Modify: `src/sync/sync-code-links.ts`
- Test: `src/core/__tests__/repo-paths.test.ts`

- [ ] **Step 1: Write the failing provider tests**

Create `src/core/__tests__/repo-paths.test.ts` with exactly:

```ts
// @tests: scan-roots-repo-paths-provider

import { describe, expect, it } from 'vitest';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_SCAN_ROOTS, actualPackageNames, scanRoots } from '../repo-paths.js';
import { scanRoots as legacyScanRoots } from '../../sync/sync-code-links.js';

const MINIMAL_CONSUMER = {
  name: 'acme',
  repoUrl: 'https://github.com/x/y',
  lockstepPackages: ['package.json'],
  scanPaths: [],
  boundaries: [],
  deprecatedPackages: [],
  e2ePrefix: '',
  samplesPath: '',
  packagePrefix: '',
  appPathPrefix: '',
};

function makeTmpRepo(scanPaths: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-repo-paths-'));
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  writeFileSync(
    join(dir, '.noldor', 'config.json'),
    JSON.stringify({ consumer: { ...MINIMAL_CONSUMER, scanPaths } }),
  );
  return dir;
}

describe('scanRoots', () => {
  it('returns configured consumer scanPaths when non-empty', () => {
    const dir = makeTmpRepo(['src', 'tools']);
    try {
      expect(scanRoots(dir)).toEqual(['src', 'tools']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the 4-dir union when scanPaths is empty', () => {
    const dir = makeTmpRepo([]);
    try {
      expect(scanRoots(dir)).toEqual(['packages', 'apps', 'scripts', 'src']);
      expect(scanRoots(dir)).toEqual(DEFAULT_SCAN_ROOTS);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fallback-union regression: unconfigured monorepo roots include packages', () => {
    // PR #122 CR lesson: a src-only fallback regresses unconfigured monorepo
    // consumers. The union must win (propose-pointers had a private one).
    const dir = makeTmpRepo([]);
    try {
      mkdirSync(join(dir, 'packages', 'a'), { recursive: true });
      const roots = scanRoots(dir);
      expect(roots).toContain('packages');
      expect(roots).not.toEqual(['src']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is re-exported unchanged from sync-code-links (single definition)', () => {
    expect(legacyScanRoots).toBe(scanRoots);
  });
});

describe('actualPackageNames', () => {
  it('reads names from packages/*/package.json, skipping dirs without one', async () => {
    const dir = makeTmpRepo([]);
    try {
      mkdirSync(join(dir, 'packages', 'a'), { recursive: true });
      writeFileSync(
        join(dir, 'packages', 'a', 'package.json'),
        JSON.stringify({ name: '@acme/a' }),
      );
      mkdirSync(join(dir, 'packages', 'b'), { recursive: true }); // no package.json
      await expect(actualPackageNames(dir)).resolves.toEqual(['@acme/a']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns [] when packages/ does not exist (standalone layout)', async () => {
    const dir = makeTmpRepo(['src']);
    try {
      await expect(actualPackageNames(dir)).resolves.toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the new test file to verify it FAILS**

```bash
pnpm vitest run src/core/__tests__/repo-paths.test.ts
```

Expected output: `FAIL` — `Error: Failed to resolve import "../repo-paths.js" from "src/core/__tests__/repo-paths.test.ts". Does the file exist?`

- [ ] **Step 3: Create the provider module**

Create `src/core/repo-paths.ts` with exactly:

```ts
// @fd: scan-roots-repo-paths-provider

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { loadConsumerConfig } from './consumer-config.js';

/**
 * Union-of-layouts fallback used when consumer `scanPaths` is unset: covers
 * monorepo (`packages`/`apps`/`scripts`) and standalone (`src`) layouts.
 * Roots that don't exist are ENOENT-skipped by every walker.
 */
export const DEFAULT_SCAN_ROOTS = ['packages', 'apps', 'scripts', 'src'];

/**
 * Scan roots: consumer `scanPaths` when configured (non-empty), else
 * {@link DEFAULT_SCAN_ROOTS}. Single source of truth for every repo-walking
 * surface (sync code-links, sdd-report, dashboard, gap fillers, pointers) —
 * never hardcode layout dirs in a new feature.
 *
 * @param cwd - Consumer root holding `.noldor/config.json` (default `process.cwd()`)
 * @returns Relative directory names to walk from the consumer root
 */
export function scanRoots(cwd: string = process.cwd()): string[] {
  const { scanPaths } = loadConsumerConfig(cwd);
  return scanPaths.length > 0 ? scanPaths : DEFAULT_SCAN_ROOTS;
}

/**
 * Names declared by `packages/*/package.json`, in directory order.
 * Deliberately `packages/`-only rather than all scan roots: the result feeds
 * the README `### Packages` drift detector, and app names would fabricate
 * "missing from README" gaps (spec D2 — parity, not expansion).
 * ENOENT-tolerant: a standalone repo without `packages/` yields `[]`; dirs
 * without a `package.json` are skipped.
 *
 * @param cwd - Consumer root (default `process.cwd()`)
 * @returns Package names found under `packages/`
 */
export async function actualPackageNames(cwd: string = process.cwd()): Promise<string[]> {
  const names: string[] = [];
  try {
    const entries = await readdir(join(cwd, 'packages'), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const pkgJson = JSON.parse(
          await readFile(join(cwd, 'packages', entry.name, 'package.json'), 'utf8'),
        ) as { name?: string };
        if (pkgJson.name) names.push(pkgJson.name);
      } catch {
        // Skip dirs without package.json
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return names;
}
```

- [ ] **Step 4: Rewire `sync-code-links.ts` to import + re-export the provider**

In `src/sync/sync-code-links.ts`, replace the `loadConsumerConfig` import (line 8):

```ts
import { loadConsumerConfig } from '../core/consumer-config.js';
```

with:

```ts
import { scanRoots } from '../core/repo-paths.js';
```

Delete the `DEFAULT_SCAN_ROOTS` constant (line 14):

```ts
const DEFAULT_SCAN_ROOTS = ['packages', 'apps', 'scripts', 'src'];
```

Replace the `scanRoots` definition (lines 62-66):

```ts
/** Scan roots: consumer `scanPaths` when configured, else the default roster. */
export function scanRoots(): string[] {
  const { scanPaths } = loadConsumerConfig();
  return scanPaths.length > 0 ? scanPaths : DEFAULT_SCAN_ROOTS;
}
```

with:

```ts
// Compatibility re-export: the provider moved to src/core/repo-paths.ts
// (single definition). Existing importers keep this path; new code should
// import from '../core/repo-paths.js' directly.
export { scanRoots };
```

`collectTaggedCode` (line ~91) keeps calling `scanRoots()` through the imported binding — no other edit needed.

- [ ] **Step 5: Run to verify PASS**

```bash
pnpm vitest run src/core/__tests__/repo-paths.test.ts src/sync/__tests__/sync-code-links.test.ts
```

Expected output: `Test Files  2 passed (2)` — the 6 new provider tests plus the existing sync-code-links suite all green.

- [ ] **Step 6: Format and typecheck**

```bash
pnpm fmt && pnpm typecheck
```

Expected output: oxfmt reports formatted/unchanged files; `tsc --noEmit` exits silently with code 0.

- [ ] **Step 7: Commit**

```bash
git add src/core/repo-paths.ts src/core/__tests__/repo-paths.test.ts src/sync/sync-code-links.ts
git commit -m "feat(core): add repo-paths provider (scanRoots + actualPackageNames)" -m "Noldor-FD: scan-roots-repo-paths-provider"
```

---

## Task 2: `fill-links-code-gaps` walks `scanRoots()`

**Files:**

- Modify: `src/features/fill-links-code-gaps.ts`
- Test: `src/features/__tests__/fill-links-code-gaps.test.ts`

- [ ] **Step 1: Write the failing standalone-layout regression tests**

In `src/features/__tests__/fill-links-code-gaps.test.ts`, add `rmSync` to the `node:fs` import (line 5) and `collectCandidateFiles` to the module import (lines 9-15):

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
```

```ts
import {
  backupFeatures,
  collectCandidateFiles,
  generateProposal,
  parseLlmResponse,
  parseProposal,
  resolveByPath,
} from '../fill-links-code-gaps.js';
```

Append at the end of the file:

```ts
function makeStandaloneRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-standalone-'));
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  writeFileSync(
    join(dir, '.noldor', 'config.json'),
    JSON.stringify({
      consumer: {
        name: 'acme',
        repoUrl: 'https://github.com/x/y',
        lockstepPackages: ['package.json'],
        scanPaths: [],
        boundaries: [],
        deprecatedPackages: [],
        e2ePrefix: '',
        samplesPath: '',
        packagePrefix: '',
        appPathPrefix: '',
      },
    }),
  );
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'widget.ts'), 'export const widget = 1;\n');
  writeFileSync(join(dir, 'src', 'widget.test.ts'), 'export {};\n');
  return dir;
}

describe('collectCandidateFiles', () => {
  // Regression: the hardcoded packages/apps/scripts trio saw nothing on a
  // standalone src/ layout, so the gap filler silently proposed nothing.
  it('sees a standalone src/ layout via the scanRoots union (empty scanPaths)', async () => {
    const dir = makeStandaloneRepo();
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      const files = await collectCandidateFiles(new Set());
      expect(files).toEqual(['src/widget.ts']);
    } finally {
      process.chdir(previousCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('drops files already referenced in some FD links.code', async () => {
    const dir = makeStandaloneRepo();
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      const files = await collectCandidateFiles(new Set(['src/widget.ts']));
      expect(files).toEqual([]);
    } finally {
      process.chdir(previousCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

Note: `tmpdir` and `join` are already imported at the top of this test file.

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/features/__tests__/fill-links-code-gaps.test.ts
```

Expected output: `FAIL` — `SyntaxError: The requested module '../fill-links-code-gaps.js' does not provide an export named 'collectCandidateFiles'`.

- [ ] **Step 3: Add the shared candidate-collection helper**

In `src/features/fill-links-code-gaps.ts`, add the provider import after the `loadConsumerConfig` import (line 19):

```ts
import { scanRoots } from '../core/repo-paths.js';
```

Insert the helper immediately above the JSDoc of `runAutoHigh()` (the comment starting `/**` / `* Non-interactive backfill: …`, line ~459):

```ts
/**
 * Walk the consumer scan roots and return unreferenced candidate code files
 * for links-code gap filling. Shared by the interactive proposal flow and
 * `--auto-high`; exported for the standalone-layout regression tests.
 *
 * @param referenced - Code paths already present in some FD's `links.code`
 * @returns Repo-relative candidate file paths
 */
export async function collectCandidateFiles(referenced: Set<string>): Promise<string[]> {
  const allPaths: string[] = [];
  for (const root of scanRoots()) {
    await walkRepo(root, allPaths);
  }
  return allPaths.filter(
    (p) =>
      (p.endsWith('.ts') || p.endsWith('.tsx')) &&
      !p.includes('/__tests__/') &&
      !p.includes('/node_modules/') &&
      !p.endsWith('.test.ts') &&
      !p.endsWith('.test.tsx') &&
      !p.endsWith('.spec.ts') &&
      !p.includes('/dist/') &&
      !isInfraFile(p) &&
      !referenced.has(p),
  );
}
```

`walkRepo` (imported from `../garden/sdd-report.js`, line 17) is ENOENT-tolerant, so union roots that don't exist are skipped silently.

- [ ] **Step 4: Replace both duplicated walk+filter blocks**

The following block appears **twice**, byte-identical — in the interactive flow (lines 398-414) and in `runAutoHigh()` (lines 474-490):

```ts
  const allPaths: string[] = [];
  await walkRepo('packages', allPaths);
  await walkRepo('apps', allPaths);
  await walkRepo('scripts', allPaths);

  const candidateFiles = allPaths.filter(
    (p) =>
      (p.endsWith('.ts') || p.endsWith('.tsx')) &&
      !p.includes('/__tests__/') &&
      !p.includes('/node_modules/') &&
      !p.endsWith('.test.ts') &&
      !p.endsWith('.test.tsx') &&
      !p.endsWith('.spec.ts') &&
      !p.includes('/dist/') &&
      !isInfraFile(p) &&
      !referenced.has(p),
  );
```

Replace **both** occurrences (use replace-all) with:

```ts
  const candidateFiles = await collectCandidateFiles(referenced);
```

- [ ] **Step 5: Run to verify PASS**

```bash
pnpm vitest run src/features/__tests__/fill-links-code-gaps.test.ts
```

Expected output: `Test Files  1 passed (1)` — all existing tests plus the 2 new `collectCandidateFiles` tests green.

- [ ] **Step 6: Format and typecheck**

```bash
pnpm fmt && pnpm typecheck
```

Expected output: clean format; `tsc --noEmit` exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/features/fill-links-code-gaps.ts src/features/__tests__/fill-links-code-gaps.test.ts
git commit -m "fix(features): walk scanRoots in fill-links-code-gaps flows" -m "Noldor-FD: scan-roots-repo-paths-provider"
```

---

## Task 3: Dashboard `loadSddInput()` parity with `sdd-report` `main()`

**Files:**

- Modify: `src/dashboard/data.ts`
- Test: `src/dashboard/__tests__/dashboard-data.test.ts`

- [ ] **Step 1: Write the failing layout-parity test**

In `src/dashboard/__tests__/dashboard-data.test.ts`, add `mkdir` to the `node:fs/promises` import (line 6), add `loadSddInput` to the `../data.js` import list (lines 13-37, inserted alphabetically after `loadRoadmapWithHash`), and add the provider import after that import block:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
```

```ts
  loadSddInput,
```

```ts
import { DEFAULT_SCAN_ROOTS } from '../../core/repo-paths.js';
```

Append at the end of the file:

```ts
describe('loadSddInput layout parity', () => {
  // Regression: the hardcoded packages/apps(+scripts) walk left allRepoPaths
  // empty on a standalone src/ repo and graphSrcRoots pinned to the Charuy
  // trio, so dashboard gaps diverged from sdd-report main() (post-#122).
  it('walks scanRoots() and mirrors them into graphSrcRoots on a standalone layout', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'noldor-dash-standalone-'));
    await mkdir(join(dir, '.noldor'), { recursive: true });
    await writeFile(
      join(dir, '.noldor', 'config.json'),
      JSON.stringify({
        consumer: {
          name: 'acme',
          repoUrl: 'https://github.com/x/y',
          lockstepPackages: ['package.json'],
          scanPaths: [],
          boundaries: [],
          deprecatedPackages: [],
          e2ePrefix: '',
          samplesPath: '',
          packagePrefix: '',
          appPathPrefix: '',
        },
      }),
    );
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'widget.ts'), 'export const widget = 1;\n');
    await writeFile(join(dir, 'src', 'widget.test.ts'), 'export {};\n');
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      const input = await loadSddInput();
      expect(input.allRepoPaths).toContain('src/widget.ts');
      expect(input.allRepoPaths).toContain('src/widget.test.ts');
      expect(input.testInputs.map((t) => t.path)).toEqual(['src/widget.test.ts']);
      expect(input.graphSrcRoots).toEqual(DEFAULT_SCAN_ROOTS);
      expect(input.actualPackages).toEqual([]);
    } finally {
      process.chdir(previousCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/dashboard/__tests__/dashboard-data.test.ts
```

Expected output: `FAIL` — `SyntaxError: The requested module '../data.js' does not provide an export named 'loadSddInput'`.

- [ ] **Step 3: Rewire `loadSddInput()` onto the provider**

In `src/dashboard/data.ts`, add the provider import after the `loadDocRoots` import (line 20):

```ts
import { actualPackageNames, scanRoots } from '../core/repo-paths.js';
```

Replace the head of `loadSddInput` (lines 1043-1060) — the signature through the `testInputs` line:

```ts
async function loadSddInput(): Promise<ReportInput> {
  const features = await loadSddFeatures('docs/features');
  const ideasMd = await readFile('ideas.md', 'utf8').catch(() => '');
  const backlogRaw = await readFile('docs/backlog.md', 'utf8').catch(() => '');
  const backlog = parseBacklog(backlogRaw);
  const specPaths = await listSpecs('docs/superpowers/specs');
  const planPaths = await listPlans('docs/superpowers/plans');

  const allRepoPaths: string[] = [];
  await walkRepo('packages', allRepoPaths);
  await walkRepo('apps', allRepoPaths);

  const testRepoPaths = [...allRepoPaths];
  await walkRepo('scripts', testRepoPaths);
  const testFiles = testRepoPaths.filter(
    (p) => /\.test\.(ts|tsx)$/.test(p) || /\.spec\.(ts|tsx)$/.test(p),
  );
  const testInputs = await readTextFiles(testFiles);
```

with:

```ts
/**
 * Build the SDD `ReportInput` the same way `sdd-report` `main()` does — scan
 * roots and package discovery via `src/core/repo-paths.ts` — so dashboard gap
 * output matches `pnpm noldor garden sdd-report` on any layout. Exported for
 * the layout-parity regression tests; production callers use {@link loadGaps}.
 */
export async function loadSddInput(): Promise<ReportInput> {
  const features = await loadSddFeatures('docs/features');
  const ideasMd = await readFile('ideas.md', 'utf8').catch(() => '');
  const backlogRaw = await readFile('docs/backlog.md', 'utf8').catch(() => '');
  const backlog = parseBacklog(backlogRaw);
  const specPaths = await listSpecs('docs/superpowers/specs');
  const planPaths = await listPlans('docs/superpowers/plans');

  const roots = scanRoots();
  const allRepoPaths: string[] = [];
  for (const root of roots) {
    await walkRepo(root, allRepoPaths);
  }

  const testFiles = allRepoPaths.filter(
    (p) => /\.test\.(ts|tsx)$/.test(p) || /\.spec\.(ts|tsx)$/.test(p),
  );
  const testInputs = await readTextFiles(testFiles);
```

(The separate `testRepoPaths` copy + extra `walkRepo('scripts')` are deleted — `scripts` is already in the union and in Charuy's configured `scanPaths`.)

Replace the inline `actualPackages` block (lines 1077-1093):

```ts
  const actualPackages: string[] = [];
  try {
    const pkgEntries = await readdir('packages', { withFileTypes: true });
    for (const e of pkgEntries) {
      if (!e.isDirectory()) continue;
      try {
        const pkgJson = JSON.parse(
          await readFile(join('packages', e.name, 'package.json'), 'utf8'),
        ) as { name?: string };
        if (pkgJson.name) actualPackages.push(pkgJson.name);
      } catch {
        // Skip dirs without package.json
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
```

with:

```ts
  const actualPackages = await actualPackageNames();
```

Replace the `graphSrcRoots` literal (line 1105):

```ts
    graphSrcRoots: ['packages', 'apps', 'scripts'],
```

with:

```ts
    graphSrcRoots: roots,
```

Finally, fix the stale path in the `loadGaps` JSDoc (line 1033): change ``Mirrors `scripts/sdd-report.ts` `main()` …`` to ``Mirrors `src/garden/sdd-report.ts` `main()` …``.

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/dashboard/__tests__/dashboard-data.test.ts
```

Expected output: `Test Files  1 passed (1)` — including the new `loadSddInput layout parity` test and the pre-existing `loadGaps` shape test (which now walks noldor's configured `scanPaths: ["src"]`).

- [ ] **Step 5: Run the whole dashboard suite (behavior-shift check)**

```bash
pnpm vitest run src/dashboard
```

Expected output: all 20 dashboard test files pass. (Spec risk note: on Charuy-like layouts `allRepoPaths` now also contains `scripts/**` — that is the honest parity the `loadGaps` doc comment already promises.)

- [ ] **Step 6: Format and typecheck**

```bash
pnpm fmt && pnpm typecheck
```

Expected output: clean format; `tsc --noEmit` exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/data.ts src/dashboard/__tests__/dashboard-data.test.ts
git commit -m "fix(dashboard): mirror sdd-report scan roots in loadSddInput" -m "Noldor-FD: scan-roots-repo-paths-provider"
```

---

## Task 4: `sdd-report` `main()` dedup onto the provider

This task is a pure refactor (behavior already pinned by Task 1's `actualPackageNames` unit tests and the existing garden suite), so the red/green evidence is the duplication grep.

**Files:**

- Modify: `src/garden/sdd-report.ts`
- Test: `src/garden/__tests__/sdd-report.test.ts` (existing suite — no new tests)

- [ ] **Step 1: Verify the duplication is present (RED)**

```bash
grep -n "readdir('packages'" src/garden/sdd-report.ts
```

Expected output: one hit — `1156:    const pkgEntries = await readdir('packages', { withFileTypes: true });`

- [ ] **Step 2: Switch the import to the core provider**

In `src/garden/sdd-report.ts`, replace line 20:

```ts
import { scanRoots as resolveScanRoots } from '../sync/sync-code-links.js';
```

with:

```ts
import { actualPackageNames, scanRoots as resolveScanRoots } from '../core/repo-paths.js';
```

(The `resolveScanRoots` alias is kept — `main()` binds a local `const scanRoots = resolveScanRoots();` at line 1128.)

- [ ] **Step 3: Swap the inline block for the provider call**

Replace the `actualPackages` block in `main()` (lines 1154-1176):

```ts
  const actualPackages: string[] = [];
  try {
    const pkgEntries = await readdir('packages', { withFileTypes: true });
    for (const e of pkgEntries) {
      if (!e.isDirectory()) {
        continue;
      }
      try {
        const pkgJson = JSON.parse(
          await readFile(join('packages', e.name, 'package.json'), 'utf8'),
        ) as {
          name?: string;
        };
        if (pkgJson.name) {
          actualPackages.push(pkgJson.name);
        }
      } catch {
        // Skip dirs without package.json
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
```

with:

```ts
  const actualPackages = await actualPackageNames();
```

- [ ] **Step 4: Verify the dedup and run the garden suite (GREEN)**

```bash
grep -n "readdir('packages'" src/garden/sdd-report.ts; grep -n "sync-code-links" src/garden/sdd-report.ts; pnpm vitest run src/garden
```

Expected output: both greps print nothing (the only `packages/` readdir now lives in the provider, and the sync-code-links import path is gone from sdd-report); all garden test files pass.

- [ ] **Step 5: Format and typecheck**

```bash
pnpm fmt && pnpm typecheck
```

Expected output: clean format; `tsc --noEmit` exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/garden/sdd-report.ts
git commit -m "refactor(garden): dedupe sdd-report package discovery via repo-paths" -m "Noldor-FD: scan-roots-repo-paths-provider"
```

---

## Task 5: `propose-pointers` fallback flip + full acceptance sweep

**Files:**

- Modify: `src/features/propose-pointers.ts`
- Test: `src/features/__tests__/propose-pointers.test.ts`

- [ ] **Step 1: Write the failing source-guard regression test**

The union-fallback *behavior* is already pinned in `src/core/__tests__/repo-paths.test.ts` (Task 1's monorepo-fixture regression). This guard pins that `propose-pointers` actually delegates to it and never regrows a private src-only fallback (spec acceptance criterion). In `src/features/__tests__/propose-pointers.test.ts`, add after the vitest import (line 3):

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
```

Append at the end of the file:

```ts
describe('root resolution', () => {
  // Guards the PR #122 CR lesson at the call site: roots handed to
  // requireFreshGraph must come from the shared union provider, not a
  // module-private src-only fallback that regresses unconfigured monorepos.
  it('delegates to the core scanRoots provider with no private src-only fallback', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'features', 'propose-pointers.ts'),
      'utf8',
    );
    expect(source).toContain("from '../core/repo-paths.js'");
    expect(source).toContain('scanRoots()');
    expect(source).not.toContain("['src']");
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/features/__tests__/propose-pointers.test.ts
```

Expected output: `FAIL` — the new test's first assertion fails (`expected '…' to contain "from '../core/repo-paths.js'"`); the module still carries the `['src']` fallback.

- [ ] **Step 3: Flip the fallback to the provider**

In `src/features/propose-pointers.ts`, replace the `loadConsumerConfig` import (line 5):

```ts
import { loadConsumerConfig } from '../core/consumer-config.js';
```

with:

```ts
import { scanRoots } from '../core/repo-paths.js';
```

(`loadConsumerConfig` has no other use in this module.)

Replace lines 118-119 in `main()`:

```ts
  const { scanPaths } = loadConsumerConfig();
  const srcRoots = scanPaths.length > 0 ? scanPaths : ['src'];
```

with:

```ts
  // Union fallback must match the roots the graph/receipt were built with
  // (PR #90/#122 semantics); a private src-only fallback regressed
  // unconfigured monorepo consumers and made requireFreshGraph compare the
  // wrong tree.
  const srcRoots = scanRoots();
```

The `requireFreshGraph('graphify-out/graph.json', srcRoots, features)` call (line 121) is untouched — it now receives the same roots graph builds and receipts use. (Note: freshness receipts recorded under old `['src']` roots may prompt a one-time graph rebuild — expected per spec risk.)

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/features/__tests__/propose-pointers.test.ts
```

Expected output: `Test Files  1 passed (1)` — existing `rankCandidates`/`proposeCandidates` tests plus the new source guard all green.

- [ ] **Step 5: Run the spec's acceptance greps**

```bash
grep -rn "walkRepo('packages'\|walkRepo('apps'\|walkRepo('scripts'" src/
grep -rn "readdir('packages'" src/
grep -rn "DEFAULT_SCAN_ROOTS =" src/
grep -rn "export function scanRoots" src/
grep -n "\['src'\]" src/features/propose-pointers.ts
```

Expected output, command by command:
1. no output (exit 1) — no hardcoded walk trio anywhere in `src/`
2. no output (exit 1) — the only `packages/` readdir is the provider's `readdir(join(cwd, 'packages')…)` form inside `src/core/repo-paths.ts`
3. exactly one hit: `src/core/repo-paths.ts:…export const DEFAULT_SCAN_ROOTS = ['packages', 'apps', 'scripts', 'src'];`
4. exactly one hit in `src/core/repo-paths.ts` (the `sync-code-links.ts` compat path is a re-export, not a second definition)
5. no output (exit 1) — no `['src']` fallback left in `propose-pointers.ts`

(Out of scope by spec: the tolerant `['src']` default inside the dashboard test-pyramid loader at `src/dashboard/data.ts` ~line 1670 and the pattern-matcher heuristics listed under spec Non-goals — do not touch them.)

- [ ] **Step 6: Full verification**

```bash
pnpm verify
```

Expected output: `oxlint` clean (`--deny-warnings`), `oxfmt --check` clean, `tsc --noEmit` exits 0, and `vitest run` reports every test file passed — including the four suites this plan added to or touched.

- [ ] **Step 7: Commit**

```bash
git add src/features/propose-pointers.ts src/features/__tests__/propose-pointers.test.ts
git commit -m "fix(features): resolve propose-pointers roots via scanRoots union" -m "Noldor-FD: scan-roots-repo-paths-provider"
```
