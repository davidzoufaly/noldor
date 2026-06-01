# Framework Doc Extraction — Phase A (De-Charuy-fication) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `packages/noldor/src/` consumable by any monorepo by replacing every hardcoded Charuy-specific constant with a read from `.noldor/config.json` `consumer:` block, threading a parametrised `loadDocRoots()` through every doc-reading module, and fixing two latent bugs (`vitest.setup.ts` chdir, dashboard `STATIC_ROOT` stale path) plus adding a `--docs` flag to the dashboard server.

**Architecture:** Two new shared utilities live under `packages/noldor/src/core/`:

1. `consumer-config.ts` — zod-validated reader for the `consumer:` block in `.noldor/config.json`. Exposes `loadConsumerConfig(cwd?)` returning a typed object with fields like `lockstepPackages`, `repoUrl`, `boundaries`, `packagePrefix`, `e2ePrefix`, `samplesPath`, `pnpmStderrPrefix`, `name`.
2. `doc-roots.ts` — pure helper `loadDocRoots(cwd?)` returning paths to `features/`, `roadmap.md`, `backlog.md`, etc.

Both are pure functions of `cwd` (default `process.cwd()`). Every existing consumer of hardcoded constants threads through these helpers; no constants survive in framework runtime code. The dashboard server gains a `--docs <path>` CLI flag that overrides cwd-derived doc roots, enabling two-dashboard execution (one per repo) post-extract.

**Tech Stack:** TypeScript, zod (already a noldor dep), vitest, node:fs. No new dependencies.

---

## File structure

**New files:**

- `packages/noldor/src/core/consumer-config.ts` — schema + `loadConsumerConfig()`
- `packages/noldor/src/core/__tests__/consumer-config.test.ts`
- `packages/noldor/src/core/doc-roots.ts` — `loadDocRoots()`
- `packages/noldor/src/core/__tests__/doc-roots.test.ts`

**Modified runtime files (in execution order):**

- `.noldor/config.json` — add `consumer:` block
- `packages/noldor/vitest.setup.ts` — `..` instead of `../..`
- `packages/noldor/src/dashboard/server.ts` — `STATIC_ROOT` via `import.meta.url`; new `--docs` flag
- `packages/noldor/src/release/index.ts` — `LOCKSTEP_PACKAGES` + tmp path from config
- `packages/noldor/src/release/release-packages.ts` — `LOCKSTEP_PACKAGES` from config
- `packages/noldor/src/release/release-dry-run.ts` — `repoUrl` from config
- `packages/noldor/src/dashboard/views.ts` — `GITHUB_REPO` default from config
- `packages/noldor/src/invariants/boundaries.ts` — rules from config
- `packages/noldor/src/garden/sdd-report.ts` — `E2E_PREFIX` + `@charuy/` matcher from config
- `packages/noldor/src/garden/garden-detect.ts` — pnpm stderr prefix from config
- `packages/noldor/src/garden/graph-fd-lookup.ts` — samples whitelist from config
- `packages/noldor/src/features/fill-links-code-gaps.ts` — `apps/web/` startsWith from config
- `packages/noldor/src/features/validate-features.ts` — `@charuy/`/`apps/` strip from config
- `packages/noldor/src/dashboard/data.ts` — module constants → accessor functions via `loadDocRoots()`
- `packages/noldor/src/garden/sdd-report.ts` (second touch) — relative-string `readFile`/`listSpecs` calls via `loadDocRoots()`
- `packages/noldor/src/garden/garden-detect.ts` (second touch) — `'docs/...'` literals in `join(repo, ...)` calls via `loadDocRoots()`
- `packages/noldor/src/core/next-priority.ts` — same pattern + latent `readFile('docs/roadmap.md')` bug fix
- `packages/noldor/src/garden/plan-resolution.ts` — single `join(opts.repo, 'docs/features')` via `loadDocRoots()`

**Deferred to Phase B (not Phase A):**

- `packages/noldor/src/core/allowlist.ts:4-24` — minimatch globs (`'docs/**/*.md'`), need separate `globRoots` config field
- `packages/noldor/src/core/rename-plan-only-tier.ts:47-62` — same glob pattern
- `packages/noldor/vitest.setup.ts` — chdir fix depends on `packages/noldor/docs/` being populated

Each task lands as its own commit. Tasks ordered so each leaves the tree green; later tasks consume earlier outputs.

---

## Task 1: `consumer-config.ts` schema + loader (TDD)

**Files:**

- Create: `packages/noldor/src/core/consumer-config.ts`
- Test: `packages/noldor/src/core/__tests__/consumer-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/noldor/src/core/__tests__/consumer-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadConsumerConfig,
  ConsumerConfigSchema,
  BoundaryRuleSchema,
} from '../consumer-config.js';

function makeTmpRepo(config: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-consumer-cfg-'));
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  writeFileSync(join(dir, '.noldor', 'config.json'), JSON.stringify(config));
  return dir;
}

describe('loadConsumerConfig', () => {
  it('returns parsed consumer block when present', () => {
    const dir = makeTmpRepo({
      consumer: {
        name: 'charuy',
        repoUrl: 'https://github.com/x/y',
        lockstepPackages: ['apps/web/package.json'],
        scanPaths: ['apps/web/src'],
        boundaries: [],
        deprecatedPackages: [],
        e2ePrefix: 'apps/web/e2e/',
        samplesPath: 'apps/web/public/samples',
        packagePrefix: '@charuy/',
        pnpmStderrPrefix: 'charuy@',
        appPathPrefix: 'apps/web/',
      },
    });
    try {
      const cfg = loadConsumerConfig(dir);
      expect(cfg.name).toBe('charuy');
      expect(cfg.lockstepPackages).toEqual(['apps/web/package.json']);
      expect(cfg.packagePrefix).toBe('@charuy/');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when consumer block missing', () => {
    const dir = makeTmpRepo({ crLanes: { spec: ['subagent'] } });
    try {
      expect(() => loadConsumerConfig(dir)).toThrow(/consumer/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when config.json missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-no-cfg-'));
    try {
      expect(() => loadConsumerConfig(dir)).toThrow(/config\.json/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('schema rejects empty lockstepPackages array', () => {
    expect(() =>
      ConsumerConfigSchema.parse({
        name: 'x',
        repoUrl: 'https://example.com',
        lockstepPackages: [],
        scanPaths: [],
        boundaries: [],
        deprecatedPackages: [],
        e2ePrefix: '',
        samplesPath: '',
        packagePrefix: '',
        pnpmStderrPrefix: '',
        appPathPrefix: '',
      }),
    ).toThrow();
  });

  it('accepts dep-cruiser-style boundary rule', () => {
    expect(() =>
      BoundaryRuleSchema.parse({
        name: 'engine-no-viewport',
        severity: 'error',
        from: { path: '^packages/engine/src' },
        to: { path: '^packages/viewport/' },
      }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter noldor test consumer-config
```

Expected: FAIL with module-not-found for `../consumer-config.js`.

- [ ] **Step 3: Implement `consumer-config.ts`**

Create `packages/noldor/src/core/consumer-config.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

// Boundary rules mirror dependency-cruiser's forbidden-rule shape.
// `from.path` / `to.path` are REGEX STRINGS consumed by dep-cruiser,
// not glob patterns. See packages/noldor/src/invariants/boundaries.ts
// FORBIDDEN_RULES for canonical examples.
export const BoundaryRuleSchema = z.object({
  name: z.string().min(1),
  severity: z.enum(['error', 'warn', 'info']),
  from: z.object({ path: z.string().min(1) }),
  to: z.object({ path: z.string().min(1) }),
});

export const ConsumerConfigSchema = z.object({
  name: z.string().min(1),
  repoUrl: z.string().url(),
  lockstepPackages: z.array(z.string().min(1)).min(1),
  scanPaths: z.array(z.string().min(1)).default([]),
  boundaries: z.array(BoundaryRuleSchema).default([]),
  deprecatedPackages: z.array(z.string()).default([]),
  e2ePrefix: z.string(),
  samplesPath: z.string(),
  packagePrefix: z.string(),
  pnpmStderrPrefix: z.string(),
  appPathPrefix: z.string(),
});

export type ConsumerConfig = z.infer<typeof ConsumerConfigSchema>;
export type BoundaryRule = z.infer<typeof BoundaryRuleSchema>;

const CONFIG_FILE = '.noldor/config.json';

export function loadConsumerConfig(cwd: string = process.cwd()): ConsumerConfig {
  const path = join(cwd, CONFIG_FILE);
  if (!existsSync(path)) {
    throw new Error(
      `loadConsumerConfig: missing ${CONFIG_FILE} at ${cwd}. Every noldor consumer must declare a consumer: block.`,
    );
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { consumer?: unknown };
  if (raw.consumer === undefined) {
    throw new Error(
      `loadConsumerConfig: ${CONFIG_FILE} has no consumer: block. See packages/noldor/docs/consumer-config.md for required fields.`,
    );
  }
  return ConsumerConfigSchema.parse(raw.consumer);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter noldor test consumer-config
```

Expected: PASS, 4/4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/noldor/src/core/consumer-config.ts packages/noldor/src/core/__tests__/consumer-config.test.ts
git commit -m "feat(noldor:core): add consumer-config loader and zod schema

Reads .noldor/config.json consumer: block. Validates required
fields (name, repoUrl, lockstepPackages, packagePrefix, etc.)
via zod. Used by Phase A parametrisation to remove hardcoded
Charuy constants from framework runtime."
```

---

## Task 2: `doc-roots.ts` utility (TDD)

**Files:**

- Create: `packages/noldor/src/core/doc-roots.ts`
- Test: `packages/noldor/src/core/__tests__/doc-roots.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/noldor/src/core/__tests__/doc-roots.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadDocRoots } from '../doc-roots.js';

describe('loadDocRoots', () => {
  it('returns docs/* paths anchored at given cwd', () => {
    const r = loadDocRoots('/tmp/example');
    expect(r.features).toBe('/tmp/example/docs/features');
    expect(r.roadmap).toBe('/tmp/example/docs/roadmap.md');
    expect(r.backlog).toBe('/tmp/example/docs/backlog.md');
    expect(r.vision).toBe('/tmp/example/docs/vision.md');
    expect(r.ideas).toBe('/tmp/example/docs/ideas.md');
    expect(r.milestones).toBe('/tmp/example/docs/milestones');
    expect(r.plans).toBe('/tmp/example/docs/superpowers/plans');
    expect(r.specs).toBe('/tmp/example/docs/superpowers/specs');
  });

  it('defaults to process.cwd() when omitted', () => {
    const r = loadDocRoots();
    expect(r.features.endsWith('/docs/features')).toBe(true);
    expect(r.roadmap.endsWith('/docs/roadmap.md')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter noldor test doc-roots
```

Expected: FAIL with module-not-found for `../doc-roots.js`.

- [ ] **Step 3: Implement `doc-roots.ts`**

Create `packages/noldor/src/core/doc-roots.ts`:

```ts
import { join } from 'node:path';

export interface DocRoots {
  features: string;
  roadmap: string;
  backlog: string;
  vision: string;
  ideas: string;
  milestones: string;
  plans: string;
  specs: string;
}

export function loadDocRoots(cwd: string = process.cwd()): DocRoots {
  return {
    features: join(cwd, 'docs', 'features'),
    roadmap: join(cwd, 'docs', 'roadmap.md'),
    backlog: join(cwd, 'docs', 'backlog.md'),
    vision: join(cwd, 'docs', 'vision.md'),
    ideas: join(cwd, 'docs', 'ideas.md'),
    milestones: join(cwd, 'docs', 'milestones'),
    plans: join(cwd, 'docs', 'superpowers', 'plans'),
    specs: join(cwd, 'docs', 'superpowers', 'specs'),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter noldor test doc-roots
```

Expected: PASS, 2/2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/noldor/src/core/doc-roots.ts packages/noldor/src/core/__tests__/doc-roots.test.ts
git commit -m "feat(noldor:core): add loadDocRoots helper

Returns absolute paths to features/, roadmap.md, backlog.md,
vision.md, ideas.md, milestones/, plans/, specs/ anchored at
given cwd (default process.cwd()). Replaces hardcoded
\`process.cwd()/docs/...\` strings scattered across dashboard,
garden, and core modules — single source of truth for
consumer doc layout."
```

---

## Task 3: Extend `.noldor/config.json` with `consumer:` block

**Files:**

- Modify: `.noldor/config.json`

- [ ] **Step 1: Read current config**

```bash
cat .noldor/config.json
```

Expected: shows `crLanes` + `autonomous` blocks only.

- [ ] **Step 2: Add `consumer:` block**

Replace `.noldor/config.json` contents with:

Boundary `scanPaths` + `boundaries` are transcribed verbatim from `packages/noldor/src/invariants/boundaries.ts:8-40` (`SCAN_PATHS` const + `FORBIDDEN_RULES` const). The `from.path` and `to.path` values are regex strings consumed by dependency-cruiser; preserve them literally.

```json
{
  "consumer": {
    "name": "charuy",
    "repoUrl": "https://github.com/davidzoufaly/charuy",
    "lockstepPackages": [
      "package.json",
      "apps/web/package.json",
      "packages/format/package.json",
      "packages/engine/package.json",
      "packages/viewport/package.json",
      "packages/test-fixtures/package.json",
      "packages/examples/package.json"
    ],
    "scanPaths": [
      "packages/engine/src",
      "packages/format/src",
      "packages/viewport/src",
      "apps/web/src"
    ],
    "boundaries": [
      {
        "name": "engine-no-viewport",
        "severity": "error",
        "from": { "path": "^packages/engine/src" },
        "to": { "path": "^packages/viewport/" }
      },
      {
        "name": "engine-no-web",
        "severity": "error",
        "from": { "path": "^packages/engine/src" },
        "to": { "path": "^apps/web/" }
      },
      {
        "name": "viewport-no-web",
        "severity": "error",
        "from": { "path": "^packages/viewport/src" },
        "to": { "path": "^apps/web/" }
      },
      {
        "name": "format-no-non-format",
        "severity": "error",
        "from": { "path": "^packages/format/src" },
        "to": { "path": "^(packages/(?!format(?:/|$))|apps/)" }
      }
    ],
    "deprecatedPackages": ["@charuy/agent-api"],
    "e2ePrefix": "apps/web/e2e/",
    "samplesPath": "apps/web/public/samples",
    "packagePrefix": "@charuy/",
    "pnpmStderrPrefix": "charuy@",
    "appPathPrefix": "apps/web/"
  },
  "crLanes": {
    "spec": ["subagent"],
    "plan": ["subagent", "manual"],
    "code": ["subagent"]
  },
  "autonomous": {
    "skipLanePicker": false,
    "onFailure": "prompt",
    "requireHumanPrApproval": false
  }
}
```

`deprecatedPackages` lists package names that historical references mention but which no longer exist on disk; sdd-report excludes them when computing "missing packages" (Task 9).

- [ ] **Step 3: Verify loader reads the block**

```bash
pnpm exec tsx -e "import {loadConsumerConfig} from './packages/noldor/src/core/consumer-config.ts'; console.log(loadConsumerConfig())"
```

Expected: prints parsed object with `name: 'charuy'`, `lockstepPackages: [7 entries]`.

- [ ] **Step 4: Commit**

```bash
git add .noldor/config.json
git commit -m "feat(noldor:config): add consumer block

Declares Charuy-specific values (lockstepPackages, repoUrl,
e2ePrefix, samplesPath, packagePrefix, pnpmStderrPrefix) that
noldor runtime modules will read via loadConsumerConfig in
subsequent tasks. boundaries: [] stays empty until invariants
migration."
```

---

## Task 4: Fix `vitest.setup.ts` chdir

**Files:**

- Modify: `packages/noldor/vitest.setup.ts`

- [ ] **Step 1: Inspect current chdir target**

Current:

```ts
process.chdir(resolve(here, '..', '..'));
```

`here = packages/noldor/`. Two levels up = Charuy root. Works in monorepo, breaks in standalone (lands above noldor checkout).

- [ ] **Step 2: Change to one level up**

Edit `packages/noldor/vitest.setup.ts`:

```ts
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Anchor process.cwd() at the noldor package root so tests find
// docs/, .claude/, scripts/, and other consumer files relative to
// the consumer repo. In the Charuy monorepo this resolves to
// packages/noldor/; post-extract it resolves to ~/code/noldor/.
// Either way, tests that read 'docs/roadmap.md' get the consumer's
// docs/, not a sibling path.
const here = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(here, '..'));
```

Wait — this changes behaviour in the current monorepo. Tests today expect to read Charuy root `docs/`. Reading `packages/noldor/docs/` (empty currently) would break. **Decision:** revisit this after Phase B (which populates `packages/noldor/docs/`). For now, the chdir-fix lands as part of Phase B.

- [ ] **Step 3: Skip this task in Phase A**

This task is deferred to Phase B (after `stage-framework-docs.ts` populates `packages/noldor/docs/`). Mark it as deferred and move on.

Update the spec note: Phase A spec § 2 A4 should call out the vitest chdir fix as Phase B work, not Phase A. (Fix the spec doc in a follow-up commit if drift bothers you; otherwise treat it as a planning correction tracked here.)

No commit for this task.

---

## Task 5: Fix dashboard `STATIC_ROOT` (use `import.meta.url`)

**Files:**

- Modify: `packages/noldor/src/dashboard/server.ts:265`
- Test: `packages/noldor/src/dashboard/__tests__/server-static.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/noldor/src/dashboard/__tests__/server-static.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Verify the dashboard static dir is resolvable from the package itself,
// not from process.cwd(). The dist file ships in the package; serving it
// must not depend on which directory pnpm dashboard was launched from.
describe('dashboard STATIC_ROOT', () => {
  it('drag.js exists relative to dashboard module', () => {
    const dashboardSrc = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const dragJs = resolve(dashboardSrc, 'static', 'dist', 'drag.js');
    expect(existsSync(dragJs)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (sanity baseline)**

```bash
pnpm --filter noldor test server-static
```

Expected: PASS (the file already lives at `packages/noldor/src/dashboard/static/dist/drag.js`; the test only confirms the path layout). This test guards the relocation we're about to do — if we later move `static/dist/`, this test catches it.

- [ ] **Step 3: Update `STATIC_ROOT` to use `import.meta.url`**

Edit `packages/noldor/src/dashboard/server.ts` near line 259-265:

Replace:

```ts
/**
 * Root directory for `/static/<file>` responses. Resolved at module load —
 * `process.cwd()` is the repo root when launched via `pnpm dashboard`, so
 * the served files come from the committed build output of `drag.ts` and
 * any future client assets in `scripts/dashboard/static/dist/`.
 */
const STATIC_ROOT = resolvePath('scripts/dashboard/static/dist');
```

With:

```ts
/**
 * Root directory for `/static/<file>` responses. Resolved at module load
 * relative to this file's location, not process.cwd(), so the dashboard
 * serves the assets shipped inside the noldor package regardless of where
 * the dashboard process was launched from.
 */
const STATIC_ROOT = fileURLToPath(new URL('./static/dist', import.meta.url));
```

Ensure `fileURLToPath` is imported at top of file:

```ts
import { fileURLToPath } from 'node:url';
```

(Check existing imports first — add only if not present.)

- [ ] **Step 4: Run dashboard smoke test**

```bash
pnpm dashboard &
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/static/drag.js
kill %1
```

Expected: `200`.

- [ ] **Step 5: Run full vitest**

```bash
pnpm --filter noldor test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/noldor/src/dashboard/server.ts packages/noldor/src/dashboard/__tests__/server-static.test.ts
git commit -m "fix(noldor:dashboard): resolve STATIC_ROOT from package, not cwd

Previously STATIC_ROOT pointed at scripts/dashboard/static/dist
relative to process.cwd(), which no longer exists at Charuy root
(asset moved to packages/noldor/src/dashboard/static/dist during
the noldor lift). Switch to import.meta.url so the path follows
the module — works in monorepo today and post-extract."
```

---

## Task 6: Add `--port` + `--docs` flags to dashboard server command

**Files:**

- Modify: `packages/noldor/src/dashboard/server.ts` (CLI arg parsing + threading)
- Modify: `packages/noldor/src/dashboard/data.ts` (accept docRoots override)
- Test: `packages/noldor/src/dashboard/__tests__/server-cli.test.ts` (new)

- [ ] **Step 1: Inspect current CLI arg parsing**

```bash
grep -n "process.argv\|PORT\|--port\|--docs" packages/noldor/src/dashboard/server.ts
```

Confirm: today `server.ts:675` reads `process.env.PORT ?? 4321` — there is NO `--port` flag yet, no `--docs` flag, and no `process.argv` handling in `main()`. This task introduces BOTH flags. Default port stays `4321` (matches current behaviour); env var `PORT` still honoured as override; explicit `--port <n>` takes precedence.

- [ ] **Step 2: Write the failing test**

Create `packages/noldor/src/dashboard/__tests__/server-cli.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../server.js';

describe('dashboard server CLI parsing', () => {
  it('returns undefined port + undefined docsPath when no flags', () => {
    expect(parseCliArgs([])).toEqual({ port: undefined, docsPath: undefined });
  });

  it('parses --port as number', () => {
    expect(parseCliArgs(['--port', '5174'])).toEqual({ port: 5174, docsPath: undefined });
  });

  it('parses --docs', () => {
    expect(parseCliArgs(['--docs', '/tmp/foo'])).toEqual({ port: undefined, docsPath: '/tmp/foo' });
  });

  it('parses both flags in any order', () => {
    expect(parseCliArgs(['--port', '5174', '--docs', './x'])).toEqual({
      port: 5174,
      docsPath: './x',
    });
    expect(parseCliArgs(['--docs', './x', '--port', '5174'])).toEqual({
      port: 5174,
      docsPath: './x',
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter noldor test server-cli
```

Expected: FAIL with `parseCliArgs is not a function` or missing export.

- [ ] **Step 4: Extract + export `parseCliArgs`**

Add to `packages/noldor/src/dashboard/server.ts` (place near top, after imports, before module-level constants):

```ts
export interface CliArgs {
  /** Undefined when --port absent — caller falls back to env PORT or default 4321. */
  port: number | undefined;
  /** Undefined when --docs absent — caller falls back to process.cwd(). */
  docsPath: string | undefined;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const portIdx = argv.indexOf('--port');
  const docsIdx = argv.indexOf('--docs');
  const port = portIdx >= 0 ? Number(argv[portIdx + 1]) : undefined;
  const docsPath = docsIdx >= 0 ? argv[docsIdx + 1] : undefined;
  return { port, docsPath };
}
```

`parseCliArgs` returns `undefined` for missing flags so callers preserve the precedence chain: explicit flag > env var > default. The existing `startServer({ port })` already handles `port: undefined` via `opts.port ?? Number(process.env.PORT ?? 4321)` — no change needed there.

- [ ] **Step 5: Wire `docsPath` to `data.ts` (plumbing only — Task 12 finishes consumers)**

Add to top of `packages/noldor/src/dashboard/data.ts` (after imports, before existing module-level constants):

```ts
let docRootsOverride: string | undefined;

export function setDocRootsOverride(path: string | undefined): void {
  docRootsOverride = path;
}

export function getDocRoot(): string {
  return docRootsOverride ?? process.cwd();
}
```

Update `packages/noldor/src/dashboard/server.ts` `main()` to parse args + call setter:

```ts
import { setDocRootsOverride } from './data.js';

async function main(): Promise<void> {
  const { port, docsPath } = parseCliArgs(process.argv.slice(2));
  setDocRootsOverride(docsPath);
  const { baseUrl } = await startServer({ port });
  console.log(`dashboard → ${baseUrl}`);
  process.on('SIGINT', () => process.exit(0));
}
```

**Important:** The module-level `ROADMAP_PATH` / `BACKLOG_PATH` constants in `data.ts:64-71` still resolve at import time, **before** `setDocRootsOverride` runs. Between Task 6 and Task 12, `--docs` is parsed but its value is ignored by the actual route handlers. This intermediate state is intentional — Task 12 converts those module-level constants into accessor functions that read `getDocRoot()` at call time. Do not panic if Task 6's commit leaves `--docs` half-wired; that is expected.

- [ ] **Step 6: Run tests**

```bash
pnpm --filter noldor test server-cli
pnpm --filter noldor test
```

Expected: server-cli all 4 PASS; full suite green.

- [ ] **Step 7: Commit**

```bash
git add packages/noldor/src/dashboard/server.ts packages/noldor/src/dashboard/data.ts packages/noldor/src/dashboard/__tests__/server-cli.test.ts
git commit -m "feat(noldor:dashboard): add --docs flag to server command

Allows two dashboards to run from one binary against different
doc roots. Charuy: pnpm dashboard --docs ./docs (5173); noldor
repo post-extract: pnpm noldor dashboard --docs ./docs --port
5174. data.ts gains setDocRootsOverride/getDocRoot; Task 12
finishes threading these through every doc-reading function."
```

---

## Task 7: Parametrise release files (`LOCKSTEP_PACKAGES`, `repoUrl`, tmp path)

**Files:**

- Modify: `packages/noldor/src/release/index.ts:24-32` (`LOCKSTEP_PACKAGES`) + `:269` (tmp path)
- Modify: `packages/noldor/src/release/release-packages.ts:22-30` (duplicate `LOCKSTEP_PACKAGES`)
- Modify: `packages/noldor/src/release/release-dry-run.ts:15` (`repoUrl`)
- Test: extend existing release tests

- [ ] **Step 1: Inspect each constant**

```bash
sed -n '20,35p' packages/noldor/src/release/index.ts
sed -n '18,32p' packages/noldor/src/release/release-packages.ts
sed -n '10,20p' packages/noldor/src/release/release-dry-run.ts
sed -n '265,275p' packages/noldor/src/release/index.ts
```

Note exact current literals so the replacement is faithful.

- [ ] **Step 2: Write a smoke test that proves the constants flow from config**

Create `packages/noldor/src/release/__tests__/release-config-flow.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadConsumerConfig } from '../../core/consumer-config.js';

describe('release reads lockstep + repoUrl from consumer config', () => {
  it('config has 7 lockstep entries matching previous hardcoded list', () => {
    const cfg = loadConsumerConfig();
    expect(cfg.lockstepPackages).toContain('package.json');
    expect(cfg.lockstepPackages).toContain('apps/web/package.json');
    expect(cfg.lockstepPackages).toContain('packages/engine/package.json');
    expect(cfg.lockstepPackages.length).toBe(7);
  });

  it('config has charuy repoUrl', () => {
    const cfg = loadConsumerConfig();
    expect(cfg.repoUrl).toBe('https://github.com/davidzoufaly/charuy');
  });
});
```

- [ ] **Step 3: Run test (should pass — config already populated in Task 3)**

```bash
pnpm --filter noldor test release-config-flow
```

Expected: PASS.

- [ ] **Step 4: Replace constants with config reads**

In `packages/noldor/src/release/index.ts`:

Delete lines 24-32 (`const LOCKSTEP_PACKAGES = [...] as const;`). Replace each consumer reference (search the file: `rg "LOCKSTEP_PACKAGES" packages/noldor/src/release/index.ts`) with a call site that takes the array from config:

```ts
import { loadConsumerConfig } from '../core/consumer-config.js';

// at each call site
const { lockstepPackages } = loadConsumerConfig();
// use lockstepPackages where LOCKSTEP_PACKAGES was used
```

If `LOCKSTEP_PACKAGES` is used many times in the function, load once at the top of the function:

```ts
async function someReleaseFn() {
  const { lockstepPackages } = loadConsumerConfig();
  // ... use lockstepPackages
}
```

At line 269, replace the hardcoded `/tmp/charuy-release-notes-...` with config-driven:

```ts
const { name } = loadConsumerConfig();
const releaseNotesPath = `/tmp/${name}-release-notes-v${newVersion}.md`;
```

In `packages/noldor/src/release/release-packages.ts`:

Delete lines 22-30 (`const LOCKSTEP_PACKAGES = [...]`). Add at top:

```ts
import { loadConsumerConfig } from '../core/consumer-config.js';
```

Replace `LOCKSTEP_PACKAGES` references inside `bumpAllPackages` (and any other exports) with a local read at function entry.

In `packages/noldor/src/release/release-dry-run.ts`:

This file is a **standalone script** with top-level code (not a function). Full transformation — replace the entire body:

```ts
import { loadConsumerConfig } from '../core/consumer-config.js';
import { generateFdChangelogs } from './release-fd-changelog.js';

const previousTag = process.env.PREV_TAG;
const newVersion = process.env.NEW_VERSION;
const date = process.env.DATE;
if (!previousTag || !newVersion || !date) {
  console.error('PREV_TAG, NEW_VERSION, DATE env vars required.');
  process.exitCode = 1;
} else {
  const { repoUrl } = loadConsumerConfig();
  const map = await generateFdChangelogs({
    featuresDir: 'docs/features',
    previousTag,
    newVersion,
    date,
    repoUrl,
  });
  console.log('changelog slugs:', [...map.keys()]);
}
```

The `loadConsumerConfig()` call goes inside the `else` block so script behaviour for the env-var-missing case stays unchanged (no config read attempted before validation passes).

- [ ] **Step 5: Verify no constant survives**

```bash
rg "LOCKSTEP_PACKAGES" packages/noldor/src/release/
rg "davidzoufaly/charuy" packages/noldor/src/release/
rg "charuy-release-notes" packages/noldor/src/release/
```

Expected: zero hits.

- [ ] **Step 6: Run release-related tests + dry-run**

```bash
pnpm --filter noldor test release
pnpm exec tsx packages/noldor/scripts/release-dry-run.ts 2>&1 | head -40
```

Expected: tests green; dry-run output identical to pre-change baseline (capture baseline before edits if unsure).

- [ ] **Step 7: Commit**

```bash
git add packages/noldor/src/release/ packages/noldor/src/release/__tests__/release-config-flow.test.ts
git commit -m "refactor(noldor:release): read LOCKSTEP_PACKAGES, repoUrl, tmp path from consumer config

Removes three Charuy-specific hardcoded constants from release
runtime:
- LOCKSTEP_PACKAGES (duplicated in index.ts + release-packages.ts)
- repoUrl literal in release-dry-run.ts
- /tmp/charuy-release-notes-* path in index.ts:269

All now read via loadConsumerConfig() from .noldor/config.json.
Smoke test guards the config shape so future consumers can't
miss required fields."
```

---

## Task 8: Parametrise invariants + dashboard views

**Files:**

- Modify: `packages/noldor/src/invariants/boundaries.ts:8-40` (`SCAN_PATHS` + `FORBIDDEN_RULES` + default export)
- Modify: `packages/noldor/src/dashboard/views.ts:25`

`.noldor/config.json` already has `scanPaths` + `boundaries` transcribed (Task 3). This task wires the runtime.

- [ ] **Step 1: Read current boundaries shape**

```bash
sed -n '1,50p' packages/noldor/src/invariants/boundaries.ts
```

Confirm: `SCAN_PATHS` is a `readonly string[]` of 4 source dirs; `FORBIDDEN_RULES` is a `readonly` array of 4 rule objects with `{name, severity, from: {path}, to: {path}}` — dependency-cruiser shape. Config in `.noldor/config.json` matches exactly.

- [ ] **Step 2: Update `boundaries.ts` to read from config**

Replace `SCAN_PATHS` and `FORBIDDEN_RULES` declarations with `loadConsumerConfig()` reads. Edit `packages/noldor/src/invariants/boundaries.ts`:

```ts
import { access, realpath } from 'node:fs/promises';
import { join } from 'node:path';

import { cruise } from 'dependency-cruiser';

import { loadConsumerConfig } from '../core/consumer-config.js';
import type { Invariant, InvariantResult, InvariantViolation } from './types.js';

// SCAN_PATHS + FORBIDDEN_RULES removed — sourced from consumer config.

export function makeBoundariesInvariant(repoRoot: string): Invariant {
  return {
    description: 'No forbidden cross-package imports',
    name: 'boundaries',
    async run(): Promise<InvariantResult> {
      const start = Date.now();
      const { scanPaths, boundaries } = loadConsumerConfig(repoRoot);
      const realRoot = await realpath(repoRoot);

      const existingRelPaths: string[] = [];
      for (const relPath of scanPaths) {
        try {
          await access(join(realRoot, relPath));
          existingRelPaths.push(relPath);
        } catch {
          // path absent — skip silently
        }
      }

      if (existingRelPaths.length === 0) {
        return { invariant: 'boundaries', violations: [], durationMs: Date.now() - start };
      }

      const result = await cruise(existingRelPaths, {
        baseDir: realRoot,
        validate: true,
        ruleSet: { forbidden: [...boundaries] },
        doNotFollow: { path: 'node_modules' },
        exclude: { path: '__tests__|\\.test\\.ts$' },
        tsPreCompilationDeps: true,
      });

      // ... existing violation-extraction loop unchanged
      const violations: InvariantViolation[] = [];
      const output = result.output;

      if (typeof output === 'object' && output !== null && 'modules' in output) {
        type CruiseModule = {
          source: string;
          dependencies: ReadonlyArray<{
            resolved: string;
            rules?: ReadonlyArray<{ name: string; severity: string }>;
          }>;
        };
        const modules = (output as { modules: ReadonlyArray<CruiseModule> }).modules;
        for (const mod of modules) {
          for (const dep of mod.dependencies) {
            for (const rule of dep.rules ?? []) {
              if (rule.severity === 'error' || rule.severity === 'warn') {
                violations.push({
                  file: mod.source,
                  message: `forbidden import (${rule.name}): ${mod.source} -> ${dep.resolved}`,
                });
              }
            }
          }
        }
      }

      return { invariant: 'boundaries', violations, durationMs: Date.now() - start };
    },
  };
}

export const boundaries: Invariant = makeBoundariesInvariant(process.cwd());
```

- [ ] **Step 3: Update `dashboard/views.ts:25` default**

Place the import at the top of `views.ts` with the other imports (not inline below the existing imports). Change line 25:

```ts
// Before
const GITHUB_REPO = process.env.GITHUB_REPO ?? 'davidzoufaly/charuy';

// After (imports added at file top alongside existing imports)
import { loadConsumerConfig } from '../core/consumer-config.js';

function deriveRepoSlug(repoUrl: string): string {
  // 'https://github.com/owner/repo' -> 'owner/repo'
  const m = repoUrl.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  return m?.[1] ?? 'unknown/unknown';
}

const GITHUB_REPO = process.env.GITHUB_REPO ?? deriveRepoSlug(loadConsumerConfig().repoUrl);
```

The `deriveRepoSlug` function definition can go below the imports + above the `const GITHUB_REPO`. `loadConsumerConfig()` runs once at module load — fine because dashboard reloads on restart.

- [ ] **Step 4: Run invariants check**

```bash
pnpm noldor invariants run
```

Expected: `4 invariants passed (boundaries, rule-conflicts, keyboard-binding, public-api-tsdoc)` (matches pre-change baseline). If boundaries throws zod parse error, the config doesn't match the schema — re-check Task 3's transcription.

- [ ] **Step 5: Run dashboard smoke**

```bash
pnpm dashboard &
sleep 2
curl -s http://localhost:4321/ | grep -o "davidzoufaly/charuy" | head -1
kill %1
```

Expected: returns `davidzoufaly/charuy` (now derived from config, not hardcoded). Port `4321` matches the existing default (see Task 6).

- [ ] **Step 6: Commit**

```bash
git add packages/noldor/src/invariants/boundaries.ts packages/noldor/src/dashboard/views.ts
git commit -m "refactor(noldor:invariants,dashboard): read scanPaths/boundaries/repoUrl from consumer config

boundaries.ts SCAN_PATHS + FORBIDDEN_RULES now read from
.noldor/config.json (consumer.scanPaths + consumer.boundaries),
preserving the dependency-cruiser rule shape. dashboard/views.ts
GITHUB_REPO derives the owner/repo slug from consumer.repoUrl
when env var unset. No Charuy paths hardcoded in framework
runtime."
```

---

## Task 9: Parametrise garden — sdd-report `E2E_PREFIX` + `@charuy/` matcher + deprecated package exclusion

**Files:**

- Modify: `packages/noldor/src/garden/sdd-report.ts:473,490,557,567`

- [ ] **Step 1: Inspect current usage**

```bash
sed -n '470,500p' packages/noldor/src/garden/sdd-report.ts
sed -n '550,575p' packages/noldor/src/garden/sdd-report.ts
```

Confirm:

- `E2E_PREFIX = 'apps/web/e2e/'` declared near line 473, used near line 490.
- Line 557: `const tableRe = /\|\s*\`(@charuy\/[a-z0-9-]+)\`\s\*\|/gi;`—`@charuy/` literal embedded in regex.
- Line 567: `.filter((p) => !actual.has(p) && p !== '@charuy/agent-api')` — deprecated-package exclusion.

- [ ] **Step 2: Replace `E2E_PREFIX` constant with config read**

Remove the const declaration. At the use site (line 490 region), read from config:

```ts
import { loadConsumerConfig } from '../core/consumer-config.js';

// inside the function that uses the prefix
const { e2ePrefix } = loadConsumerConfig();
// use e2ePrefix in the .startsWith(e2ePrefix) or .replace(e2ePrefix, '') call
```

- [ ] **Step 3: Replace `@charuy/` in tableRe + dynamic deprecated-package exclusion**

In `detectReadmePackageDrift` (around line 556-568), rewrite the regex + filter to be config-driven:

```ts
export function detectReadmePackageDrift(actualPackages: string[], readmeContent: string): Gap[] {
  const { packagePrefix, deprecatedPackages } = loadConsumerConfig();
  const escapedPrefix = packagePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tableRe = new RegExp(`\\|\\s*\`(${escapedPrefix}[a-z0-9-]+)\`\\s*\\|`, 'gi');

  const listed = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(readmeContent)) !== null) {
    listed.add(m[1]);
  }

  const actual = new Set(actualPackages);
  const deprecated = new Set(deprecatedPackages);
  const missingFromReadme = [...actual].filter((p) => !listed.has(p)).toSorted();
  const staleInReadme = [...listed].filter((p) => !actual.has(p) && !deprecated.has(p)).toSorted();

  // ... rest of function unchanged
}
```

Also update the JSDoc comment on line 552 referencing `@charuy/<name>` to use a more generic phrasing or omit the prefix (since it's now config-driven):

```ts
/**
 * @param actualPackages - List of consumer-prefixed package names found on disk
 * @param readmeContent - Raw README.md body to scan
 */
```

- [ ] **Step 4: Run garden tests**

```bash
pnpm --filter noldor test sdd-report
```

Expected: all green.

- [ ] **Step 5: Run full sdd-report smoke**

```bash
pnpm noldor garden detect
```

Expected: output matches pre-change baseline (no new false positives/negatives).

- [ ] **Step 6: Commit**

```bash
git add packages/noldor/src/garden/sdd-report.ts
git commit -m "refactor(noldor:garden): sdd-report reads e2ePrefix + packagePrefix from config

Removes E2E_PREFIX const and the @charuy/ literal from
sdd-report.ts. Both now flow from consumer config so the
report renders correctly for any consumer (post-extract: a
hypothetical second consumer with its own package prefix and
e2e layout)."
```

---

## Task 10: Parametrise garden — `garden-detect` pnpm stderr prefix + `graph-fd-lookup` samples whitelist

**Files:**

- Modify: `packages/noldor/src/garden/garden-detect.ts:588`
- Modify: `packages/noldor/src/garden/graph-fd-lookup.ts:140-143`

- [ ] **Step 1: Inspect**

```bash
sed -n '585,595p' packages/noldor/src/garden/garden-detect.ts
sed -n '138,148p' packages/noldor/src/garden/graph-fd-lookup.ts
```

- [ ] **Step 2: Replace pnpm stderr prefix**

In `garden-detect.ts:588`, replace the literal `'> charuy@'` with:

```ts
const { pnpmStderrPrefix } = loadConsumerConfig();
const stripPrefix = `> ${pnpmStderrPrefix}`;
// use stripPrefix in stderr split/strip
```

Add `import { loadConsumerConfig } from '../core/consumer-config.js';` at top if not present.

- [ ] **Step 3: Replace samples whitelist**

In `graph-fd-lookup.ts:140-143`, replace the literal `'apps/web/public/samples'` with:

```ts
const { samplesPath } = loadConsumerConfig();
// use samplesPath in the whitelist comparison
```

- [ ] **Step 4: Run garden tests**

```bash
pnpm --filter noldor test garden
```

Expected: green.

- [ ] **Step 5: Run garden detect smoke**

```bash
pnpm noldor garden detect
```

Expected: same output as Task 9 baseline.

- [ ] **Step 6: Commit**

```bash
git add packages/noldor/src/garden/garden-detect.ts packages/noldor/src/garden/graph-fd-lookup.ts
git commit -m "refactor(noldor:garden): garden-detect + graph-fd-lookup read paths from config

garden-detect uses pnpmStderrPrefix for stripping the consumer
package prefix from pnpm stderr; graph-fd-lookup uses
samplesPath for the samples whitelist. Both replace charuy-
specific literals."
```

---

## Task 11: Parametrise features — `fill-links-code-gaps` + `validate-features`

**Files:**

- Modify: `packages/noldor/src/features/fill-links-code-gaps.ts:59`
- Modify: `packages/noldor/src/features/validate-features.ts:120-122`

- [ ] **Step 1: Inspect**

```bash
sed -n '55,65p' packages/noldor/src/features/fill-links-code-gaps.ts
sed -n '115,130p' packages/noldor/src/features/validate-features.ts
```

- [ ] **Step 2: Replace `apps/web/` startsWith in `fill-links-code-gaps.ts:59`**

`appPathPrefix` is already in the schema (Task 1) and config (Task 3). Replace the literal:

```ts
import { loadConsumerConfig } from '../core/consumer-config.js';

const { appPathPrefix } = loadConsumerConfig();
if (filePath.startsWith(appPathPrefix)) { ... }
```

- [ ] **Step 3: Replace `@charuy/` + `apps/` strip rules in `validate-features.ts:120-122`**

Replace literals with:

```ts
const { packagePrefix, appPathPrefix } = loadConsumerConfig();
// use packagePrefix and appPathPrefix in the strip logic
```

- [ ] **Step 4: Run features tests**

```bash
pnpm --filter noldor test features
```

Expected: green.

- [ ] **Step 5: Verify validate-features integration**

```bash
pnpm noldor validate features 2>&1 | tail -5
```

Expected: `Validated 65 feature MD(s) — all OK.` (or current count).

- [ ] **Step 6: Commit**

```bash
git add packages/noldor/src/features/ packages/noldor/src/core/consumer-config.ts .noldor/config.json
git commit -m "refactor(noldor:features): fill-links + validate read appPathPrefix + packagePrefix from config

Adds appPathPrefix to consumer config schema ('apps/web/' for
Charuy). fill-links-code-gaps and validate-features use it in
place of hardcoded 'apps/web/' / '@charuy/' literals."
```

---

## Task 12: Thread `loadDocRoots` through 5 doc-reading consumers (globs deferred to Phase B)

**Files (Phase A scope):**

- Modify: `packages/noldor/src/dashboard/data.ts:64-71,744` — convert module constants → accessor functions
- Modify: `packages/noldor/src/garden/garden-detect.ts:65,92,113,198,219,267,291` — `'docs/...'` literals in `join(repo, ...)` calls
- Modify: `packages/noldor/src/core/next-priority.ts:172,197,204,224` — `'docs/...'` literals + relative `readFile('docs/roadmap.md')` bug fix
- Modify: `packages/noldor/src/garden/plan-resolution.ts:40` — single `join(opts.repo, 'docs/features')` call
- Modify: `packages/noldor/src/garden/sdd-report.ts:1082-1104` — relative-string `readFile`/`loadSddFeatures` calls (implicit cwd)

**Files DEFERRED to Phase B:**

- `packages/noldor/src/core/allowlist.ts:4-24` — `'docs/**/*.md'` style **minimatch globs**, not file paths. Cannot thread through `loadDocRoots()` without restructuring the glob model (needs `globRoots` config field + glob-rewrite logic).
- `packages/noldor/src/core/rename-plan-only-tier.ts:47-62` — same glob pattern.

Defer rationale: Phase A goal is removing hardcoded `process.cwd()/docs/` constructions. Globs are a separate concern — they're working assumptions about repo layout, not path constructions. Migrating them needs a `globRoots` config + a glob-rewrite helper, which is its own design surface. Sketch a follow-up issue in Phase B planning.

The remaining work in Task 12 lands as a single commit since changes are coordinated (`getDocRoot()` accessor wiring in `data.ts` depends on the other modules consistently honouring `loadDocRoots()`).

- [ ] **Step 1: Audit every site to update**

```bash
# Module-level process.cwd() docs/ constructions (data.ts)
rg "process\.cwd\(\), ['\"]docs" packages/noldor/src/

# 'docs/...' literals in join(repo|cwd|opts.repo, ...) calls
rg "join\([^)]+, ['\"]docs/" packages/noldor/src/

# Bare relative 'docs/...' strings passed to readFile / async fns
rg "['\"]docs/" packages/noldor/src/garden/sdd-report.ts packages/noldor/src/core/next-priority.ts
```

Cross-check the cited line ranges. If new sites appear, add them to the task.

- [ ] **Step 2: `dashboard/data.ts` — convert module constants to accessor functions**

Edit `packages/noldor/src/dashboard/data.ts` lines 64-71. Replace:

```ts
export const ROADMAP_PATH = join(process.cwd(), 'docs', 'roadmap.md');
export const BACKLOG_PATH = join(process.cwd(), 'docs', 'backlog.md');
const VISION_PATH = join(process.cwd(), 'docs', 'vision.md');
const RELEASE_NOTES_PATH = join(process.cwd(), 'docs', 'release-notes.md');
const FEATURES_DIR = join(process.cwd(), 'docs', 'features');
const SKILLS_DIR = join(process.cwd(), '.claude', 'skills');
const SCRIPTS_DIR = join(process.cwd(), 'scripts');
const NOLDOR_DIR = join(process.cwd(), 'docs', 'noldor');
```

With accessor functions that read `getDocRoot()` at call time:

```ts
import { loadDocRoots } from '../core/doc-roots.js';

export function getRoadmapPath(): string {
  return loadDocRoots(getDocRoot()).roadmap;
}
export function getBacklogPath(): string {
  return loadDocRoots(getDocRoot()).backlog;
}
export function getVisionPath(): string {
  return loadDocRoots(getDocRoot()).vision;
}
export function getReleaseNotesPath(): string {
  // not in DocRoots; build manually
  return join(getDocRoot(), 'docs', 'release-notes.md');
}
export function getFeaturesDir(): string {
  return loadDocRoots(getDocRoot()).features;
}
export function getSkillsDir(): string {
  // not under docs/; keep cwd-relative but use override-aware root
  return join(getDocRoot(), '.claude', 'skills');
}
export function getScriptsDir(): string {
  return join(getDocRoot(), 'scripts');
}
export function getNoldorDir(): string {
  return join(getDocRoot(), 'docs', 'noldor');
}
```

For line 744 (`const base = join(process.cwd(), 'docs', 'user');`), replace with:

```ts
const base = join(getDocRoot(), 'docs', 'user');
```

Update every consumer of the old exports within the package. Use:

```bash
rg "ROADMAP_PATH|BACKLOG_PATH|VISION_PATH|RELEASE_NOTES_PATH|FEATURES_DIR|SKILLS_DIR|SCRIPTS_DIR|NOLDOR_DIR" packages/noldor/src/
```

Each call site changes from `ROADMAP_PATH` → `getRoadmapPath()`, etc. Apply mechanically.

- [ ] **Step 3: `garden/garden-detect.ts` — replace `'docs/...'` literals**

Each `join(repo, 'docs/...')` becomes `loadDocRoots(repo).<field>` (or `join(loadDocRoots(repo).<dir>, ...)` when the literal includes a sub-path). Examples:

```ts
// Before (line 65)
const path = join(repo, 'docs/features', `${slug}.md`);
// After
const path = join(loadDocRoots(repo).features, `${slug}.md`);

// Before (line 92)
const plansDir = join(repo, 'docs/superpowers/plans');
// After
const plansDir = loadDocRoots(repo).plans;

// Before (line 198)
const specsDir = join(repo, 'docs/superpowers/specs');
// After
const specsDir = loadDocRoots(repo).specs;

// Before (line 267)
const entries = await readdir(join(repo, 'docs/features'));
// After
const entries = await readdir(loadDocRoots(repo).features);

// Before (line 291)
const backlogPath = join(repo, 'docs/backlog.md');
// After
const backlogPath = loadDocRoots(repo).backlog;
```

Lines 113 + 219 use `join('docs/superpowers/plans', entry)` / `join('docs/superpowers/specs', entry)` as **relative paths** for output rendering (relative to repo root, not absolute). These are stylistic strings, not filesystem paths — leave them alone, but add a comment noting they're presentation-layer relative paths. (If unsure, run the file's tests both ways.)

Lines 406-411 are documentation pointers in a const data structure (gap detection metadata pointing at framework docs like `docs/noldor/feature-md-schema.md`). These are **framework-internal references**, not consumer-doc references — leave them as-is for Phase A. Phase B will revisit when framework docs migrate.

Add `import { loadDocRoots } from '../core/doc-roots.js';` at top.

- [ ] **Step 4: `core/next-priority.ts` — replace literals + fix relative readFile bug**

```ts
// Before (line 172)
const dir = join(cwd, 'docs/features');
// After
const dir = loadDocRoots(cwd).features;

// Before (line 197)
const visionPath = join(cwd, 'docs/vision.md');
// After
const visionPath = loadDocRoots(cwd).vision;

// Before (line 204)
const milestonePath = join(cwd, 'docs/milestones', `${slug}.md`);
// After
const milestonePath = join(loadDocRoots(cwd).milestones, `${slug}.md`);

// Before (line 224) — implicit cwd dependency, fragile
const roadmapRaw = await readFile('docs/roadmap.md', 'utf8').catch(() => '');
// After — explicit cwd
const roadmapRaw = await readFile(loadDocRoots(cwd).roadmap, 'utf8').catch(() => '');
```

The line 224 change is a latent bug fix — `readFile('docs/roadmap.md')` succeeded only because the caller's cwd happened to match. Now it honours the function's `cwd` parameter consistently.

If the function on line 224 doesn't currently take a `cwd` param, plumb one through (default `process.cwd()`). Check the surrounding function signature.

- [ ] **Step 5: `garden/plan-resolution.ts:40` — single replacement**

```ts
// Before
const featuresDir = join(opts.repo, 'docs/features');
// After
const featuresDir = loadDocRoots(opts.repo).features;
```

Add the import. Done.

- [ ] **Step 6: `garden/sdd-report.ts` 1082-1104 — relative-string readers**

These calls use bare strings like `'docs/features'`, `'docs/backlog.md'` passed to async helpers (`loadSddFeatures`, `readFile`, `listSpecs`, `listPlans`). They depend on the caller's `process.cwd()` matching the consumer repo root.

Replace each:

```ts
// Before (line 1086)
const features = await loadSddFeatures('docs/features');
// After
const features = await loadSddFeatures(loadDocRoots().features);

// Before (line 1088)
const backlogRaw = await readFile('docs/backlog.md', 'utf8').catch(() => '');
// After
const backlogRaw = await readFile(loadDocRoots().backlog, 'utf8').catch(() => '');

// Before (line 1090-1091)
const specPaths = await listSpecs('docs/superpowers/specs');
const planPaths = await listPlans('docs/superpowers/plans');
// After
const specPaths = await listSpecs(loadDocRoots().specs);
const planPaths = await listPlans(loadDocRoots().plans);
```

For line 1082 (`return 'docs/sdd-report.md';`) — this is a **display string**, not a path lookup. Leave it.

For line 1104 (`for (const sub of ['docs/user/tutorials', 'docs/user/explanation'])`) — these `docs/user/*` paths are consumer-product-specific (tutorials/explanation directories) and don't fit `DocRoots`. Leave as-is for Phase A; revisit in Phase B if user docs migrate.

- [ ] **Step 7: Verify no in-scope `'docs/...'` literals survive**

```bash
# Module-level process.cwd() constructions
rg "process\.cwd\(\), ['\"]docs" packages/noldor/src/
```

Expected: zero hits (line 744 in `data.ts` should be gone via Step 2).

```bash
# 'docs/...' literals in join() calls in Phase A scope files
rg "join\([^)]+, ['\"]docs/" packages/noldor/src/garden/garden-detect.ts packages/noldor/src/core/next-priority.ts packages/noldor/src/garden/plan-resolution.ts
```

Expected: zero hits.

Out-of-scope literals that will still match (deferred to Phase B): allowlist.ts globs, rename-plan-only-tier.ts globs, garden-detect.ts:406-411 framework doc pointers, sdd-report.ts:1082 display string, sdd-report.ts:1104 user docs paths.

- [ ] **Step 8: Run full vitest**

```bash
pnpm --filter noldor test
```

Expected: all green.

- [ ] **Step 9: Run full verify**

```bash
pnpm verify
```

Expected: lint, fmt, typecheck, test, build:samples, doctor all green.

- [ ] **Step 10: Smoke both dashboards**

```bash
pnpm dashboard &
sleep 2
curl -s http://localhost:4321/ | grep -c "roadmap" # any non-zero count = OK
kill %1
```

Expected: dashboard responds, lists Charuy docs.

Then verify `--docs` actually overrides (no longer silently ignored):

```bash
mkdir -p /tmp/noldor-test-docs/{features,superpowers/plans,superpowers/specs,milestones,noldor}
touch /tmp/noldor-test-docs/{roadmap.md,backlog.md,vision.md,ideas.md,release-notes.md}
pnpm noldor dashboard server --port 5174 --docs /tmp/noldor-test-docs &
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5174/
kill %1
rm -rf /tmp/noldor-test-docs
```

Expected: `200`. Dashboard at 5174 reads `/tmp/noldor-test-docs/` not Charuy `docs/`.

- [ ] **Step 11: Commit**

```bash
git add packages/noldor/src/
git commit -m "refactor(noldor): thread loadDocRoots through 5 doc-reading modules

dashboard/data.ts, garden/garden-detect.ts, garden/sdd-report.ts,
core/next-priority.ts, garden/plan-resolution.ts now read doc
paths via loadDocRoots() instead of hardcoded 'docs/...' literals
or join(process.cwd(), 'docs', ...) constructions.

dashboard/data.ts module-level constants (ROADMAP_PATH etc.)
converted to accessor functions so the --docs override from
Task 6 is honoured at call time.

next-priority.ts:224 bare readFile('docs/roadmap.md') replaced
with loadDocRoots(cwd).roadmap — latent bug fix where cwd
parameter was previously ignored.

Glob-based consumers (allowlist.ts, rename-plan-only-tier.ts)
deferred to Phase B; they need a separate globRoots config
field."
```

---

## Task 13: Final verify gate

**Files:** none (read-only verification)

- [ ] **Step 1: Audit no Charuy literals survive (with scoped exceptions)**

```bash
rg "charuy" packages/noldor/src/ --type ts
```

Expected hits (all OK):

- Test fixtures in `__tests__/consumer-config.test.ts` (use `'charuy'` as test data)
- Schema docstring examples / JSDoc in `consumer-config.ts`
- Anything else under `__tests__/` directories (test data)

Zero hits outside those locations.

```bash
rg "LOCKSTEP_PACKAGES" packages/noldor/src/
```

Expected: zero hits.

```bash
rg "apps/web" packages/noldor/src/ --type ts | grep -v __tests__ | grep -v "// "
```

Expected: zero hits (outside tests and comments). If `garden-detect.ts:406-411` framework-doc pointers still match, that's Phase B deferred — note but don't block.

```bash
rg "@charuy/" packages/noldor/src/ --type ts | grep -v __tests__
```

Expected: at most ONE hit in `sdd-report.ts:552` JSDoc (now generic phrasing per Task 9 Step 3). If more survive, re-check Task 9.

- [ ] **Step 2: Run full `pnpm verify`**

```bash
pnpm verify
```

Expected: lint, fmt, typecheck, test, build:samples, doctor — all green.

- [ ] **Step 3: Run both dashboards (proves `--docs` + `--port` work)**

```bash
pnpm dashboard &
DASHBOARD_PID=$!
sleep 2
curl -s -o /dev/null -w "4321=%{http_code}\n" http://localhost:4321/

# Simulate a framework-only dashboard by pointing --docs at a scratch dir
mkdir -p /tmp/noldor-test-docs/{features,superpowers/plans,superpowers/specs,milestones,noldor}
touch /tmp/noldor-test-docs/{roadmap.md,backlog.md,vision.md,ideas.md,release-notes.md}
pnpm noldor dashboard server --port 5174 --docs /tmp/noldor-test-docs &
SECOND_PID=$!
sleep 2
curl -s -o /dev/null -w "5174=%{http_code}\n" http://localhost:5174/

kill $DASHBOARD_PID $SECOND_PID
rm -rf /tmp/noldor-test-docs
```

Expected:

```
4321=200
5174=200
```

Both dashboards respond. The second one runs against `/tmp/noldor-test-docs/` — proves `--docs` override works post-Task 12 (no longer half-wired).

- [ ] **Step 4: Run release dry-run (proves repoUrl flows from config)**

```bash
PREV_TAG=v0.5.0 NEW_VERSION=0.6.0 DATE=2026-05-29 \
  pnpm exec tsx packages/noldor/src/release/release-dry-run.ts 2>&1 | head -5
```

Expected: prints `changelog slugs: [...]` (or empty array if no FDs match). No error about missing `repoUrl`. Exact output doesn't matter — what matters is the script runs without throwing and the `repoUrl` it uses comes from `.noldor/config.json` (per Task 7).

- [ ] **Step 5: Update memory**

After verifying clean state, append to `/Users/davidzoufaly/.claude/projects/-Users-davidzoufaly-code-3d/memory/project_framework_doc_extraction.md`:

```markdown
**Phase A SHIPPED <date>:** De-Charuy-fication complete. consumer-config.ts + doc-roots.ts utilities;
.noldor/config.json consumer: block populated; all 12 hardcoded Charuy literals removed from
framework runtime; loadDocRoots threaded through 7 consumers; vitest chdir fix deferred to
Phase B; dashboard STATIC_ROOT fixed; --docs flag added.
```

- [ ] **Step 6: No additional commit — Phase A done**

The verify gate is read-only. Phase A ends with all prior commits already on the branch.

---

## Out-of-scope reminders

- **vitest.setup.ts chdir fix** moved to Phase B (depends on `packages/noldor/docs/` being populated).
- **Phase B** (doc staging via `stage-framework-docs.ts`) has its own plan, written after Phase A merges.
- **Phase C** (filter-repo extract + Charuy retarget) has its own plan, written after Phase B merges.
- **CHANGELOG.md / release-notes.md split** decided in spec § 3 B1 — each repo starts fresh; not Phase A.
- **Inventory reconcile** (29 FDs not 28) is Phase B work.

## Linked artifacts

- Spec: `docs/superpowers/specs/2026-05-28-framework-doc-extraction-repo-extraction-rev2-design.md`
- Parent FD: `docs/features/framework-doc-extraction.md`
- Memory: `[[project-framework-doc-extraction]]`
