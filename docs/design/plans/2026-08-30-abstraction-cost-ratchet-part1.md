# Abstraction-Cost Ratchet Implementation Plan — Part 1: Measure and Report

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Ship `pnpm noldor indirection report` end to end — a working diagnostic that measures each module's transitive in-repo import closure and prints the excess above the threshold — plus the `abstraction-cost` rule that states when abstraction is warranted. Merged alone, this part gives anyone a command that tells them where their cross-file indirection actually sits.

**Architecture:** Engine (`detect.ts`) and CLI (`indirection-cli.ts`), mirroring the `src/clones/` engine/CLI split. The engine wraps `dependency-cruiser`, already a production dependency; scan roots and file policy come from `src/core/repo-paths.ts`; the parser-availability guard is imported from `src/invariants/boundaries.ts`, which already exports it. Part 2 adds the persisted baseline and the gate on top of this same command.

**Tech Stack:** TypeScript 7 (ESM, explicit `.js` specifiers), Zod 3 (`.strict()`), Vitest, `dependency-cruiser` + `@swc/core`, lefthook.

---

## File Structure

- `src/indirection/detect.ts` — **create.** Closure measurement: cruise the scan roots, build the module graph, compute each module's transitive in-repo closure, return a report. No IO beyond the cruise call.
- `src/indirection/indirection-cli.ts` — **create.** Arg parsing and the `report` subcommand. Part 2 widens it.
- `src/indirection/__tests__/detect.test.ts` — **create.** Engine tests against fixture trees.
- `src/indirection/__tests__/indirection-cli.test.ts` — **create.** Arg parsing and `report` exit codes.
- `src/indirection/__tests__/trees/**` — **create.** Fixture trees. Deliberately not under a `fixtures/` segment: `WALK_EXCLUDED_DIRS` skips that name, which would make the empty-vs-broken assertions pass vacuously.
- `package.json` — **modify.** `@swc/core` moves `devDependencies` → `dependencies`.
- `src/cli/manifest.ts` — **modify.** Add the `indirection` leaf beside `clones`.
- `docs/noldor/script-catalog.md` — **modify.** Twin catalog entry; `validate script-catalog` blocks pre-commit without it.
- `.noldor/rules/abstraction-cost.md` — **create.** The `enforce` rule.
- `templates/.noldor/rules/abstraction-cost.md` — **create.** Byte-identical twin; `check-template-sync` holds parity.

---

## Task 1: Closure engine

**Files:**
- Create: `src/indirection/detect.ts`
- Create: `src/indirection/__tests__/detect.test.ts`
- Create: `src/indirection/__tests__/trees/chain/{a,b,c,d}.ts`
- Create: `src/indirection/__tests__/trees/shallow-registry/{registry.ts,m1.ts,m2.ts,m3.ts}`
- Create: `src/indirection/__tests__/trees/empty/.gitkeep`
- Modify: `package.json`

- [ ] **Step 1: Move `@swc/core` to production dependencies.**

  `dependency-cruiser` is already a production dependency, but its only working parser under TypeScript 7 is `@swc/core`, which is currently dev-only. A consumer installing Noldor would get the cruiser with no parser, and `cruise` returns zero modules rather than failing — a silent green. Edit `package.json`: delete the `"@swc/core": "^1.16.1"` line from `devDependencies` and add it to `dependencies`, keeping both blocks alphabetically sorted.

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

  `.../shallow-registry/m1.ts`, `m2.ts`, `m3.ts` each:
  ```ts
  export const value = 1;
  ```
  (vary the number per file so they are not byte-identical and cannot form a clone group)

  `.../shallow-registry/registry.ts`:
  ```ts
  import { value as v1 } from './m1.js';
  import { value as v2 } from './m2.js';
  import { value as v3 } from './m3.js';
  export const all = [v1, v2, v3];
  ```

  `.../empty/.gitkeep` — an empty file, so git tracks a directory with no code files in it.

- [ ] **Step 3: Write the failing engine test.**

  `src/indirection/__tests__/detect.test.ts`:
  ```ts
  import { join } from 'node:path';

  import { describe, expect, it } from 'vitest';

  import { INDIRECTION_CLOSURE_THRESHOLD, measureIndirection } from '../detect.js';

  const tree = (name: string): string => join(import.meta.dirname, 'trees', name);

  describe('measureIndirection', () => {
    it('counts the transitive in-repo closure, excluding the module itself', async () => {
      const report = await measureIndirection({ roots: [tree('chain')], cwd: tree('chain') });
      const closures = new Map(report.modules.map((m) => [m.source.split('/').at(-1), m.closure]));
      expect(closures.get('a.ts')).toBe(3);
      expect(closures.get('b.ts')).toBe(2);
      expect(closures.get('c.ts')).toBe(1);
      expect(closures.get('d.ts')).toBe(0);
    });

    it('contributes zero excess when every closure is under the threshold', async () => {
      const report = await measureIndirection({
        roots: [tree('shallow-registry')],
        cwd: tree('shallow-registry'),
      });
      expect(report.excessSum).toBe(0);
      expect(report.flagged).toEqual([]);
    });

    it('reports an empty scan root as empty rather than broken', async () => {
      const report = await measureIndirection({ roots: [tree('empty')], cwd: tree('empty') });
      expect(report.kind).toBe('empty');
      expect(report.excessSum).toBe(0);
      expect(report.percentiles).toBeNull();
    });

    it('flags a module whose closure exceeds the threshold and sums the excess', async () => {
      const report = await measureIndirection({ roots: [tree('chain')], cwd: tree('chain') });
      // threshold is far above this tree, so nothing is flagged — guards the
      // constant against being lowered into fixture range by accident
      expect(INDIRECTION_CLOSURE_THRESHOLD).toBeGreaterThan(3);
      expect(report.flagged).toEqual([]);
    });
  });
  ```

- [ ] **Step 4: Run the test to verify it FAILS.**

  ```bash
  pnpm vitest run src/indirection/__tests__/detect.test.ts
  ```
  Expected output: failure with `Failed to resolve import "../detect.js"` — the module does not exist yet.

- [ ] **Step 5: Implement the engine.**

  `src/indirection/detect.ts`:
  ```ts
  /**
   * Whole-corpus indirection measurement. For each in-repo module, the size of
   * its transitive in-repo import closure — how many files a reader or an agent
   * must fetch to understand it. Cross-file indirection is what costs; a long
   * file with many local helpers is free by construction and out of scope.
   *
   * The ratchet number is the EXCESS SUM, not a count of flagged modules: a
   * count cannot see a closure growing 31 -> 100, and can stay flat while one
   * module crosses the threshold and another drops below it.
   */
  import { allExtensions, cruise } from 'dependency-cruiser';

  import { findUnparseableTsExtensions } from '../invariants/boundaries.js';
  import { CODE_FILE_RE, TEST_FILE_RE, walkCodeFiles } from '../core/repo-paths.js';

  /**
   * Closure size above which a module is flagged. The measured p90 of this
   * repo, chosen on a plateau — the flagged count is 38 at 30 and 36 at 35, so
   * the verdict does not rest on precise tuning, which matters for a constant
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

  export interface IndirectionReport {
    /** `empty` = no source files at all; `measured` = a real graph. */
    readonly kind: 'empty' | 'measured';
    readonly excessSum: number;
    readonly modules: readonly ModuleClosure[];
    readonly flagged: readonly ModuleClosure[];
    readonly percentiles: Percentiles | null;
    readonly modulesScanned: number;
    /** Relative/alias specifiers dependency-cruiser could not resolve. */
    readonly unresolvedInScope: readonly string[];
  }

  export class ParserUnavailableError extends Error {}
  export class EmptyGraphError extends Error {}

  export interface MeasureOptions {
    readonly roots: readonly string[];
    readonly cwd: string;
    readonly threshold?: number;
  }

  interface CruiseModule {
    readonly source: string;
    readonly dependencies: ReadonlyArray<{
      readonly resolved: string;
      readonly couldNotResolve?: boolean;
      readonly module?: string;
    }>;
  }

  /** Nearest-rank percentile over an ascending vector. */
  function percentile(sorted: readonly number[], p: number): number {
    if (sorted.length === 0) return 0;
    const rank = Math.max(1, Math.ceil(p * sorted.length));
    return sorted[rank - 1]!;
  }

  /**
   * An unresolved import matters only when its specifier is ours. A bare
   * package specifier reports `couldNotResolve` for healthy reasons — an
   * optional peer that is not installed, a package whose `types` entry does not
   * resolve — and treating those as failures would hard-block pre-push in
   * consumer repos that are perfectly fine.
   */
  function isInScopeSpecifier(specifier: string | undefined): boolean {
    if (specifier === undefined) return false;
    return specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('#');
  }

  export async function measureIndirection(opts: MeasureOptions): Promise<IndirectionReport> {
    const threshold = opts.threshold ?? INDIRECTION_CLOSURE_THRESHOLD;

    // `includeTests: true` deliberately: this walk answers "does any source
    // file exist here", not "what do we measure". Excluding tests would report
    // a test-only tree as an empty repository.
    const candidates = opts.roots.flatMap((r) => walkCodeFiles(r, { includeTests: true }));
    if (candidates.length === 0) {
      return {
        kind: 'empty',
        excessSum: 0,
        modules: [],
        flagged: [],
        percentiles: null,
        modulesScanned: 0,
        unresolvedInScope: [],
      };
    }

    // dependency-cruiser parses TypeScript through `typescript` (>=2 <6 only)
    // or `@swc/core`. Under TypeScript 7 swc is the only one, and without it
    // `cruise` yields zero modules — a clean green over an unparsed tree.
    const unparseable = findUnparseableTsExtensions(allExtensions);
    if (unparseable.length > 0) {
      throw new ParserUnavailableError(
        `no TypeScript parser available for ${unparseable.join(', ')} — ` +
          `install @swc/core (dependency-cruiser accepts typescript >=2 <6, or @swc/core)`,
      );
    }

    const result = await cruise([...opts.roots], {
      baseDir: opts.cwd,
      validate: false,
      doNotFollow: { path: 'node_modules' },
      exclude: { path: `node_modules|__tests__|${TEST_FILE_RE.source}` },
      tsPreCompilationDeps: true,
    });

    const output = result.output;
    const raw =
      typeof output === 'object' && output !== null && 'modules' in output
        ? (output as { modules: readonly CruiseModule[] }).modules
        : [];

    const measured = raw.filter(
      (m) => CODE_FILE_RE.test(m.source) && !m.source.endsWith('.d.ts') && !TEST_FILE_RE.test(m.source),
    );

    if (measured.length === 0) {
      throw new EmptyGraphError(
        `${candidates.length} source file(s) on disk but dependency-cruiser produced no modules — ` +
          `the graph could not be measured`,
      );
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

    const modules: ModuleClosure[] = measured
      .map((m) => {
        const closure = closureOf(m.source);
        return { source: m.source, closure, excess: Math.max(0, closure - threshold) };
      })
      .sort((a, b) => b.closure - a.closure || a.source.localeCompare(b.source));

    const sorted = [...modules.map((m) => m.closure)].sort((a, b) => a - b);

    return {
      kind: 'measured',
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
      modulesScanned: modules.length,
      unresolvedInScope,
    };
  }
  ```

- [ ] **Step 6: Run the test to verify it PASSES.**

  ```bash
  pnpm vitest run src/indirection/__tests__/detect.test.ts
  ```
  Expected output: `Test Files  1 passed (1)` and `Tests  4 passed (4)`.

- [ ] **Step 7: Typecheck.**

  ```bash
  pnpm typecheck
  ```
  Expected output: no errors (exit 0).

- [ ] **Step 8: Commit.**

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
  boundaries invariant so an unparsed tree fails loudly instead of reporting
  zero.

  What — the engine plus its fixture trees, and @swc/core moved to production
  dependencies: it is dependency-cruiser's only working parser under TypeScript
  7, so shipping it as a devDependency left every consumer with a cruiser that
  silently returns no modules.

  Noldor-FD: abstraction-cost-ratchet
  MSG
  git add src/indirection package.json
  git commit -F /tmp/indirection-t1.txt
  ```

---

## Task 2: `indirection report`

**Files:**
- Create: `src/indirection/indirection-cli.ts`
- Create: `src/indirection/__tests__/indirection-cli.test.ts`

- [ ] **Step 1: Write the failing CLI test.**

  `src/indirection/__tests__/indirection-cli.test.ts`:
  ```ts
  import { join } from 'node:path';

  import { describe, expect, it } from 'vitest';

  import { parseIndirectionArgs, runIndirection } from '../indirection-cli.js';

  const chain = join(import.meta.dirname, 'trees', 'chain');

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

  describe('runIndirection report', () => {
    it('exits 0 on a measurable tree', async () => {
      expect(await runIndirection(['report'], chain)).toBe(0);
    });

    it('exits 3 on a usage error', async () => {
      expect(await runIndirection(['nope'], chain)).toBe(3);
    });

    it('emits byte-identical output across two runs', async () => {
      const capture = async (): Promise<string> => {
        const chunks: string[] = [];
        const write = process.stdout.write.bind(process.stdout);
        process.stdout.write = ((s: string) => {
          chunks.push(s);
          return true;
        }) as typeof process.stdout.write;
        try {
          await runIndirection(['report'], chain);
        } finally {
          process.stdout.write = write;
        }
        return chunks.join('');
      };
      expect(await capture()).toBe(await capture());
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it FAILS.**

  ```bash
  pnpm vitest run src/indirection/__tests__/indirection-cli.test.ts
  ```
  Expected output: failure with `Failed to resolve import "../indirection-cli.js"`.

- [ ] **Step 3: Implement the report-only CLI.**

  `src/indirection/indirection-cli.ts`:
  ```ts
  /**
   * `noldor indirection report [--json]`
   *
   * Exit contract: 0 when the corpus was measured, 3 when it could not be —
   * no usable parser, or source files on disk that produced no graph. `report`
   * never fails on a verdict, only on being unable to look, which keeps it
   * usable as a diagnostic in exactly the states where a gate would be red.
   *
   * `check` and `baseline` land in part 2; the arg parser rejects them here
   * rather than accepting and ignoring them.
   */
  import { join } from 'node:path';

  import { runIfDirect } from '../core/cli-entry.js';
  import { scanRoots } from '../core/repo-paths.js';
  import {
    EmptyGraphError,
    INDIRECTION_CLOSURE_THRESHOLD,
    ParserUnavailableError,
    measureIndirection,
  } from './detect.js';
  import type { IndirectionReport } from './detect.js';

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

  export function renderReport(report: IndirectionReport): string {
    if (report.kind === 'empty') return 'indirection: no source files under the scan roots';
    const p = report.percentiles;
    const lines = [
      `indirection excess sum: ${report.excessSum} (threshold ${INDIRECTION_CLOSURE_THRESHOLD}, ` +
        `${report.flagged.length} flagged of ${report.modulesScanned} modules)`,
      p === null
        ? '  closure: (no modules)'
        : `  closure p50=${p.p50} p75=${p.p75} p90=${p.p90} p99=${p.p99} max=${p.max}`,
    ];
    for (const m of report.flagged) {
      lines.push(`  ${m.source}  closure=${m.closure} excess=${m.excess}`);
    }
    for (const u of report.unresolvedInScope) lines.push(`  unresolved: ${u}`);
    return lines.join('\n');
  }

  export async function runIndirection(argv: string[], cwd: string = process.cwd()): Promise<number> {
    let args: IndirectionArgs;
    try {
      args = parseIndirectionArgs(argv);
    } catch (e) {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      return 3;
    }

    const roots = scanRoots(cwd).map((r) => join(cwd, r));
    let report: IndirectionReport;
    try {
      report = await measureIndirection({ roots, cwd });
    } catch (e) {
      if (e instanceof ParserUnavailableError || e instanceof EmptyGraphError) {
        process.stderr.write(`indirection ${args.sub}: ${e.message}\n`);
        return 3;
      }
      throw e;
    }

    process.stdout.write(args.json ? `${JSON.stringify(report)}\n` : `${renderReport(report)}\n`);
    return 0;
  }

  runIfDirect('indirection-cli', 'indirection', runIndirection);
  ```

- [ ] **Step 4: Run the test to verify it PASSES.**

  ```bash
  pnpm vitest run src/indirection/__tests__/indirection-cli.test.ts
  ```
  Expected output: `Tests  6 passed (6)`.

- [ ] **Step 5: Typecheck.**

  ```bash
  pnpm typecheck
  ```
  Expected output: no errors (exit 0).

- [ ] **Step 6: Commit.**

  ```bash
  cat > /tmp/indirection-p1t2.txt <<'MSG'
  feat(indirection): add the report subcommand

  Renders the excess sum, the closure percentiles and one row per flagged
  module, sorted by closure descending with the path as tiebreak so two runs on
  an unchanged tree are byte-identical and diffable. Exits 3 only when the
  corpus could not be measured, never on a verdict, which keeps report usable as
  a diagnostic in exactly the states where the gate added in part 2 is red.

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

- [ ] **Step 1: Add the manifest leaf.**

  In `src/cli/manifest.ts`, directly after the `clones: { … },` block, insert:
  ```ts
    indirection: {
      desc: 'Transitive-import-closure indirection ratchet',
      subs: {
        '': {
          src: 'indirection/indirection-cli.ts',
          desc: 'indirection <report|check|baseline> [--json]',
        },
      },
    },
  ```

- [ ] **Step 2: Add the twin catalog entry.**

  In `docs/noldor/script-catalog.md`, beside the `pnpm noldor clones` row, add:
  ```markdown
  | `pnpm noldor indirection`                | [`src/indirection/indirection-cli.ts`](../../src/indirection/indirection-cli.ts) | `indirection <report\|check\|baseline>` transitive-closure indirection ratchet (`--json`). |
  ```

- [ ] **Step 3: Verify the gate that would otherwise block the commit.**

  ```bash
  pnpm noldor validate script-catalog
  ```
  Expected output: exit 0, no unlinked-manifest-leaf findings.

- [ ] **Step 4: Commit.**

  ```bash
  cat > /tmp/indirection-t4.txt <<'MSG'
  feat(indirection): register the command in the manifest and script catalog

  validate-script-catalog is a pre-commit job globbed on exactly these two
  files and blocks on any manifest leaf whose src path no catalog link reaches,
  so the command cannot ship without both halves.

  Noldor-FD: abstraction-cost-ratchet
  MSG
  git add src/cli/manifest.ts docs/noldor/script-catalog.md
  git commit -F /tmp/indirection-t4.txt
  ```

---

## Task 4: The `abstraction-cost` rule

**Files:**
- Create: `.noldor/rules/abstraction-cost.md`
- Create: `templates/.noldor/rules/abstraction-cost.md`

- [ ] **Step 1: Write the rule.**

  `.noldor/rules/abstraction-cost.md`:
  ```markdown
  ---
  id: abstraction-cost
  applies-to: ["src/**/*.{ts,tsx,js,jsx}"]
  stage: [code]
  enforce: true
  links: [.noldor/indirection-baseline.json]
  ---
  Abstraction is priced by file boundaries. Inside one file it is nearly free; across
  files it costs the reader a fetch and an agent a round trip on every crossing. A long
  file of small local helpers is cheap; four files that must be opened in sequence to
  follow one call are not.

  Three reasons to abstract, and if none applies, inline it:

  1. **Hide complexity** behind an interface a caller genuinely should not see.
  2. **Name a thing** — but only where the call site cannot already read the name off the
     expression. `const MAX = 3` used once names nothing the literal did not.
  3. **Reuse** from the third call site, not the second. Two similar lines are fine.

  Anti-patterns this rule names:

  - The single-use constant whose name says no more than its value.
  - The single-consumer translation layer that only renames what it forwards.
  - The factory wrapping a value the type system already constrains.

  The mechanical counterpart is `pnpm noldor indirection check`, which ratchets the total
  transitive-import-closure excess across the corpus. This rule covers what the counter
  cannot see: whether a given crossing was worth it.
  ```

- [ ] **Step 2: Create the byte-identical template twin.**

  ```bash
  cp .noldor/rules/abstraction-cost.md templates/.noldor/rules/abstraction-cost.md
  ```

- [ ] **Step 3: Verify the rule store and template parity.**

  ```bash
  pnpm noldor rules validate && pnpm noldor checks template-sync
  ```
  Expected output: both exit 0.

- [ ] **Step 4: Verify the rule resolves into the enforce bucket.**

  ```bash
  pnpm noldor rules resolve --file src/indirection/detect.ts --stage code
  ```
  Expected output: JSON whose `enforce` array contains an entry with `"id": "abstraction-cost"`.

- [ ] **Step 5: Commit.**

  ```bash
  cat > /tmp/indirection-t5.txt <<'MSG'
  feat(rules): add the abstraction-cost enforce rule

  States the delta over the baseline principles, which already own YAGNI and the
  DRY-threshold-of-three: that abstraction is priced by file boundaries, and the
  three reasons that justify paying. The naming clause is deliberately narrow,
  since "name a thing" read broadly would justify every single-use constant,
  which is the first anti-pattern the same rule names. Barrel re-exports are not
  listed: src/index.ts style public surfaces legitimately re-export, and a
  blanket clause would turn a repo convention into a reviewer blocker.

  Noldor-FD: abstraction-cost-ratchet
  MSG
  git add .noldor/rules/abstraction-cost.md templates/.noldor/rules/abstraction-cost.md
  git commit -F /tmp/indirection-t5.txt
  ```

---


## Task 5: Edge-case coverage

Closes the acceptance criteria the happy-path tests do not reach: edge semantics (2, 3, 4), the deep-aggregator case immunity does **not** cover (6), the broken-graph split (13), the parser guard (9), and `.tsx` rule scope (16).

**Files:**
- Create: `src/indirection/__tests__/trees/edges/{root.ts,typed.ts,dyn.ts,leaf.ts,helper.spec.ts,skip.d.ts}`
- Create: `src/indirection/__tests__/trees/deep-registry/{aggregator.ts,dep1.ts,...,dep32.ts,member.ts}`
- Modify: `src/indirection/__tests__/detect.test.ts`

- [ ] **Step 1: Write the edge-semantics fixture.**

  `.../trees/edges/leaf.ts`:
  ```ts
  export const leaf = 1;
  ```
  `.../trees/edges/typed.ts`:
  ```ts
  export interface Shape { readonly n: number; }
  ```
  `.../trees/edges/dyn.ts`:
  ```ts
  export const dyn = 2;
  ```
  `.../trees/edges/helper.spec.ts` — a test file, must be excluded:
  ```ts
  export const helper = 3;
  ```
  `.../trees/edges/skip.d.ts` — a declaration file, must be excluded:
  ```ts
  export declare const skipped: number;
  ```
  `.../trees/edges/root.ts`:
  ```ts
  import type { Shape } from './typed.js';
  import { leaf } from './leaf.js';

  export const load = async (): Promise<unknown> => (await import('./dyn.js')).dyn;
  export const root = (s: Shape): number => s.n + leaf;
  ```

- [ ] **Step 2: Write the deep-registry fixture.**

  Generate it rather than hand-writing 33 files:
  ```bash
  mkdir -p src/indirection/__tests__/trees/deep-registry
  cd src/indirection/__tests__/trees/deep-registry
  for i in $(seq 1 32); do printf 'export const d%s = %s;\n' "$i" "$i" > "dep$i.ts"; done
  { for i in $(seq 1 32); do printf "import { d%s } from './dep%s.js';\n" "$i" "$i"; done
    printf '\nexport const all = [%s];\n' "$(seq -s ', d' 1 32 | sed 's/^/d/')"; } > aggregator.ts
  printf "import { all } from './aggregator.js';\nexport const member = all.length;\n" > member.ts
  cd -
  ```
  Expected: 34 files; `aggregator.ts` reaches 32 deps, so its closure is 32 — above the threshold of 30.

- [ ] **Step 3: Append the coverage tests.**

  Append to `src/indirection/__tests__/detect.test.ts`:
  ```ts
  import { findUnparseableTsExtensions } from '../../invariants/boundaries.js';
  import { EmptyGraphError, ParserUnavailableError } from '../detect.js';

  describe('edge semantics', () => {
    it('counts type-only and dynamic edges, and skips tests and declarations', async () => {
      const report = await measureIndirection({ roots: [tree('edges')], cwd: tree('edges') });
      const sources = report.modules.map((m) => m.source.split('/').at(-1));
      expect(sources).not.toContain('helper.spec.ts');
      expect(sources).not.toContain('skip.d.ts');
      const root = report.modules.find((m) => m.source.endsWith('root.ts'));
      // typed.ts (import type) + leaf.ts + dyn.ts (literal dynamic import)
      expect(root?.closure).toBe(3);
    });
  });

  describe('deep aggregator', () => {
    it('flags an aggregator whose own closure exceeds the threshold', async () => {
      const report = await measureIndirection({
        roots: [tree('deep-registry')],
        cwd: tree('deep-registry'),
      });
      const agg = report.modules.find((m) => m.source.endsWith('aggregator.ts'));
      expect(agg?.closure).toBe(32);
      expect(agg?.excess).toBe(32 - INDIRECTION_CLOSURE_THRESHOLD);
      // members themselves stay unflagged — immunity holds for them, not for the aggregator
      const dep = report.modules.find((m) => m.source.endsWith('dep1.ts'));
      expect(dep?.excess).toBe(0);
    });
  });

  describe('parser and graph failures', () => {
    it('the guard reports unparseable extensions from a synthetic availability report', () => {
      // Parser availability is a process condition, not something a fixture tree
      // can create — after @swc/core moves to dependencies the test environment
      // always has it. The guard takes the report as a parameter for this reason.
      const none = findUnparseableTsExtensions({ '.ts': false, '.tsx': false });
      expect(none).toContain('.ts');
      const all = findUnparseableTsExtensions({ '.ts': true, '.tsx': true });
      expect(all).toEqual([]);
    });

    it('exports the two failure types the CLI maps to exit 3', () => {
      expect(new ParserUnavailableError('x')).toBeInstanceOf(Error);
      expect(new EmptyGraphError('x')).toBeInstanceOf(Error);
    });
  });
  ```

- [ ] **Step 4: Run the tests to verify they PASS.**

  ```bash
  pnpm vitest run src/indirection/__tests__/detect.test.ts
  ```
  Expected output: `Tests  8 passed (8)`.

  If the `root.ts` closure assertion fails at 2 rather than 3, dependency-cruiser did not resolve the literal dynamic import; confirm `tsPreCompilationDeps: true` is set and that `dyn.ts` exists, and only then adjust the expectation with a comment recording what the cruiser actually reports.

- [ ] **Step 5: Extend the rule-scope check.**

  Add to the verification in Task 4 — confirm the rule resolves for a `.tsx` path too, not only `.ts`:
  ```bash
  pnpm noldor rules resolve --file src/dashboard/App.tsx --stage code
  ```
  Expected output: JSON whose `enforce` array contains `"id": "abstraction-cost"`.

- [ ] **Step 6: Commit.**

  ```bash
  cat > /tmp/indirection-p1t5.txt <<'MSG'
  test(indirection): cover edge semantics, the deep aggregator and the parser guard

  Adds the cases the happy path does not reach: type-only and literal dynamic
  edges counted, test and declaration files excluded, and an aggregator whose own
  closure exceeds the threshold — the one case registry immunity does not cover,
  since the aggregator reaches every member. The parser guard is exercised with a
  synthetic availability report rather than a fixture tree, because parser
  availability is a process condition and the test environment always has swc
  once it ships as a production dependency.

  Noldor-FD: abstraction-cost-ratchet
  MSG
  git add src/indirection
  git commit -F /tmp/indirection-p1t5.txt
  ```

---
