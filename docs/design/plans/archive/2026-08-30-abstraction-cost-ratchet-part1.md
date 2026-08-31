# Abstraction-Cost Ratchet Implementation Plan — Part 1: Measure and Report

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Ship `pnpm noldor indirection report` end to end — a working diagnostic that measures each module's transitive in-repo import closure and prints the excess above the threshold. Merged alone, this part gives anyone a command that tells them where their cross-file indirection actually sits. Part 2 adds the ratchet and the `abstraction-cost` rule, which names `indirection check` and so cannot land before it exists.

**Architecture:** Engine (`detect.ts`) and CLI (`indirection-cli.ts`), mirroring the `src/clones/` engine/CLI split. The engine wraps `dependency-cruiser`, already a production dependency; scan roots and file policy come from `src/core/repo-paths.ts`; the parser-availability guard is imported from `src/invariants/boundaries.ts`, which already exports it. Part 2 adds the persisted baseline and the gate on top of this same command.

**Tech Stack:** TypeScript 7 (ESM, explicit `.js` specifiers), Zod 3 (`.strict()`), Vitest, `dependency-cruiser` + `@swc/core`, lefthook.

---

## File Structure

- `src/indirection/detect.ts` — **create.** Closure measurement: cruise the scan roots, build the module graph, compute each module's transitive in-repo closure, return a report. No IO beyond the cruise call.
- `src/indirection/indirection-cli.ts` — **create.** Arg parsing and the `report` subcommand. Part 2 widens it.
- `src/indirection/__tests__/detect.test.ts` — **create.** Engine tests against fixture trees.
- `src/indirection/__tests__/indirection-cli.test.ts` — **create.** Arg parsing and `report` exit codes.
- `src/indirection/__tests__/trees/**` — **create.** Fixture trees. Deliberately not under a `fixtures/` segment: `WALK_EXCLUDED_DIRS` skips that name, which would make the empty-vs-broken assertions pass vacuously.
- `package.json` / `pnpm-lock.yaml` — **modify.** `@swc/core` moves `devDependencies` → `dependencies`; the lockfile pins the split and CI installs `--frozen-lockfile`.
- `src/cli/manifest.ts` — **modify.** Add the `indirection` leaf beside `clones`.
- `docs/noldor/script-catalog.md` — **modify.** Twin catalog entry; `validate script-catalog` blocks pre-commit without it.

---

## Task 1: Closure engine

Every code block below was executed as a spike against real fixture trees and the live repo before being written here. The measured results it must reproduce: chain `a.ts` closure 3, deep-registry `aggregator.ts` closure 32 / excess 2 with members at 0, `edges/root.ts` closure 3, a tests-only tree classified `empty`, and the repo at excess sum 882 across 38 flagged modules.

**Files:**
- Create: `src/indirection/detect.ts`
- Create: `src/indirection/__tests__/detect.test.ts`
- Create: `src/indirection/__tests__/trees/chain/{a,b,c,d}.ts`
- Create: `src/indirection/__tests__/trees/shallow-registry/{registry,m1,m2,m3}.ts`
- Create: `src/indirection/__tests__/trees/tests-only/thing.spec.ts`
- Create: `src/indirection/__tests__/trees/empty/.gitkeep`
- Modify: `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Move `@swc/core` to production dependencies and refresh the lockfile.**

  `dependency-cruiser` is already a production dependency, but its only working parser under TypeScript 7 is `@swc/core`, which is currently dev-only — so a consumer installing Noldor gets the cruiser with no parser, and `cruise` returns zero modules rather than failing. Edit `package.json`: delete `"@swc/core": "^1.16.1"` from `devDependencies` and add it to `dependencies`, keeping both blocks alphabetically sorted. Then refresh the lockfile, which pins the split explicitly and is validated by `pnpm install --frozen-lockfile` in `.github/workflows/contract-e2e.yml` and `publish.yml`:

  ```bash
  pnpm install --lockfile-only
  git diff --stat pnpm-lock.yaml
  ```
  Expected output: `pnpm-lock.yaml` shows `@swc/core` moving from the `devDependencies` block to `dependencies`.

- [ ] **Step 2: Write the fixture trees.**

  `src/indirection/__tests__/trees/chain/a.ts`:
  ```ts
  import { b } from './b.js';
  export const a = (): string => b();
  ```
  `.../chain/b.ts`:
  ```ts
  import { c } from './c.js';
  export const b = (): string => c();
  ```
  `.../chain/c.ts`:
  ```ts
  import { d } from './d.js';
  export const c = (): string => d();
  ```
  `.../chain/d.ts`:
  ```ts
  export const d = (): string => 'leaf';
  ```

  `.../shallow-registry/m1.ts`, `m2.ts`, `m3.ts` — `export const value = 1;` (vary the number per file so no two are byte-identical and they cannot form a clone group).

  `.../shallow-registry/registry.ts`:
  ```ts
  import { value as v1 } from './m1.js';
  import { value as v2 } from './m2.js';
  import { value as v3 } from './m3.js';
  export const all = [v1, v2, v3];
  ```

  `.../tests-only/thing.spec.ts` — `export const thing = 1;` A tree of nothing but test files is a legitimately excluded corpus, not a broken parse; this fixture is what proves the engine says so.

  `.../empty/.gitkeep` — empty, so git tracks a directory holding no code files.

  **Every tree also gets a `.noldor/config.json`.** `runIndirection` resolves roots through `scanRoots`, and `loadConsumerConfig` **throws** on a directory with no config — verified: `scanRoots('<a bare mkdtemp dir>')` raises `loadConsumerConfig: missing .noldor/config.json`. Without this file the CLI tests reject instead of returning. Write the same minimal config into each tree directory (`chain`, `shallow-registry`, `tests-only`, `empty`, and the trees added in Task 4):
  ```json
  { "consumer": { "name": "fixture", "repoUrl": "https://example.invalid/fixture",
    "lockstepPackages": ["package.json"], "scanPaths": ["."], "e2ePrefix": "fixture",
    "samplesPath": "samples", "packagePrefix": "@fixture/", "appPathPrefix": "apps/" } }
  ```
  All eight keys are required — `ConsumerConfigSchema` (`consumer-config.ts:209-218`) makes `name`, `repoUrl` (a real URL), `lockstepPackages`, `e2ePrefix`, `samplesPath`, `packagePrefix` and `appPathPrefix` mandatory, so a `scanPaths`-only stub fails Zod validation. Verified: with this file, `scanRoots(<tree>)` returns `["."]`.
  A Noldor repo always has this file, so testing without one would test a state that cannot occur.

  Under `__tests__/trees/`, deliberately **not** a `fixtures` segment: `WALK_EXCLUDED_DIRS` (`repo-paths.ts:75-83`) skips `fixtures`/`dist`/`coverage`/`.turbo`, so such a tree is invisible to `walkCodeFiles` and every empty-vs-unmeasurable assertion would pass vacuously green.

- [ ] **Step 3: Write the failing engine test.**

  `src/indirection/__tests__/detect.test.ts`:
  ```ts
  import { join } from 'node:path';

  import { describe, expect, it } from 'vitest';

  import { INDIRECTION_CLOSURE_THRESHOLD, measureIndirection } from '../detect.js';

  /** Roots are relative to `cwd` — see the note in Step 5 on why. */
  const tree = (name: string) => ({ roots: ['.'], cwd: join(import.meta.dirname, 'trees', name) });

  describe('measureIndirection', () => {
    it('counts the transitive in-repo closure, excluding the module itself', async () => {
      const r = await measureIndirection(tree('chain'));
      expect(r.kind).toBe('measured');
      if (r.kind !== 'measured') return;
      const closures = new Map(r.modules.map((m) => [m.source, m.closure]));
      expect(closures.get('a.ts')).toBe(3);
      expect(closures.get('b.ts')).toBe(2);
      expect(closures.get('c.ts')).toBe(1);
      expect(closures.get('d.ts')).toBe(0);
      expect(r.excessSum).toBe(0);
    });

    it('keeps a shallow registry aggregator under the threshold, so members cost nothing', async () => {
      const r = await measureIndirection(tree('shallow-registry'));
      expect(r.kind).toBe('measured');
      if (r.kind !== 'measured') return;
      expect(r.modules.find((m) => m.source === 'registry.ts')?.closure).toBe(3);
      expect(r.excessSum).toBe(0);
      expect(r.flagged).toEqual([]);
    });

    it('reports an empty scan root as empty', async () => {
      expect((await measureIndirection(tree('empty'))).kind).toBe('empty');
    });

    it('reports a tests-only tree as empty rather than unmeasurable', async () => {
      // A legitimately excluded corpus is not a broken parse. Counting tests in
      // the pre-scan would call this tree non-empty, and the cruiser — which
      // excludes them — would then report it unmeasurable.
      expect((await measureIndirection(tree('tests-only'))).kind).toBe('empty');
    });

    it('retains the threshold it measured against', async () => {
      const r = await measureIndirection({ ...tree('chain'), threshold: 2 });
      expect(r.kind).toBe('measured');
      if (r.kind !== 'measured') return;
      expect(r.threshold).toBe(2);
      // a.ts closure 3 -> excess 1 at threshold 2; b.ts closure 2 -> excess 0
      expect(r.modules.find((m) => m.source === 'a.ts')?.excess).toBe(1);
      expect(r.modules.find((m) => m.source === 'b.ts')?.excess).toBe(0);
      expect(r.excessSum).toBe(1);
    });

    it('boundary: a closure exactly at the threshold is not flagged, one above is', async () => {
      const at = await measureIndirection({ ...tree('chain'), threshold: 3 });
      const above = await measureIndirection({ ...tree('chain'), threshold: 2 });
      expect(at.kind === 'measured' && at.flagged.length).toBe(0);
      expect(above.kind === 'measured' && above.flagged.length).toBe(1);
    });

    it('orders modules by closure descending, path ascending as tiebreak', async () => {
      const r = await measureIndirection(tree('chain'));
      if (r.kind !== 'measured') return;
      expect(r.modules.map((m) => m.source)).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts']);
    });

    it('computes nearest-rank percentiles over the closure vector', async () => {
      const r = await measureIndirection(tree('chain'));
      if (r.kind !== 'measured') return;
      // closures ascending: [0, 1, 2, 3]
      expect(r.percentiles).toEqual({ p50: 1, p75: 2, p90: 3, p99: 3, max: 3 });
    });

    it('exposes the threshold constant the gate ships with', () => {
      expect(INDIRECTION_CLOSURE_THRESHOLD).toBe(30);
    });
  });
  ```

- [ ] **Step 4: Run the test to verify it FAILS.**

  ```bash
  pnpm vitest run src/indirection/__tests__/detect.test.ts
  ```
  Expected output: failure with `Failed to resolve import "../detect.js"` — the module does not exist yet.

- [ ] **Step 5: Implement the engine.**

  Two constraints, both established by running it. **Roots are relative to `baseDir`** — `cruise` joins them, so an absolute root gives `ENOENT: ... stat '<baseDir>/<abs>'` (verified on `dependency-cruiser@16.10.4`; `cruise(['.'], {baseDir: abs})` works, and `boundaries.ts:126` passes relative for the same reason). `walkCodeFiles` needs absolute, so the engine resolves them itself. **Expected failures are results, not throws** — `error-result-types` is `enforce: true` on `**/*.ts`, and "no parser" / "unmeasurable graph" are expected, so they are union members; the union shape also proves `empty` carries no modules and `measured` always carries percentiles.

  `src/indirection/detect.ts`:
  ```ts
  /**
   * Whole-corpus indirection measurement. For each in-repo module, the size of
   * its transitive in-repo import closure — how many files a reader or an agent
   * must fetch to understand it. Cross-file indirection is what costs; a long
   * file of local helpers is free by construction and out of scope.
   *
   * The ratchet number is the EXCESS SUM, not a count of flagged modules: a
   * count cannot see a closure growing 31 -> 100, and can stay flat while one
   * module crosses the threshold and another drops below it.
   */
  import { realpathSync } from 'node:fs';
  import { relative, resolve, sep } from 'node:path';

  import { allExtensions, cruise } from 'dependency-cruiser';

  import { CODE_FILE_RE, TEST_FILE_RE, walkCodeFiles } from '../core/repo-paths.js';
  import { findUnparseableTsExtensions } from '../invariants/boundaries.js';

  /**
   * Closure size above which a module is flagged. The measured p90 of this
   * repo, chosen on a plateau — 38 modules flagged at 30 and 36 at 35 — so the
   * verdict does not rest on precise tuning, which matters for a constant
   * shipped to repos it was never measured against.
   */
  export const INDIRECTION_CLOSURE_THRESHOLD = 30;

  export interface ModuleClosure {
    readonly source: string;
    readonly closure: number;
    readonly excess: number;
  }

  export interface Percentiles {
    readonly p50: number;
    readonly p75: number;
    readonly p90: number;
    readonly p99: number;
    readonly max: number;
  }

  /**
   * A discriminated union so the type carries the invariants: an `empty` corpus
   * has no modules and no percentiles, a `measured` one always has both, and the
   * two expected failures are values rather than exceptions (`error-result-types`).
   */
  export type IndirectionResult =
    | { readonly kind: 'empty'; readonly threshold: number }
    | {
        readonly kind: 'measured';
        readonly threshold: number;
        readonly excessSum: number;
        readonly modules: readonly ModuleClosure[];
        readonly flagged: readonly ModuleClosure[];
        readonly percentiles: Percentiles;
        readonly unresolvedInScope: readonly string[];
      }
    | { readonly kind: 'no-parser'; readonly extensions: readonly string[]; readonly message: string }
    | { readonly kind: 'unmeasurable'; readonly message: string; readonly cause?: unknown };

  export interface MeasureOptions {
    /** Roots RELATIVE to `cwd`; an absolute root makes cruise join it onto baseDir. */
    readonly roots: readonly string[];
    readonly cwd: string;
    /** Overrides {@link INDIRECTION_CLOSURE_THRESHOLD}; used by tests to pin boundaries. */
    readonly threshold?: number;
    /**
     * Parser-availability report, defaulting to dependency-cruiser's own.
     * Injectable because parser availability is a process condition: once
     * `@swc/core` is a production dependency the test environment always has
     * it, so the guard is otherwise unreachable from a test.
     */
    readonly extensions?: ReadonlyArray<{ readonly extension: string; readonly available: boolean }>;
  }

  interface CruiseDep {
    readonly resolved: string;
    readonly couldNotResolve?: boolean;
    readonly module?: string;
  }

  interface CruiseModule {
    readonly source: string;
    readonly dependencies: readonly CruiseDep[];
  }

  /** Nearest-rank percentile over an ascending vector. */
  function percentile(sorted: readonly number[], p: number): number {
    if (sorted.length === 0) return 0;
    return sorted[Math.max(1, Math.ceil(p * sorted.length)) - 1]!;
  }

  /**
   * Ours, therefore fatal when unresolved. A bare package specifier is not:
   * dependency-cruiser reports `couldNotResolve` for healthy reasons there — an
   * optional peer that is not installed, a package whose `types` entry does not
   * resolve — and treating those as failures would hard-block pre-push in
   * consumer repos that are perfectly fine.
   */
  function isInScopeSpecifier(spec: string | undefined): boolean {
    if (spec === undefined) return false;
    return spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('#');
  }

  /** cruise reports paths relative to baseDir; anything escaping it is not ours. */
  function isInRepo(source: string): boolean {
    return !source.startsWith('..') && !source.startsWith(sep) && !/^[A-Za-z]:/.test(source);
  }

  function isMeasurable(source: string): boolean {
    return (
      isInRepo(source) &&
      CODE_FILE_RE.test(source) &&
      !source.endsWith('.d.ts') &&
      !TEST_FILE_RE.test(source) &&
      !source.split('/').includes('__tests__')
    );
  }

  export async function measureIndirection(opts: MeasureOptions): Promise<IndirectionResult> {
    const threshold = opts.threshold ?? INDIRECTION_CLOSURE_THRESHOLD;

    // Resolve symlinks before anything else. cruise emits paths relative to
    // `baseDir`, and when `baseDir` is a symlink (every macOS `tmpdir()` is) it
    // resolves imports through the real path and emits an escaped
    // `../../../private/var/...` twin alongside the in-tree module. The twin
    // fails the containment check below, so the in-tree module's dependency
    // misses `byId` and its closure collapses to 0 — a silent under-measure,
    // not a throw. `src/invariants/boundaries.ts:87` calls `realpath` for the
    // same reason.
    const base = realpathSync(opts.cwd);

    // Does any MEASURABLE source file exist? Counting tests here would call a
    // test-only tree non-empty and then report it unmeasurable, since the cruise
    // below excludes them — a legitimately excluded corpus is empty, not broken.
    const candidateAbs = opts.roots
      .flatMap((r) => walkCodeFiles(resolve(base, r), { includeTests: false }))
      .filter((f) => !f.endsWith('.d.ts'));
    if (candidateAbs.length === 0) return { kind: 'empty', threshold };

    // The measured set is the INTERSECTION of what cruise reported and what the
    // walker admits. Without it, a file under a `WALK_EXCLUDED_DIRS` directory
    // that some measured module imports would enter the metric even though the
    // walker never offered it as a candidate — two different corpus rules.
    const candidates = new Set(candidateAbs.map((f) => relative(base, realpathSync(f)).split(sep).join('/')));

    const unparseable = findUnparseableTsExtensions(opts.extensions ?? allExtensions);
    if (unparseable.length > 0) {
      return {
        kind: 'no-parser',
        extensions: unparseable,
        message:
          `no TypeScript parser available for ${unparseable.join(', ')} — install @swc/core ` +
          `(dependency-cruiser accepts typescript >=2 <6, or @swc/core)`,
      };
    }

    let raw: readonly CruiseModule[];
    try {
      const result = await cruise([...opts.roots], {
        baseDir: base,
        validate: false,
        doNotFollow: { path: 'node_modules' },
        exclude: { path: `node_modules|__tests__|${TEST_FILE_RE.source}` },
        tsPreCompilationDeps: true,
      });
      const out = result.output;
      raw =
        typeof out === 'object' && out !== null && 'modules' in out
          ? (out as { modules: readonly CruiseModule[] }).modules
          : [];
    } catch (e) {
      // The cruiser is an external boundary: convert its throw to a result and
      // keep the original as `cause`, per error-result-types.
      return {
        kind: 'unmeasurable',
        message: `dependency-cruiser failed: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      };
    }

    const measured = raw.filter((m) => isMeasurable(m.source) && candidates.has(m.source));
    if (measured.length < candidateAbs.length) {
      // Partial output is not a measurement. A candidate the walker offered but
      // cruise did not report back means the graph is missing edges we cannot
      // see, which would understate every closure that should have crossed it.
      return {
        kind: 'unmeasurable',
        message:
          `${candidateAbs.length} source file(s) on disk but dependency-cruiser reported ` +
          `${measured.length} — the graph is incomplete and cannot be measured`,
      };
    }

    const byId = new Map(measured.map((m) => [m.source, m]));

    const unresolvedInScope: string[] = [];
    for (const m of measured) {
      for (const d of m.dependencies) {
        if (d.couldNotResolve === true && isInScopeSpecifier(d.module)) {
          unresolvedInScope.push(`${m.source} -> ${d.module ?? d.resolved}`);
        }
      }
    }

    const closureOf = (id: string): number => {
      const seen = new Set<string>();
      const stack = [id];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        for (const d of byId.get(cur)?.dependencies ?? []) {
          if (!byId.has(d.resolved) || seen.has(d.resolved)) continue;
          seen.add(d.resolved);
          stack.push(d.resolved);
        }
      }
      seen.delete(id);
      return seen.size;
    };

    const modules = measured
      .map((m) => {
        const closure = closureOf(m.source);
        return { source: m.source, closure, excess: Math.max(0, closure - threshold) };
      })
      .sort((a, b) => b.closure - a.closure || a.source.localeCompare(b.source));

    const sorted = [...modules.map((m) => m.closure)].sort((a, b) => a - b);

    return {
      kind: 'measured',
      threshold,
      excessSum: modules.reduce((n, m) => n + m.excess, 0),
      modules,
      flagged: modules.filter((m) => m.excess > 0),
      percentiles: {
        p50: percentile(sorted, 0.5),
        p75: percentile(sorted, 0.75),
        p90: percentile(sorted, 0.9),
        p99: percentile(sorted, 0.99),
        max: sorted.at(-1) ?? 0,
      },
      unresolvedInScope,
    };
  }
  ```

- [ ] **Step 6: Run the test to verify it PASSES.**

  ```bash
  pnpm vitest run src/indirection/__tests__/detect.test.ts
  ```
  Expected output: `Test Files  1 passed (1)` and `Tests  9 passed (9)`.

- [ ] **Step 7: Sanity-check against the live repo.**

  ```bash
  pnpm exec tsx -e "import('./src/indirection/detect.js').then(async m => { const r = await m.measureIndirection({ roots: ['src'], cwd: process.cwd() }); console.log(r.kind, r.kind === 'measured' && r.excessSum, r.kind === 'measured' && r.flagged.length); })"
  ```
  Expected output: `measured 882 38` — or a slightly higher excess sum once this feature's own modules exist. A number near zero means the exclusion is over-broad; a `no-parser` or `unmeasurable` result means Step 1 did not take effect.

- [ ] **Step 8: Typecheck.**

  ```bash
  pnpm typecheck
  ```
  Expected output: no errors (exit 0).

- [ ] **Step 9: Commit.**

  ```bash
  cat > /tmp/indirection-t1.txt <<'MSG'
  feat(indirection): measure per-module transitive import closure

  Why — the clone ratchet enforces the duplication axis in one direction only,
  so the cheapest way to clear it is to extract a shared helper, and nothing
  measures what that extraction costs. On the 2026-08-30 release sweep the
  ratchet reddened on two one-line delegations that share no logic; the operator
  judged extracting "strictly worse — one generic untyped wrapper, indirection
  added, zero logic shared" and rebaselined to 28844 to unblock. The gate was
  wrong and the framework had no way to say so.

  How — a whole-corpus measurement over each module's transitive in-repo import
  closure, built on the dependency-cruiser dependency the repo already carries.
  The ratchet number is the excess sum, the total closure above a threshold of
  30, because a count of flagged modules cannot see a closure growing 31 to 100
  and can stay flat while one module crosses and another drops below. Scan roots
  and file policy come from repo-paths so a consumer with a non-src layout is
  measured correctly, and the parser-availability guard is reused from the
  boundaries invariant so an unparsed tree is reported rather than counted as
  clean. Expected failures are members of a returned discriminated union rather
  than exceptions, per the error-result-types rule.

  What — the engine plus its fixture trees, and @swc/core moved to production
  dependencies with the lockfile refreshed: it is dependency-cruiser's only
  working parser under TypeScript 7, so shipping it as a devDependency left
  every consumer with a cruiser that silently returns no modules.

  Noldor-FD: abstraction-cost-ratchet
  MSG
  git add src/indirection package.json pnpm-lock.yaml
  git commit -F /tmp/indirection-t1.txt
  ```

---

## Task 2: `indirection report`

**Files:**
- Create: `src/indirection/indirection-cli.ts`
- Create: `src/indirection/__tests__/indirection-cli.test.ts`
- Create: `src/indirection/__tests__/trees/unresolved/a.ts`

- [ ] **Step 1: Add the unresolved-import fixture.**

  `src/indirection/__tests__/trees/unresolved/a.ts`:
  ```ts
  // Relative and unresolvable — ours, therefore reported.
  import { missing } from './does-not-exist.js';
  // Bare and unresolvable — dependency-cruiser reports couldNotResolve here for
  // healthy reasons, so this one must NOT be reported.
  import { alsoMissing } from 'no-such-package-anywhere';

  export const a = (): unknown => [missing, alsoMissing];
  ```
  Verified against the spike: this tree yields exactly one in-scope unresolved entry, `a.ts -> ./does-not-exist.js`.

- [ ] **Step 2: Write the failing CLI test.**

  `src/indirection/__tests__/indirection-cli.test.ts`:
  ```ts
  import { join } from 'node:path';

  import { describe, expect, it } from 'vitest';

  import { parseIndirectionArgs, renderReport, runIndirection } from '../indirection-cli.js';
  import { measureIndirection } from '../detect.js';

  const treeDir = (name: string): string => join(import.meta.dirname, 'trees', name);

  /** Capture stdout for one call. */
  async function capture(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
    const chunks: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => {
      chunks.push(s);
      return true;
    }) as typeof process.stdout.write;
    try {
      return { code: await fn(), out: chunks.join('') };
    } finally {
      process.stdout.write = write;
    }
  }

  describe('parseIndirectionArgs', () => {
    it('rejects an unknown subcommand', () => {
      expect(() => parseIndirectionArgs(['wat'])).toThrow(/usage: noldor indirection/);
    });

    it('rejects an unknown flag', () => {
      expect(() => parseIndirectionArgs(['report', '--nope'])).toThrow(/unknown flag/);
    });

    it('accepts report with --json', () => {
      expect(parseIndirectionArgs(['report', '--json'])).toEqual({ sub: 'report', json: true });
    });
  });

  describe('renderReport', () => {
    it('names the excess sum, the percentiles and every flagged row', async () => {
      const r = await measureIndirection({ roots: ['.'], cwd: treeDir('chain'), threshold: 2 });
      if (r.kind !== 'measured') throw new Error(r.kind);
      const text = renderReport(r);
      expect(text).toContain('excess sum: 1');
      expect(text).toContain('p50=1');
      expect(text).toContain('max=3');
      expect(text).toContain('a.ts');
      expect(text).toContain('closure=3');
    });

    it('says so plainly when the corpus is empty', async () => {
      const r = await measureIndirection({ roots: ['.'], cwd: treeDir('empty') });
      expect(renderReport(r)).toContain('no source files');
    });

    it('lists unresolved in-scope imports and not bare ones', async () => {
      const r = await measureIndirection({ roots: ['.'], cwd: treeDir('unresolved') });
      if (r.kind !== 'measured') throw new Error(r.kind);
      expect(r.unresolvedInScope).toHaveLength(1);
      expect(renderReport(r)).toContain('./does-not-exist.js');
      expect(renderReport(r)).not.toContain('no-such-package-anywhere');
    });
  });

  describe('runIndirection report', () => {
    it('exits 0 on a measurable tree', async () => {
      expect(await runIndirection(['report'], treeDir('chain'))).toBe(0);
    });

    it('exits 0 on an empty tree', async () => {
      expect(await runIndirection(['report'], treeDir('empty'))).toBe(0);
    });

    it('exits 3 on a usage error', async () => {
      expect(await runIndirection(['nope'], treeDir('chain'))).toBe(3);
    });

    it('--json emits a parseable payload carrying the ratchet number', async () => {
      const { code, out } = await capture(() =>
        runIndirection(['report', '--json'], treeDir('chain')),
      );
      expect(code).toBe(0);
      const parsed = JSON.parse(out) as { kind: string; excessSum: number };
      expect(parsed.kind).toBe('measured');
      expect(parsed.excessSum).toBe(0);
    });

    it('emits byte-identical output across two runs on an unchanged tree', async () => {
      const a = await capture(() => runIndirection(['report'], treeDir('chain')));
      const b = await capture(() => runIndirection(['report'], treeDir('chain')));
      expect(a.out).toBe(b.out);
    });
  });
  ```

- [ ] **Step 3: Run the test to verify it FAILS.**

  ```bash
  pnpm vitest run src/indirection/__tests__/indirection-cli.test.ts
  ```
  Expected output: failure with `Failed to resolve import "../indirection-cli.js"`.

- [ ] **Step 4: Implement the report-only CLI.**

  `src/indirection/indirection-cli.ts`:
  ```ts
  /**
   * `noldor indirection report [--json]`
   *
   * Exit contract: 0 when the corpus was measured (or is legitimately empty),
   * 3 when it could not be measured — no usable parser, or source files on disk
   * that produced no graph. `report` never fails on a verdict, only on being
   * unable to look, which keeps it usable as a diagnostic in exactly the states
   * where the gate added in part 2 is red.
   *
   * `check` and `baseline` land in part 2; the parser rejects them here rather
   * than accepting and ignoring them.
   */
  import { join } from 'node:path';

  import { runIfDirect } from '../core/cli-entry.js';
  import { scanRoots } from '../core/repo-paths.js';
  import { measureIndirection } from './detect.js';
  import type { IndirectionResult } from './detect.js';

  export interface IndirectionArgs {
    sub: 'report';
    json: boolean;
  }

  class UsageError extends Error {}

  export function parseIndirectionArgs(argv: string[]): IndirectionArgs {
    const [sub, ...rest] = argv;
    if (sub !== 'report') {
      throw new UsageError('usage: noldor indirection report [--json]');
    }
    const args: IndirectionArgs = { sub, json: false };
    for (const flag of rest) {
      if (flag === '--json') args.json = true;
      else throw new UsageError(`unknown flag: ${flag}`);
    }
    return args;
  }

  export function renderReport(result: IndirectionResult): string {
    switch (result.kind) {
      case 'empty':
        return 'indirection: no source files under the scan roots';
      case 'no-parser':
      case 'unmeasurable':
        return `indirection: ${result.message}`;
      case 'measured': {
        const p = result.percentiles;
        const lines = [
          `indirection excess sum: ${result.excessSum} (threshold ${result.threshold}, ` +
            `${result.flagged.length} flagged of ${result.modules.length} modules)`,
          `  closure p50=${p.p50} p75=${p.p75} p90=${p.p90} p99=${p.p99} max=${p.max}`,
        ];
        for (const m of result.flagged) {
          lines.push(`  ${m.source}  closure=${m.closure} excess=${m.excess}`);
        }
        if (result.unresolvedInScope.length > 0) {
          lines.push(
            `  WARNING: ${result.unresolvedInScope.length} unresolved in-scope import(s) — ` +
              `the excess sum above is understated`,
          );
          for (const u of result.unresolvedInScope) lines.push(`  unresolved: ${u}`);
        }
        return lines.join('\n');
      }
    }
  }

  export async function runIndirection(argv: string[], cwd: string = process.cwd()): Promise<number> {
    let args: IndirectionArgs;
    try {
      args = parseIndirectionArgs(argv);
    } catch (e) {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      return 3;
    }

    const result = await measureIndirection({ roots: scanRoots(cwd), cwd });

    if (result.kind === 'no-parser' || result.kind === 'unmeasurable') {
      // Rendered, not hand-formatted, so renderReport's failure branches are
      // reachable from a caller rather than dead code.
      process.stderr.write(`${renderReport(result)}\n`);
      return 3;
    }

    process.stdout.write(args.json ? `${JSON.stringify(result)}\n` : `${renderReport(result)}\n`);
    return 0;
  }

  runIfDirect('indirection-cli', 'indirection', runIndirection);
  ```

  Note `scanRoots(cwd)` is passed straight through — it already returns roots **relative** to the repo root, which is exactly what `measureIndirection` wants. Joining `cwd` onto them is the `ENOENT` bug from Task 1 Step 5.

- [ ] **Step 5: Run the test to verify it PASSES.**

  ```bash
  pnpm vitest run src/indirection
  ```
  Expected output: `Test Files  2 passed (2)`.

- [ ] **Step 6: Typecheck.**

  ```bash
  pnpm typecheck
  ```
  Expected output: no errors (exit 0).

- [ ] **Step 7: Commit.**

  ```bash
  cat > /tmp/indirection-p1t2.txt <<'MSG'
  feat(indirection): add the report subcommand

  Renders the excess sum, the closure percentiles and one row per flagged
  module, sorted by closure descending with the path as tiebreak so two runs on
  an unchanged tree are byte-identical and diffable. Exits 3 only when the
  corpus could not be measured, never on a verdict, which keeps report usable as
  a diagnostic in exactly the states where the gate added in part 2 is red. The
  switch over the result union has no default branch, so a future member is a
  compile error rather than a silent fallthrough.

  Noldor-FD: abstraction-cost-ratchet
  MSG
  git add src/indirection
  git commit -F /tmp/indirection-p1t2.txt
  ```

---

## Task 3: Register the command

**Files:**
- Modify: `src/cli/manifest.ts`
- Modify: `docs/noldor/script-catalog.md`

Both descriptions name **`report` only**. Part 1 rejects `check` and `baseline`, and advertising a subcommand the parser refuses is a lie the catalog would carry until part 2 lands. Part 2's Task 3 widens both.

- [ ] **Step 1: Add the manifest leaf.**

  In `src/cli/manifest.ts`, directly after the `clones: { … },` block, insert:
  ```ts
    indirection: {
      desc: 'Transitive-import-closure indirection measurement',
      subs: {
        '': {
          src: 'indirection/indirection-cli.ts',
          desc: 'indirection report [--json]',
        },
      },
    },
  ```

- [ ] **Step 2: Add the twin catalog entry.**

  In `docs/noldor/script-catalog.md`, beside the `pnpm noldor clones` row, add:
  ```markdown
  | `pnpm noldor indirection`                | [`src/indirection/indirection-cli.ts`](../../src/indirection/indirection-cli.ts) | `indirection report [--json]` per-module transitive-closure indirection measurement. |
  ```

- [ ] **Step 3: Verify the gate that would otherwise block the commit.**

  ```bash
  pnpm noldor validate script-catalog
  ```
  Expected output: exit 0. This gate is a pre-commit job globbed on exactly these two files (`lefthook/noldor.yml:86-88`) and blocks on any manifest leaf whose `src` path no catalog link reaches.

- [ ] **Step 4: Commit.**

  ```bash
  cat > /tmp/indirection-t4.txt <<'MSG'
  feat(indirection): register the command in the manifest and script catalog

  Both descriptions name report only, because that is all part 1 accepts —
  advertising check and baseline before the parser takes them would put a lie in
  the catalog until part 2 lands.

  Noldor-FD: abstraction-cost-ratchet
  MSG
  git add src/cli/manifest.ts docs/noldor/script-catalog.md
  git commit -F /tmp/indirection-t4.txt
  ```

---

## Task 4: Edge-case coverage

Closes the acceptance criteria the happy path does not reach: edge semantics, and the deep-aggregator case registry immunity does **not** cover. Tests come before the fixture they measure is wired into any assertion, keeping the TDD order intact.

**Files:**
- Create: `src/indirection/__tests__/trees/edges/{root,typed,dyn,leaf}.ts`, `helper.spec.ts`, `skip.d.ts`
- Create: `src/indirection/__tests__/trees/deep-registry/{aggregator,member}.ts` + `dep1..dep32.ts`
- Modify: `src/indirection/__tests__/detect.test.ts`

- [ ] **Step 1: Write the edge-semantics fixture.**

  `.../trees/edges/leaf.ts` — `export const leaf = 1;`
  `.../trees/edges/typed.ts` — `export interface Shape { readonly n: number; }`
  `.../trees/edges/dyn.ts` — `export const dyn = 2;`
  `.../trees/edges/helper.spec.ts` — `export const helper = 3;` (a test file; must be excluded)
  `.../trees/edges/skip.d.ts` — `export declare const skipped: number;` (a declaration; must be excluded)

  `.../trees/edges/root.ts`:
  ```ts
  import type { Shape } from './typed.js';
  import { leaf } from './leaf.js';

  export const load = async (): Promise<unknown> => (await import('./dyn.js')).dyn;
  export const root = (s: Shape): number => s.n + leaf;
  ```

- [ ] **Step 2: Generate the deep-registry fixture.**

  34 files, so generate rather than hand-write:
  ```bash
  mkdir -p src/indirection/__tests__/trees/deep-registry
  node -e 'const{writeFileSync:w}=require("node:fs");const d="src/indirection/__tests__/trees/deep-registry/";const n=[...Array(32)].map((_,i)=>i+1);for(const i of n)w(d+`dep${i}.ts`,`export const d${i} = ${i};\n`);w(d+"aggregator.ts",n.map(i=>`import { d${i} } from "./dep${i}.js";`).join("\n")+`\n\nexport const all = [${n.map(i=>"d"+i).join(", ")}];\n`);w(d+"member.ts",`import { all } from "./aggregator.js";\nexport const member = all.length;\n`)'
  ls src/indirection/__tests__/trees/deep-registry | wc -l
  ```
  Expected output: `34`.

- [ ] **Step 2b: Write the cycle and tie fixtures.**

  `.../trees/cycle/x.ts` — `import { y } from './y.js';\nexport const x = (): unknown => y;`
  `.../trees/cycle/y.ts` — `import { x } from './x.js';\nexport const y = (): unknown => x;`
  `.../trees/cycle/self.ts` — `export const self = 1;`

  `.../trees/tie/{p,q}.ts` — each `import { r } from './r.js';\nexport const … = r;` (two modules with identical closures, so the path tiebreak is the only thing ordering them)
  `.../trees/tie/r.ts` — `export const r = 1;`

  Both trees get the same `.noldor/config.json` as the others.

- [ ] **Step 3: Append the coverage tests.**

  Append to `src/indirection/__tests__/detect.test.ts`:
  ```ts
  describe('edge semantics', () => {
    it('counts type-only and literal dynamic edges, skips tests and declarations', async () => {
      const r = await measureIndirection(tree('edges'));
      if (r.kind !== 'measured') throw new Error(r.kind);
      expect(r.modules.map((m) => m.source).sort()).toEqual([
        'dyn.ts',
        'leaf.ts',
        'root.ts',
        'typed.ts',
      ]);
      // typed.ts (import type) + leaf.ts (static) + dyn.ts (literal dynamic import)
      expect(r.modules.find((m) => m.source === 'root.ts')?.closure).toBe(3);
    });
  });

  describe('cycles', () => {
    it('counts every member of a cycle once, and never the module itself', async () => {
      const r = await measureIndirection(tree('cycle'));
      if (r.kind !== 'measured') throw new Error(r.kind);
      // x -> y -> x: each reaches exactly the other, and `seen.delete(id)` is
      // what keeps a module out of its own closure when the cycle returns to it.
      expect(r.modules.find((m) => m.source === 'x.ts')?.closure).toBe(1);
      expect(r.modules.find((m) => m.source === 'y.ts')?.closure).toBe(1);
      expect(r.modules.find((m) => m.source === 'self.ts')?.closure).toBe(0);
    });
  });

  describe('deterministic ordering', () => {
    it('breaks a closure tie by path ascending', async () => {
      // The chain fixture cannot prove this — every closure there differs, so
      // reversing or deleting the tiebreak would not change its order.
      const r = await measureIndirection(tree('tie'));
      if (r.kind !== 'measured') throw new Error(r.kind);
      const tied = r.modules.filter((m) => m.closure === 1).map((m) => m.source);
      expect(tied).toEqual(['p.ts', 'q.ts']);
    });
  });

  describe('failure contract', () => {
    it('returns no-parser — not a throw — when no TypeScript parser is available', async () => {
      const r = await measureIndirection({
        ...tree('chain'),
        extensions: [
          { extension: '.ts', available: false },
          { extension: '.tsx', available: false },
        ],
      });
      expect(r.kind).toBe('no-parser');
      if (r.kind !== 'no-parser') return;
      expect(r.extensions).toContain('.ts');
      expect(r.message).toContain('@swc/core');
    });
  });

  describe('deep aggregator', () => {
    it('flags an aggregator above the threshold while its 32 leaf members stay at zero', async () => {
      const r = await measureIndirection(tree('deep-registry'));
      if (r.kind !== 'measured') throw new Error(r.kind);
      const agg = r.modules.find((m) => m.source === 'aggregator.ts');
      expect(agg?.closure).toBe(32);
      expect(agg?.excess).toBe(32 - INDIRECTION_CLOSURE_THRESHOLD);
      // Registry immunity is conditional: the 32 leaf members cost nothing, the
      // aggregator does once its own closure passes the threshold.
      expect(r.modules.find((m) => m.source === 'dep1.ts')?.excess).toBe(0);
      // member.ts is NOT a cost-free member — it imports the aggregator, so it
      // inherits the whole closure (32 deps + the aggregator) and is itself deep.
      const mem = r.modules.find((m) => m.source === 'member.ts');
      expect(mem?.closure).toBe(33);
      expect(mem?.excess).toBe(33 - INDIRECTION_CLOSURE_THRESHOLD);
    });
  });
  ```

- [ ] **Step 4: Run the tests to verify they PASS.**

  ```bash
  pnpm vitest run src/indirection/__tests__/detect.test.ts
  ```
  Expected output: `Tests  11 passed (11)`. These exact numbers — closure 3 for `root.ts`, 32/2/0/33 for the deep registry — were produced by running this engine against these trees before the plan was written; a different result means the implementation diverged from Task 1.

- [ ] **Step 5: Commit.**

  ```bash
  cat > /tmp/indirection-p1t5.txt <<'MSG'
  test(indirection): cover edge semantics and the deep aggregator

  Adds the cases the happy path does not reach: type-only and literal dynamic
  edges counted, test and declaration files excluded, and an aggregator whose own
  closure exceeds the threshold — the one case registry immunity does not cover,
  since the aggregator reaches every member. Its members still cost nothing,
  which is the half of the claim that does hold.

  Noldor-FD: abstraction-cost-ratchet
  MSG
  git add src/indirection
  git commit -F /tmp/indirection-p1t5.txt
  ```

---

## Task 5: Part-1 quality gate

The preceding tasks each run one targeted test file. This runs everything the repo gates on, before part 2 builds on top.

**Files:** none — verification only.

- [ ] **Step 1: Run the repo's composite verification.**

  ```bash
  pnpm verify
  ```
  Expected output: exit 0. This is the single command the repo gates on — `lint && fmt:check && typecheck && test && triage validate --strict-refs` — so running its parts separately would silently omit the last one. (There is no `build:samples` script in this repo.) If `fmt:check` reports drift, run `pnpm fmt` and amend the offending task's commit rather than adding a formatting-only commit.

- [ ] **Step 2: Replay the push gates author-side.**

  ```bash
  pnpm noldor checks push-gates
  ```
  Expected output: exit 0. Replays lefthook itself, so the clone ratchet and template-sync are checked exactly as the push will. A fix landed here costs one commit; the same fix after the code-stage review also costs a receipt re-earn.

- [ ] **Step 3: Confirm the engine measures the live repo.**

  ```bash
  pnpm noldor indirection report | head -3
  ```
  Expected output: an excess sum **between 850 and 1000** across **at least 400** modules, and a percentile line whose `p90` is at or near 30. The pre-feature measurement was 882 across 404 modules; this feature adds three modules of its own, so a small rise is expected and a number outside that band means the scan roots or the exclusion resolved wrongly.

---
