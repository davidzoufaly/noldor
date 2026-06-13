# Version-Aware Upgrade and Migration Chain Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Ship `noldor upgrade` — a version-aware migration chain that walks a consumer repo from its anchored framework version to the installed one through ordered, reviewable codemods, plus the version anchor, doctor skew check, and a migration-coverage garden detector.

**Architecture:** Pure engine (contract + semver + chain resolve/run/render) under `src/migrations/`, wired by a static registry; a leaf CLI command; a consumer-config anchor field with tolerant loaders; init/doctor integration; one garden detector. Engine functions take an injected migration array — production code passes `MIGRATIONS`, tests pass synthetics.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Zod (existing `ConsumerConfigSchema`), gray-matter (frontmatter rewrites in real migrations), Vitest, `node:child_process` for git, the existing `noldor` CLI manifest router.

---

## File Structure

- `src/migrations/types.ts` — `Migration` + `MigrationStep` contract — Create
- `src/migrations/semver.ts` — `parseSemver` / `compareSemver` — Create
- `src/migrations/chain.ts` — `resolveChain` / `runChain` / `renderSteps` — Create
- `src/migrations/pkg-version.ts` — `installedFrameworkVersion()` — Create
- `src/migrations/registry.ts` — `MIGRATIONS` production array — Create
- `src/migrations/0.4.0.ts` — seed anchor migration — Create
- `src/core/consumer-config.ts` — `frameworkVersion` field + load/write helpers — Modify
- `src/cli/commands/upgrade.ts` — `noldor upgrade` entrypoint — Create
- `src/cli/manifest.ts` — register `upgrade` leaf group — Modify
- `src/cli/commands/init.ts` — write anchor after scaffold — Modify
- `src/cli/commands/doctor.ts` — skew warn — Modify
- `src/garden/detectors/migration-coverage.ts` — schema-vs-migration detector — Create
- `src/garden/garden-detect.ts` — wire the detector — Modify
- `src/migrations/__tests__/semver.test.ts` — semver unit tests — Create
- `src/migrations/__tests__/chain.test.ts` — engine + fixture snapshot tests — Create
- `src/migrations/__tests__/pkg-version.test.ts` — installed-version test — Create
- `src/migrations/__tests__/fixtures/0.2.0/` — fixture consumer tree — Create
- `src/core/__tests__/framework-version.test.ts` — load/write anchor tests — Create
- `src/cli/commands/__tests__/upgrade.test.ts` — command flow tests — Create
- `src/garden/detectors/__tests__/migration-coverage.test.ts` — detector tests — Create
- `docs/noldor/versioning.md` — anchor + upgrade + downgrade-unsupported — Modify
- `docs/noldor/adoption-guide.md` — upgrade step in the adoption path — Modify

---

## Task 1: Semver helpers

**Files:**
- Create: `src/migrations/semver.ts`
- Test: `src/migrations/__tests__/semver.test.ts`

- [ ] **Step 1: Write failing test for `parseSemver` / `compareSemver`**

```ts
// src/migrations/__tests__/semver.test.ts
import { describe, it, expect } from 'vitest';
import { parseSemver, compareSemver } from '../semver.js';

describe('parseSemver', () => {
  it('parses x.y.z', () => {
    expect(parseSemver('1.2.3')).toEqual([1, 2, 3]);
  });
  it('ignores prerelease suffix', () => {
    expect(parseSemver('0.4.0-rc.1')).toEqual([0, 4, 0]);
  });
  it('throws on non-semver', () => {
    expect(() => parseSemver('nope')).toThrow(/not a semver/);
  });
});

describe('compareSemver', () => {
  it('orders by major, minor, patch', () => {
    expect(compareSemver('0.3.0', '0.4.0')).toBe(-1);
    expect(compareSemver('0.4.0', '0.3.0')).toBe(1);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('0.10.0', '0.9.0')).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test, verify FAIL**

```bash
pnpm vitest run src/migrations/__tests__/semver.test.ts
```

Expected: fails — `Cannot find module '../semver.js'`.

- [ ] **Step 3: Implement `src/migrations/semver.ts`**

```ts
/** Parse a semver string into [major, minor, patch]; prerelease/build ignored. */
export function parseSemver(v: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) throw new Error(`not a semver: ${JSON.stringify(v)}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** -1 if a<b, 0 if equal, 1 if a>b (numeric major/minor/patch compare). */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}
```

- [ ] **Step 4: Run the test, verify PASS**

```bash
pnpm vitest run src/migrations/__tests__/semver.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/migrations/semver.ts src/migrations/__tests__/semver.test.ts
git commit -m "feat(migrations): add semver parse + compare helpers" -m "Noldor-FD: version-aware-upgrade-and-migration-chain"
```

---

## Task 2: Migration contract + chain engine

**Files:**
- Create: `src/migrations/types.ts`, `src/migrations/chain.ts`
- Test: `src/migrations/__tests__/chain.test.ts`, `src/migrations/__tests__/fixtures/0.2.0/`

- [ ] **Step 1: Create the fixture consumer tree**

```bash
mkdir -p src/migrations/__tests__/fixtures/0.2.0/.noldor
printf '%s\n' '{ "consumer": { "frameworkVersion": "0.2.0" } }' \
  > src/migrations/__tests__/fixtures/0.2.0/.noldor/config.json
printf '%s\n' 'oldKey: value' > src/migrations/__tests__/fixtures/0.2.0/sample.txt
```

Expected: two fixture files created.

- [ ] **Step 2: Write failing test for the contract + engine**

```ts
// src/migrations/__tests__/chain.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { Migration } from '../types.js';
import { resolveChain, runChain, renderSteps } from '../chain.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, 'fixtures', '0.2.0');
const cfg = { frameworkVersion: '0.2.0' } as never;

// Synthetic migrations exercise the engine without faking production ones.
const m030: Migration = {
  from: '0.2.0',
  to: '0.3.0',
  description: 'rewrite sample.txt key',
  dryRun(cwd) {
    const path = 'sample.txt';
    const before = readFileSync(join(cwd, path), 'utf8');
    return [{ path, before, after: before.replace('oldKey', 'newKey') }];
  },
  migrate(cwd) {
    const steps = this.dryRun(cwd, cfg);
    for (const s of steps) writeFileSyncStep(cwd, s);
    return steps;
  },
};
const m040: Migration = {
  from: '0.3.0',
  to: '0.4.0',
  description: 'append marker',
  dryRun(cwd) {
    const path = 'sample.txt';
    const before = readFileSync(join(cwd, path), 'utf8');
    return [{ path, before, after: `${before}migrated: true\n` }];
  },
  migrate(cwd) {
    const steps = this.dryRun(cwd, cfg);
    for (const s of steps) writeFileSyncStep(cwd, s);
    return steps;
  },
};

function writeFileSyncStep(cwd: string, s: { path: string; after: string }): void {
  // local import to keep top imports lean
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { writeFileSync } = require('node:fs');
  writeFileSync(join(cwd, s.path), s.after);
}

const ALL = [m040, m030]; // deliberately unsorted

describe('resolveChain', () => {
  it('selects + orders the contiguous slice', () => {
    expect(resolveChain(ALL, '0.2.0', '0.4.0').map((m) => m.to)).toEqual(['0.3.0', '0.4.0']);
  });
  it('is empty when already current', () => {
    expect(resolveChain(ALL, '0.4.0', '0.4.0')).toEqual([]);
  });
  it('throws on downgrade', () => {
    expect(() => resolveChain(ALL, '0.4.0', '0.2.0')).toThrow(/downgrade/);
  });
  it('throws on a chain gap', () => {
    expect(() => resolveChain([m040], '0.2.0', '0.4.0')).toThrow(/gap/);
  });
});

describe('runChain', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'noldor-mig-'));
    cpSync(FIXTURE, dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('dry-run reports steps without touching disk', () => {
    const before = readFileSync(join(dir, 'sample.txt'), 'utf8');
    const chain = resolveChain(ALL, '0.2.0', '0.4.0');
    const res = runChain(chain, dir, cfg, { dryRun: true });
    expect(res.flatMap((r) => r.steps)).toHaveLength(2);
    expect(readFileSync(join(dir, 'sample.txt'), 'utf8')).toBe(before);
  });

  it('apply lands every step (snapshot)', () => {
    const chain = resolveChain(ALL, '0.2.0', '0.4.0');
    runChain(chain, dir, cfg, { dryRun: false });
    expect(readFileSync(join(dir, 'sample.txt'), 'utf8')).toBe('newKey: value\nmigrated: true\n');
  });
});

describe('renderSteps', () => {
  it('shows path + changed lines', () => {
    const out = renderSteps([{ path: 'a.txt', before: 'x\n', after: 'y\n' }]);
    expect(out).toContain('a.txt');
    expect(out).toContain('-x');
    expect(out).toContain('+y');
  });
});
```

- [ ] **Step 3: Run the test, verify FAIL**

```bash
pnpm vitest run src/migrations/__tests__/chain.test.ts
```

Expected: fails — `Cannot find module '../types.js'` / `'../chain.js'`.

- [ ] **Step 4: Implement `src/migrations/types.ts`**

```ts
import type { ConsumerConfig } from '../core/consumer-config.js';

/** One file a migration would change. `before === ''` means the file is created. */
export interface MigrationStep {
  readonly path: string; // consumer-relative
  readonly before: string;
  readonly after: string;
}

/** A single version-to-version codemod over the consumer tree. */
export interface Migration {
  /** Anchor version this applies FROM (exclusive lower bound of the chain step). */
  readonly from: string;
  /** Anchor version this brings the consumer TO. */
  readonly to: string;
  readonly description: string;
  /** Compute steps without writing to disk. */
  dryRun(cwd: string, config: ConsumerConfig): MigrationStep[];
  /** Apply steps to disk; returns the steps applied. */
  migrate(cwd: string, config: ConsumerConfig): MigrationStep[];
}

export interface ChainResult {
  readonly migration: Migration;
  readonly steps: MigrationStep[];
}
```

- [ ] **Step 5: Implement `src/migrations/chain.ts`**

```ts
import type { ConsumerConfig } from '../core/consumer-config.js';
import type { ChainResult, Migration, MigrationStep } from './types.js';
import { compareSemver } from './semver.js';

/**
 * Select the migrations needed to move a consumer from `from` to `to`:
 * every migration whose `to` is in `(from, to]`, sorted ascending by `to`.
 * Asserts the chain is contiguous (each migration's `from` equals the running
 * cursor). Throws on downgrade (`from > to`) or a gap in the chain.
 */
export function resolveChain(
  migrations: readonly Migration[],
  from: string,
  to: string,
): Migration[] {
  if (compareSemver(from, to) > 0) {
    throw new Error(`downgrade unsupported: anchored ${from} > installed ${to}`);
  }
  const selected = migrations
    .filter((m) => compareSemver(m.to, from) > 0 && compareSemver(m.to, to) <= 0)
    .toSorted((a, b) => compareSemver(a.to, b.to));
  let cursor = from;
  for (const m of selected) {
    if (compareSemver(m.from, cursor) !== 0) {
      throw new Error(
        `migration chain gap: expected a migration from ${cursor}, got ${m.from} (→${m.to})`,
      );
    }
    cursor = m.to;
  }
  return selected;
}

/** Run each migration's `dryRun` (or `migrate`) in order, collecting steps. */
export function runChain(
  chain: readonly Migration[],
  cwd: string,
  config: ConsumerConfig,
  opts: { dryRun: boolean },
): ChainResult[] {
  return chain.map((migration) => ({
    migration,
    steps: opts.dryRun ? migration.dryRun(cwd, config) : migration.migrate(cwd, config),
  }));
}

/** Deterministic per-file line diff for the `--dry-run` printout. */
export function renderSteps(steps: readonly MigrationStep[]): string {
  const out: string[] = [];
  for (const s of steps) {
    out.push(`--- ${s.path}`);
    const before = s.before.split('\n');
    const after = s.after.split('\n');
    const max = Math.max(before.length, after.length);
    for (let i = 0; i < max; i++) {
      const b = before[i];
      const a = after[i];
      if (b === a) continue;
      if (b !== undefined && b !== '') out.push(`-${b}`);
      if (a !== undefined && a !== '') out.push(`+${a}`);
    }
  }
  return out.join('\n');
}
```

- [ ] **Step 6: Run the test, verify PASS**

```bash
pnpm vitest run src/migrations/__tests__/chain.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/migrations/types.ts src/migrations/chain.ts src/migrations/__tests__/chain.test.ts src/migrations/__tests__/fixtures
git commit -m "feat(migrations): add Migration contract + pure chain engine" -m "Noldor-FD: version-aware-upgrade-and-migration-chain"
```

---

## Task 3: Installed framework version

**Files:**
- Create: `src/migrations/pkg-version.ts`
- Test: `src/migrations/__tests__/pkg-version.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/migrations/__tests__/pkg-version.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedFrameworkVersion } from '../pkg-version.js';

describe('installedFrameworkVersion', () => {
  it('returns the framework package.json version', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      readFileSync(join(here, '..', '..', '..', 'package.json'), 'utf8'),
    ) as { version: string };
    expect(installedFrameworkVersion()).toBe(pkg.version);
    expect(installedFrameworkVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
```

- [ ] **Step 2: Run the test, verify FAIL**

```bash
pnpm vitest run src/migrations/__tests__/pkg-version.test.ts
```

Expected: fails — `Cannot find module '../pkg-version.js'`.

- [ ] **Step 3: Implement `src/migrations/pkg-version.ts`**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMPLATES_ROOT } from '../templates/manifest.js';

/**
 * The framework package's own version, read from its `package.json`.
 * `TEMPLATES_ROOT` resolves to `<pkg-root>/templates` from this module's
 * on-disk location (see src/templates/manifest.ts), so its parent is the
 * package root where `package.json` lives — works under `workspace:*` and a
 * flat `node_modules/noldor/` install alike.
 */
export function installedFrameworkVersion(): string {
  const pkgPath = join(TEMPLATES_ROOT, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
  if (!pkg.version) throw new Error(`framework package.json at ${pkgPath} has no version`);
  return pkg.version;
}
```

- [ ] **Step 4: Run the test, verify PASS**

```bash
pnpm vitest run src/migrations/__tests__/pkg-version.test.ts
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/migrations/pkg-version.ts src/migrations/__tests__/pkg-version.test.ts
git commit -m "feat(migrations): resolve installed framework version from pkg package.json" -m "Noldor-FD: version-aware-upgrade-and-migration-chain"
```

---

## Task 4: Version anchor in consumer config

**Files:**
- Modify: `src/core/consumer-config.ts`
- Test: `src/core/__tests__/framework-version.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/core/__tests__/framework-version.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFrameworkVersion, writeFrameworkVersion } from '../consumer-config.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'noldor-fv-'));
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  writeFileSync(
    join(dir, '.noldor/config.json'),
    JSON.stringify({ consumer: { name: 'x' } }, null, 2),
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('frameworkVersion anchor', () => {
  it('returns null when unset', () => {
    expect(loadFrameworkVersion(dir)).toBeNull();
  });
  it('writes then reads the anchor', () => {
    writeFrameworkVersion(dir, '0.4.0');
    expect(loadFrameworkVersion(dir)).toBe('0.4.0');
    const raw = JSON.parse(readFileSync(join(dir, '.noldor/config.json'), 'utf8'));
    expect(raw.consumer.frameworkVersion).toBe('0.4.0');
    expect(raw.consumer.name).toBe('x'); // preserves siblings
  });
  it('returns null when config absent', () => {
    expect(loadFrameworkVersion(join(dir, 'nope'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test, verify FAIL**

```bash
pnpm vitest run src/core/__tests__/framework-version.test.ts
```

Expected: fails — `loadFrameworkVersion`/`writeFrameworkVersion` are not exported.

- [ ] **Step 3: Add the schema field**

In `src/core/consumer-config.ts`, inside `ConsumerConfigSchema` (after the
`verifyCommands` field, before the closing `})`), add:

```ts
    /**
     * Framework version this consumer tree was last migrated to. Written by
     * `init` (fresh scaffold = current) and `noldor upgrade` (after a chain).
     * Absent on a tree scaffolded before the upgrade feature; `upgrade --from`
     * bootstraps it.
     */
    frameworkVersion: z.string().regex(/^\d+\.\d+\.\d+/).optional(),
```

- [ ] **Step 4: Add the loader + writer helpers**

At the end of `src/core/consumer-config.ts`, append:

```ts
/**
 * The framework version this consumer was last migrated to, or `null` when the
 * field (or the whole config) is absent. Tolerant by design, mirroring
 * {@link loadScopeAliases}.
 */
export function loadFrameworkVersion(cwd: string = process.cwd()): string | null {
  try {
    return loadConsumerConfig(cwd).frameworkVersion ?? null;
  } catch {
    return null;
  }
}

/**
 * Set `consumer.frameworkVersion` in `<cwd>/.noldor/config.json`, preserving
 * every other key. Round-trips the JSON with 2-space indent + trailing newline.
 * Throws if the config file does not exist (the caller scaffolds it first).
 */
export function writeFrameworkVersion(cwd: string, version: string): void {
  const path = join(cwd, CONFIG_FILE);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { consumer?: Record<string, unknown> };
  raw.consumer ??= {};
  raw.consumer.frameworkVersion = version;
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
}
```

Add `writeFileSync` to the existing `node:fs` import at the top
(`import { existsSync, readFileSync, writeFileSync } from 'node:fs';`).

- [ ] **Step 5: Run the test, verify PASS**

```bash
pnpm vitest run src/core/__tests__/framework-version.test.ts
```

Expected: passes.

- [ ] **Step 6: Run the existing consumer-config suite (no regression)**

```bash
pnpm vitest run src/core/__tests__ -t consumer
```

Expected: existing config tests still pass (strict schema now accepts the optional field).

- [ ] **Step 7: Commit**

```bash
git add src/core/consumer-config.ts src/core/__tests__/framework-version.test.ts
git commit -m "feat(core): add frameworkVersion anchor field + load/write helpers" -m "Noldor-FD: version-aware-upgrade-and-migration-chain"
```

---

## Task 5: Seed migration + registry

**Files:**
- Create: `src/migrations/0.4.0.ts`, `src/migrations/registry.ts`

- [ ] **Step 1: Implement the seed anchor migration `src/migrations/0.4.0.ts`**

```ts
import type { Migration } from './types.js';

/**
 * Anchor migration: establishes the migration baseline. No schema transform —
 * a consumer at 0.3.0 owes nothing structural to reach 0.4.0 today. The first
 * real schema change adds its own `<version>.ts` with a genuine transform
 * (enforced by the migration-coverage garden detector).
 */
export const migration_0_4_0: Migration = {
  from: '0.3.0',
  to: '0.4.0',
  description: 'baseline anchor — no schema transform',
  dryRun: () => [],
  migrate: () => [],
};
```

- [ ] **Step 2: Implement the production registry `src/migrations/registry.ts`**

```ts
import type { Migration } from './types.js';
import { migration_0_4_0 } from './0.4.0.js';

/**
 * Every shipped migration, in any order (the engine sorts by `to`). Each new
 * consumer-facing schema change adds an entry here in the same PR.
 */
export const MIGRATIONS: readonly Migration[] = [migration_0_4_0];
```

- [ ] **Step 3: Run the full migrations suite (no regression)**

```bash
pnpm vitest run src/migrations
```

Expected: all migrations tests pass; the engine handles the single-entry registry.

- [ ] **Step 4: Commit**

```bash
git add src/migrations/0.4.0.ts src/migrations/registry.ts
git commit -m "feat(migrations): add 0.4.0 anchor migration + production registry" -m "Noldor-FD: version-aware-upgrade-and-migration-chain"
```

---

## Task 6: `noldor upgrade` command + manifest

**Files:**
- Create: `src/cli/commands/upgrade.ts`
- Modify: `src/cli/manifest.ts`
- Test: `src/cli/commands/__tests__/upgrade.test.ts`

- [ ] **Step 1: Write failing test for the upgrade core (pure, no process exit)**

```ts
// src/cli/commands/__tests__/upgrade.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Migration } from '../../../migrations/types.js';
import { runUpgrade } from '../upgrade.js';

let dir: string;
function git(...args: string[]): void {
  execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'noldor-up-'));
  git('init');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  writeFileSync(
    join(dir, '.noldor/config.json'),
    JSON.stringify({ consumer: { name: 'x', frameworkVersion: '0.2.0' } }, null, 2),
  );
  writeFileSync(join(dir, 'sample.txt'), 'oldKey\n');
  git('add', '.');
  git('commit', '-m', 'init');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const m030: Migration = {
  from: '0.2.0',
  to: '0.3.0',
  description: 'rewrite',
  dryRun(cwd) {
    const b = readFileSync(join(cwd, 'sample.txt'), 'utf8');
    return [{ path: 'sample.txt', before: b, after: b.replace('oldKey', 'newKey') }];
  },
  migrate(cwd) {
    const steps = this.dryRun(cwd, {} as never);
    writeFileSync(join(cwd, steps[0].path), steps[0].after);
    return steps;
  },
};

describe('runUpgrade', () => {
  it('dry-run reports steps, writes nothing, leaves anchor', () => {
    const r = runUpgrade({ cwd: dir, migrations: [m030], installed: '0.3.0', dryRun: true, force: false });
    expect(r.applied).toBe(false);
    expect(r.steps).toBe(1);
    expect(readFileSync(join(dir, 'sample.txt'), 'utf8')).toBe('oldKey\n');
  });

  it('apply lands steps + advances anchor', () => {
    const r = runUpgrade({ cwd: dir, migrations: [m030], installed: '0.3.0', dryRun: false, force: false });
    expect(r.applied).toBe(true);
    expect(readFileSync(join(dir, 'sample.txt'), 'utf8')).toBe('newKey\n');
    const raw = JSON.parse(readFileSync(join(dir, '.noldor/config.json'), 'utf8'));
    expect(raw.consumer.frameworkVersion).toBe('0.3.0');
  });

  it('no-op when already current', () => {
    const r = runUpgrade({ cwd: dir, migrations: [m030], installed: '0.2.0', dryRun: false, force: false });
    expect(r.steps).toBe(0);
    expect(r.applied).toBe(false);
  });

  it('refuses on a dirty tree without force', () => {
    writeFileSync(join(dir, 'dirty.txt'), 'x');
    expect(() =>
      runUpgrade({ cwd: dir, migrations: [m030], installed: '0.3.0', dryRun: false, force: false }),
    ).toThrow(/dirty/);
  });
});
```

- [ ] **Step 2: Run the test, verify FAIL**

```bash
pnpm vitest run src/cli/commands/__tests__/upgrade.test.ts
```

Expected: fails — `Cannot find module '../upgrade.js'`.

- [ ] **Step 3: Implement `src/cli/commands/upgrade.ts`**

```ts
// `noldor upgrade` — walk a consumer from its anchored framework version to the
// installed one through ordered codemods. Pure core (`runUpgrade`) is unit
// tested; the CLI tail parses argv and maps the result to stdout + exit code.
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import {
  loadConsumerConfig,
  loadFrameworkVersion,
  writeFrameworkVersion,
} from '../../core/consumer-config.js';
import { installedFrameworkVersion } from '../../migrations/pkg-version.js';
import { MIGRATIONS } from '../../migrations/registry.js';
import { resolveChain, runChain, renderSteps } from '../../migrations/chain.js';
import type { Migration } from '../../migrations/types.js';

export interface UpgradeInput {
  readonly cwd: string;
  readonly migrations: readonly Migration[];
  readonly installed: string;
  readonly from?: string; // override anchor (bootstrap a pre-feature tree)
  readonly dryRun: boolean;
  readonly force: boolean;
}

export interface UpgradeResult {
  readonly from: string;
  readonly to: string;
  readonly steps: number;
  readonly applied: boolean;
  readonly report: string;
}

function isDirty(cwd: string): boolean {
  const out = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
  return out.trim().length > 0;
}

/** Resolve + run the chain. Pure w.r.t. process state; throws on guard failures. */
export function runUpgrade(input: UpgradeInput): UpgradeResult {
  const config = loadConsumerConfig(input.cwd);
  const from = input.from ?? loadFrameworkVersion(input.cwd);
  if (from === null) {
    throw new Error(
      'no frameworkVersion anchor in .noldor/config.json — run `noldor init`, or pass --from <version> to bootstrap an existing tree',
    );
  }
  const chain = resolveChain(input.migrations, from, input.installed);
  if (chain.length === 0) {
    return { from, to: input.installed, steps: 0, applied: false, report: `already at ${input.installed} — nothing to do` };
  }
  if (!input.dryRun && !input.force && isDirty(input.cwd)) {
    throw new Error('refusing to upgrade on a dirty git tree — commit/stash first, ideally on a fresh branch (`git switch -c chore/noldor-upgrade`)');
  }
  const results = runChain(chain, input.cwd, config, { dryRun: input.dryRun });
  const lines: string[] = [];
  let stepCount = 0;
  for (const r of results) {
    lines.push(`\n## ${r.migration.from} → ${r.migration.to}: ${r.migration.description}`);
    stepCount += r.steps.length;
    lines.push(r.steps.length ? renderSteps(r.steps) : '  (no file changes)');
  }
  if (!input.dryRun) writeFrameworkVersion(input.cwd, input.installed);
  return {
    from,
    to: input.installed,
    steps: stepCount,
    applied: !input.dryRun,
    report: lines.join('\n'),
  };
}

function parseFrom(argv: string[]): string | undefined {
  const i = argv.indexOf('--from');
  const inline = argv.find((a) => a.startsWith('--from='));
  return inline ? inline.slice('--from='.length) : i >= 0 ? argv[i + 1] : undefined;
}

function main(): void {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const force = argv.includes('--force');
  try {
    const result = runUpgrade({
      cwd: process.cwd(),
      migrations: MIGRATIONS,
      installed: installedFrameworkVersion(),
      from: parseFrom(argv),
      dryRun,
      force,
    });
    console.log(result.report);
    if (result.steps > 0) {
      console.log(
        `\n${dryRun ? '[DRY RUN] ' : ''}${result.steps} step(s) across the chain ${result.from} → ${result.to}` +
          (dryRun ? ' — re-run without --dry-run to apply' : `; anchor advanced to ${result.to}`),
      );
    }
    process.exit(0);
  } catch (err) {
    console.error(`upgrade failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('upgrade');
if (invokedDirect) main();
```

- [ ] **Step 4: Run the test, verify PASS**

```bash
pnpm vitest run src/cli/commands/__tests__/upgrade.test.ts
```

Expected: all `runUpgrade` tests pass.

- [ ] **Step 5: Register the `upgrade` leaf group in `src/cli/manifest.ts`**

Add this entry to `MANIFEST` (next to `doctor`, keeping the file's grouping):

```ts
  upgrade: {
    desc: 'Run version-aware migration chain (anchored → installed framework version)',
    subs: {
      '': {
        src: 'cli/commands/upgrade.ts',
        desc: 'Run upgrade (--dry-run / --from <version> / --force)',
      },
    },
  },
```

- [ ] **Step 6: Smoke the wired command (dry-run, no-op expected at HEAD)**

```bash
pnpm noldor upgrade --dry-run --from 0.3.0
```

Expected: prints `already at <installed> — nothing to do` (HEAD installed == 0.3.0, the anchor migration's `to` is 0.4.0 so nothing yet ≤ installed) OR an empty chain; exit 0. No file changes.

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/upgrade.ts src/cli/manifest.ts src/cli/commands/__tests__/upgrade.test.ts
git commit -m "feat(cli): add noldor upgrade command + manifest entry" -m "Noldor-FD: version-aware-upgrade-and-migration-chain"
```

---

## Task 7: `init` writes the anchor

**Files:**
- Modify: `src/cli/commands/init.ts`

- [ ] **Step 1: Wire the anchor write after a successful scaffold**

In `src/cli/commands/init.ts`, inside the `try` block, after the
`console.log(\`\n${counts.added} added ...\`)` line and before
`process.exit(0)`, add:

```ts
  // Stamp the framework version a fresh/updated tree is now at, so `upgrade`
  // and `doctor` have an anchor to compare against. A scaffold is by definition
  // current — it owes no migrations.
  if (existsSync(join(consumer, '.noldor/config.json'))) {
    writeFrameworkVersion(consumer, installedFrameworkVersion());
  }
```

Add the imports at the top of the file:

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeFrameworkVersion } from '../../core/consumer-config.js';
import { installedFrameworkVersion } from '../../migrations/pkg-version.js';
```

- [ ] **Step 2: Verify the build typechecks**

```bash
pnpm typecheck
```

Expected: no type errors.

- [ ] **Step 3: Manual smoke — init into a throwaway dir stamps the anchor**

```bash
TMP=$(mktemp -d) && cp -r .noldor "$TMP"/ && (cd "$TMP" && node "$OLDPWD/dist/cli/commands/init.ts" >/dev/null 2>&1 || true) ; node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP/.noldor/config.json','utf8')).consumer.frameworkVersion)" ; rm -rf "$TMP"
```

Expected: prints the installed version (e.g. `0.3.0`). (If the harness runs from `src/` via tsx instead of `dist/`, adapt the entry path; the assertion is the printed version.)

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/init.ts
git commit -m "feat(cli): init stamps frameworkVersion anchor into .noldor/config.json" -m "Noldor-FD: version-aware-upgrade-and-migration-chain"
```

---

## Task 8: `doctor` skew warning

**Files:**
- Modify: `src/cli/commands/doctor.ts`

- [ ] **Step 1: Add the skew check (advisory, exit-code unaffected)**

In `src/cli/commands/doctor.ts`, after the runner-check loop and before the
`if (bad === 0 && runnerBad === 0)` block, add:

```ts
// Framework-version skew: advisory only (does NOT affect exit code). A consumer
// with synced templates but an un-migrated tree should still pass `doctor`
// green after running `noldor upgrade`.
const anchored = loadFrameworkVersion(process.cwd());
const installed = installedFrameworkVersion();
if (anchored !== installed) {
  console.log(
    `warn         framework skew: anchored ${anchored ?? '(unset)'} ≠ installed ${installed} — run 'noldor upgrade'`,
  );
}
```

Add the imports at the top:

```ts
import { loadFrameworkVersion } from '../../core/consumer-config.js';
import { installedFrameworkVersion } from '../../migrations/pkg-version.js';
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: no type errors.

- [ ] **Step 3: Smoke doctor in this repo**

```bash
pnpm noldor doctor; echo "exit=$?"
```

Expected: a `warn framework skew` line appears if this repo's anchor differs from installed; exit code reflects only template-drift + runner health, not the skew.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/doctor.ts
git commit -m "feat(cli): doctor warns on framework version skew" -m "Noldor-FD: version-aware-upgrade-and-migration-chain"
```

---

## Task 9: Migration-coverage garden detector

**Files:**
- Create: `src/garden/detectors/migration-coverage.ts`
- Modify: `src/garden/garden-detect.ts`
- Test: `src/garden/detectors/__tests__/migration-coverage.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/garden/detectors/__tests__/migration-coverage.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateCoverage } from '../migration-coverage.js';

describe('evaluateCoverage', () => {
  it('flags a schema change with no migration', () => {
    const f = evaluateCoverage(['src/core/consumer-config.ts', 'README.md']);
    expect(f).not.toBeNull();
    expect(f?.reason).toBe('schema-changed-without-migration');
    expect(f?.schemaFiles).toContain('src/core/consumer-config.ts');
  });
  it('is silent when a migration accompanies the schema change', () => {
    expect(
      evaluateCoverage(['src/core/consumer-config.ts', 'src/migrations/0.5.0.ts']),
    ).toBeNull();
  });
  it('ignores migration test files (not a real migration)', () => {
    const f = evaluateCoverage([
      'docs/noldor/feature-md-schema.md',
      'src/migrations/__tests__/chain.test.ts',
    ]);
    expect(f).not.toBeNull();
  });
  it('is silent when no schema surface changed', () => {
    expect(evaluateCoverage(['src/dashboard/server.ts'])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test, verify FAIL**

```bash
pnpm vitest run src/garden/detectors/__tests__/migration-coverage.test.ts
```

Expected: fails — `Cannot find module '../migration-coverage.js'`.

- [ ] **Step 3: Implement `src/garden/detectors/migration-coverage.ts`**

```ts
import { execFileSync } from 'node:child_process';

/** Consumer-facing schema surfaces. Edits here must ship a migration. */
export const SCHEMA_SURFACE: readonly string[] = [
  'src/core/consumer-config.ts',
  'docs/noldor/feature-md-schema.md',
  'templates/.noldor/config.json',
];

export interface MigrationCoverageFinding {
  readonly reason: 'schema-changed-without-migration';
  readonly schemaFiles: string[];
  readonly action: 'add-migration';
}

const MIGRATION_RE = /^src\/migrations\/[^/]+\.ts$/;

/** Pure core: decide coverage from a list of changed paths. */
export function evaluateCoverage(changed: readonly string[]): MigrationCoverageFinding | null {
  const schemaFiles = changed.filter((f) => SCHEMA_SURFACE.includes(f));
  if (schemaFiles.length === 0) return null;
  const hasMigration = changed.some(
    (f) => MIGRATION_RE.test(f) && !f.includes('__tests__') && f !== 'src/migrations/registry.ts',
  );
  if (hasMigration) return null;
  return { reason: 'schema-changed-without-migration', schemaFiles, action: 'add-migration' };
}

/** Range-based wrapper: diff `range` and evaluate coverage. */
export function detectMigrationCoverage(
  range: string,
  cwd: string = process.cwd(),
): MigrationCoverageFinding | null {
  let changed: string[] = [];
  try {
    changed = execFileSync('git', ['diff', '--name-only', range], { cwd, encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
  return evaluateCoverage(changed);
}
```

- [ ] **Step 4: Run the test, verify PASS**

```bash
pnpm vitest run src/garden/detectors/__tests__/migration-coverage.test.ts
```

Expected: passes.

- [ ] **Step 5: Wire the detector into `src/garden/garden-detect.ts`**

Add the import beside the other detector imports:

```ts
import { detectMigrationCoverage } from './detectors/migration-coverage.js';
```

In the detector-run body, invoke it over the same release range the other
range-based detectors use (follow the existing `range`/`prevTag..HEAD`
variable already in scope) and fold any finding into the emitted findings
array under a `migration-coverage` key, matching the surrounding pattern for
`detectTierMismatch`. (Exact wiring mirrors the adjacent detector calls — read
the run block first and copy its shape.)

- [ ] **Step 6: Run the garden-detect suite (no regression)**

```bash
pnpm vitest run src/garden/__tests__/garden-detect.test.ts
```

Expected: existing garden-detect tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/garden/detectors/migration-coverage.ts src/garden/garden-detect.ts src/garden/detectors/__tests__/migration-coverage.test.ts
git commit -m "feat(garden): detect schema change without accompanying migration" -m "Noldor-FD: version-aware-upgrade-and-migration-chain"
```

---

## Task 10: Documentation

**Files:**
- Modify: `docs/noldor/versioning.md`, `docs/noldor/adoption-guide.md`

- [ ] **Step 1: Document the anchor + upgrade flow in `docs/noldor/versioning.md`**

Add a new `## Version-aware upgrade` section after the "Who owns
`introduced` / `updated`?" section:

```md
## Version-aware upgrade

Each consumer records the framework version its tree was last migrated to in
`.noldor/config.json` `consumer.frameworkVersion` — written by `noldor init`
(fresh scaffold = current) and `noldor upgrade` (after a migration chain).

`noldor upgrade` resolves the ordered chain from the anchored version to the
installed framework version (`src/migrations/<version>.ts` modules) and runs
each migration as a pure file transform:

- `noldor upgrade --dry-run` prints per-step diffs and touches nothing.
- `noldor upgrade` applies the chain and advances the anchor **only after the
  full chain succeeds**. It refuses on a dirty git tree (use a fresh branch).
- Re-running is a no-op once the anchor equals the installed version.
- `noldor upgrade --from <version>` bootstraps a tree scaffolded before the
  anchor existed.

**Downgrade is unsupported** — `installed < anchored` errors out. Reverting
framework versions is a git operation, not a codemod concern.

**Authoring discipline:** a PR that edits a consumer-facing schema surface
(`src/core/consumer-config.ts`, `docs/noldor/feature-md-schema.md`,
`templates/.noldor/config.json`) MUST ship a matching
`src/migrations/<version>.ts` in the same PR, or `pnpm noldor garden detect`
flags `schema-changed-without-migration`.
```

- [ ] **Step 2: Add the upgrade step to `docs/noldor/adoption-guide.md`**

In the adoption / maintenance path, after the `noldor init --update` guidance,
add:

```md
After pulling a newer framework version, run `noldor doctor` — a
`framework skew` warning means the consumer's tree is anchored to an older
schema version. Run `noldor upgrade --dry-run` to review the migration diffs,
then `noldor upgrade` on a clean branch to apply them. See
[versioning.md](versioning.md#version-aware-upgrade).
```

- [ ] **Step 3: Validate docs build / links**

```bash
pnpm noldor docs check
```

Expected: no broken-link or tag errors introduced by the new section/anchors.

- [ ] **Step 4: Commit**

```bash
git add docs/noldor/versioning.md docs/noldor/adoption-guide.md
git commit -m "docs(noldor): document version-aware upgrade + migration authoring discipline" -m "Noldor-FD: version-aware-upgrade-and-migration-chain"
```

---

## Task 11: Full-suite verification

**Files:**
- Test: (whole suite)

- [ ] **Step 1: Run the full test suite + typecheck**

```bash
pnpm typecheck && pnpm vitest run
```

Expected: green. New modules under `src/migrations/`, the consumer-config
anchor, upgrade command, doctor skew, and the coverage detector all pass; no
regressions in existing suites.

- [ ] **Step 2: End-to-end acceptance against a fixture (manual)**

```bash
TMP=$(mktemp -d); cp -r src/migrations/__tests__/fixtures/0.2.0/. "$TMP"/; (cd "$TMP" && git init -q && git add -A && git commit -qm init); echo "fixture at $TMP anchored 0.2.0 — wire a 2-step synthetic chain via a scratch test to confirm dry-run lists 2 steps, apply lands both, anchor advances, re-run no-ops"; rm -rf "$TMP"
```

Expected: confirms the acceptance sketch — dry-run lists steps with diffs, apply
lands them, anchor advances, re-run is a no-op. (The deterministic version of
this is already covered by `chain.test.ts` + `upgrade.test.ts`; this step is the
manual sanity check.)

- [ ] **Step 3: Commit (only if Step 1/2 surfaced fixups)**

```bash
git add -A
git commit -m "test(migrations): verify full upgrade chain acceptance" -m "Noldor-FD: version-aware-upgrade-and-migration-chain"
```
