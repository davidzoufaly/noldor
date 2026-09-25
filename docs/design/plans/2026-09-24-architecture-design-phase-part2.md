# pen.dev Architecture Design Phase Implementation Plan — Part 2: arrows backed by imports

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** `pnpm noldor checks arch-baseline` also holds every arrow on the `modules` view to the code.
- An arrow with no import behind it is a `phantom-edge` finding (exit 1).
- An import that no arrow shows is an advisory `undrawn-edge` row (exit unchanged).

**Architecture:** the pairs come from the same file graph the indirection ratchet measures, so there is one corpus rule for both: tests excluded, tsconfig aliases resolved, partial cruises refused. The graph also carries the in-repo imports cruise could not resolve. The ratchet only reports them, but `moduleImportPairs` refuses the graph instead, because a broken import silently drops a real pair and would turn a correctly drawn arrow into a `phantom-edge`.
- **`cruiseFileGraph`:** the cruise-and-verify head of `measureIndirection` in `src/indirection/detect.ts` moves, unchanged, into this exported function.
- **`moduleImportPairs`:** `src/indirection/module-pairs.ts` maps that graph to `from -> to` module pairs.
- **The arrow rules:** `src/design/arch-check.ts` gains them.
- **Wiring:** `src/design/arch-baseline.ts` gathers the pairs.
- **`pairKey`:** the one spelling that arrow names and pairs share. It lives in the leaf `src/design/arch-pen.ts`, so the pure rules never import the cruise.

**Tech Stack:** TypeScript (ESM, Node >= 24), vitest, dependency-cruiser.

**Parts:** 2 of 9. Part 1 shipped `checks arch-baseline` with module coverage. Part 3 adds the release row and this repo's baseline.

---

## File Structure

- `src/design/arch-pen.ts` — **Modify.** Adds `pairKey(from, to)`.
- `src/indirection/detect.ts` — **Modify.** Exports `CruiseDep`, `CruiseModule`, `FileGraphOptions`, `FileGraphResult` and `cruiseFileGraph`; `measureIndirection` now calls `cruiseFileGraph`. Behaviour is unchanged.
- `src/indirection/module-pairs.ts` — **Create.** Holds `moduleOf`, `pairsFromFiles` and `moduleImportPairs`.
- `src/indirection/__tests__/module-pairs.test.ts` — **Create.** Covers the pure pair builder and one real cruise.
- `src/indirection/__tests__/trees/modules/src/**` — **Create.** The fixture: three modules, one import internal to a module, one file at the root, and one excluded spec file.
- `src/design/arch-check.ts` — **Replace.** `checkArchDoc(doc, modules, pairs)` adds `phantom-edge` findings and `undrawn-edge` advisories.
- `src/design/__tests__/arch-check.test.ts` — **Replace.** The Part 1 cases plus the arrow rules.
- `src/design/arch-baseline.ts` — **Replace.** Gathers the scan roots and pairs. An import graph that cannot be built becomes an `unreadable` finding.
- `src/checks/check-arch-baseline.ts` — **Replace.** Also renders the advisories.
- `src/checks/__tests__/check-arch-baseline.test.ts` — **Modify.** Adds the phantom-arrow case.
- `docs/noldor/script-catalog.md` + `templates/docs/noldor/script-catalog.md` — **Modify.** The `check:arch-baseline` entry now names the import pairs, `phantom-edge` and `undrawn-edge`.

---

## Task 1: Module import pairs

**Files:**

- Modify: `src/design/arch-pen.ts`
- Modify: `src/indirection/detect.ts`
- Create: `src/indirection/module-pairs.ts`
- Create: under `src/indirection/__tests__/trees/modules/`: `src/a/x.ts`, `src/a/z.ts`, `src/b/y.ts`, `src/b/y.spec.ts`, `src/c/w.ts`, `src/index.ts`
- Test: `src/indirection/__tests__/module-pairs.test.ts`; `src/indirection/__tests__/detect.test.ts` stays unchanged and is the regression net for the move

The fixture's spec file is named `.spec.ts` on purpose. vitest collects every `src/**/__tests__/**/*.test.ts`, so a fixture named `.test.ts` would run as a suite; the cruise excludes both suffixes.

- [ ] **Step 1: Write the fixture tree.**

  Create each file with exactly this content. Every path is under `src/indirection/__tests__/trees/modules/`.

  `src/a/x.ts`:
  ```ts
  import { y } from '../b/y.js';
  import { z } from './z.js';

  export const x = (): string => y() + z();
  ```

  `src/a/z.ts`:
  ```ts
  export const z = (): string => 'z';
  ```

  `src/b/y.ts`:
  ```ts
  export const y = (): string => 'y';
  ```

  `src/b/y.spec.ts` (the `// @tests:` tag is required: the test-tag gate matches every `*.spec.ts`):
  ```ts
  // @tests: architecture-design-phase
  // Fixture, not a real test: a spec file the cruise must exclude, so its import
  // never becomes a `src/b -> src/c` pair. The tag is required because the
  // test-tag gate matches on the filename pattern, which this file must keep.
  import { w } from '../c/w.js';

  export const probe = w;
  ```

  `src/c/w.ts`:
  ```ts
  import { x } from '../a/x.js';

  export const w = (): string => x();
  ```

  `src/index.ts`:
  ```ts
  import { x } from './a/x.js';

  export const main = x;
  ```

- [ ] **Step 2: Write the failing test file.**

  Create `src/indirection/__tests__/module-pairs.test.ts`:

  ```ts
  // @tests: architecture-design-phase
  import { join } from 'node:path';

  import { describe, expect, it } from 'vitest';

  import { moduleImportPairs, moduleOf, pairsFromFiles } from '../module-pairs.js';

  const MODULES = ['src/a', 'src/b', 'src/c'];
  const FIXTURE = join(import.meta.dirname, 'trees', 'modules');

  describe('module-pairs', () => {
    it('maps a file to the module path that prefixes it', () => {
      expect(moduleOf('src/a/x.ts', MODULES)).toBe('src/a');
      expect(moduleOf('src/index.ts', MODULES)).toBeNull();
      expect(moduleOf('src/ab/x.ts', MODULES)).toBeNull();
    });

    it('keeps cross-module imports and drops imports inside one module', () => {
      const files = [
        { source: 'src/a/x.ts', dependencies: [{ resolved: 'src/b/y.ts' }, { resolved: 'src/a/z.ts' }] },
        { source: 'src/c/w.ts', dependencies: [{ resolved: 'src/a/x.ts' }, { resolved: 'node_modules/zod/index.js' }] },
      ];
      expect([...pairsFromFiles(files, MODULES)].sort()).toEqual(['src/a -> src/b', 'src/c -> src/a']);
    });

    it('reads the pairs off a real cruise, spec files excluded', async () => {
      const result = await moduleImportPairs(FIXTURE, ['src'], MODULES);
      expect(result.kind).toBe('pairs');
      if (result.kind === 'pairs') expect([...result.pairs].sort()).toEqual(['src/a -> src/b', 'src/c -> src/a']);
    });

    it('reports a graph it cannot build rather than an empty one', async () => {
      expect(await moduleImportPairs(FIXTURE, ['no-such-root'], MODULES)).toMatchObject({ kind: 'unmeasurable' });
    });

    it('refuses a graph with an in-repo import it could not resolve', async () => {
      const unresolved = join(import.meta.dirname, 'trees', 'unresolved');
      expect(await moduleImportPairs(unresolved, ['.'], [])).toMatchObject({
        kind: 'unmeasurable',
        message: expect.stringContaining('does-not-exist'),
      });
    });
  });
  ```

- [ ] **Step 3: Run the test to verify it fails.**

  Run: `pnpm vitest run src/indirection/__tests__/module-pairs.test.ts`
  Expected: FAIL — `Failed to resolve import "../module-pairs.js"`.

- [ ] **Step 4: Add `pairKey` to the reader.**

  In `src/design/arch-pen.ts`, directly after `arrowEndsOf`, add:

  ```ts
  /** `from -> to` — the one spelling arrow names and module import pairs share. */
  export function pairKey(from: string, to: string): string {
    return `${from} -> ${to}`;
  }
  ```

- [ ] **Step 5: Export the cruise shapes.**

  In `src/indirection/detect.ts`, put `export` in front of `interface CruiseDep` and `interface CruiseModule`. Leave their bodies unchanged.

- [ ] **Step 6: Move the cruise-and-verify head into `cruiseFileGraph`.**

  In `src/indirection/detect.ts`, make these edits in order.

  1. Directly above `export async function measureIndirection(opts: MeasureOptions): Promise<IndirectionResult> {`, insert:

  ```ts
  /** What {@link cruiseFileGraph} reads — {@link MeasureOptions} minus the threshold. */
  export type FileGraphOptions = Pick<MeasureOptions, 'roots' | 'cwd' | 'extensions'>;

  /**
   * The verified in-repo file graph, or why there is none. `files` is complete by
   * construction: a cruise that reports fewer files than the walker offers is
   * `unmeasurable`, never a partial graph.
   */
  export type FileGraphResult =
    | { readonly kind: 'empty' }
    | {
        readonly kind: 'graph';
        /** `cwd` with symlinks resolved — every `source` is relative to it. */
        readonly base: string;
        /** The requested roots that exist, deduplicated. */
        readonly roots: readonly string[];
        readonly files: readonly CruiseModule[];
        /** In-repo imports cruise could not resolve (see `isInScopeSpecifier`), as `<file> -> <specifier>`. */
        readonly unresolvedInScope: readonly string[];
      }
    | Extract<IndirectionResult, { kind: 'no-parser' | 'unmeasurable' }>;

  /**
   * Cruise the scan roots into the verified file graph every whole-corpus reader
   * shares: the indirection ratchet below, and the architecture baseline's
   * module pairs (`src/indirection/module-pairs.ts`).
   */
  export async function cruiseFileGraph(opts: FileGraphOptions): Promise<FileGraphResult> {
  ```

  2. Cut the body of `measureIndirection` between its first line (`const threshold = opts.threshold ?? INDIRECTION_CLOSURE_THRESHOLD;`) and the line `const byId = new Map(measured.map((m) => [m.source, m]));`. Both of those lines stay where they are. The cut runs from the comment `// Resolve symlinks before anything else.` through the closing `}` of the `if (measured.length < candidates.size) { … }` block. Paste the cut block, comments included, as the body of `cruiseFileGraph`. Then make two changes inside the pasted block:
     - Change `if (candidateAbs.length === 0) return { kind: 'empty', threshold };` to `if (candidateAbs.length === 0) return { kind: 'empty' };`.
     - After the pasted block, close the function with:

  ```ts
    const unresolvedInScope: string[] = [];
    for (const m of measured) {
      for (const d of m.dependencies) {
        if (d.couldNotResolve === true && isInScopeSpecifier(d.module, aliases.prefixes)) {
          unresolvedInScope.push(`${m.source} -> ${d.module ?? d.resolved}`);
        }
      }
    }
    return { kind: 'graph', base, roots, files: measured, unresolvedInScope };
  }
  ```

  3. The head of `measureIndirection` now reads:

  ```ts
  export async function measureIndirection(opts: MeasureOptions): Promise<IndirectionResult> {
    const threshold = opts.threshold ?? INDIRECTION_CLOSURE_THRESHOLD;
    const graph = await cruiseFileGraph(opts);
    if (graph.kind === 'empty') return { kind: 'empty', threshold };
    if (graph.kind !== 'graph') return graph;
    const { base, roots, files: measured, unresolvedInScope } = graph;

    const byId = new Map(measured.map((m) => [m.source, m]));
  ```

  4. Further down in `measureIndirection`, delete its own `const unresolvedInScope: string[] = [];` declaration and the `for (const m of measured) { … }` loop that fills it — that loop now lives in `cruiseFileGraph`, and the measured result keeps returning `unresolvedInScope` from the destructure.

- [ ] **Step 7: Run the indirection regression tests to verify the move preserved behaviour.**

  Run: `pnpm vitest run src/indirection/__tests__/detect.test.ts src/indirection/__tests__/baseline.test.ts src/indirection/__tests__/indirection-cli.test.ts`
  Expected: PASS, with the same test count as before the move and no failures.

- [ ] **Step 8: Write the pair builder.**

  Create `src/indirection/module-pairs.ts`:

  ```ts
  // @fd: architecture-design-phase
  // Module-to-module import pairs — the code truth the architecture baseline's
  // arrows are held to (spec: "Code truth"). Built on the indirection ratchet's
  // cruise (`cruiseFileGraph`), so both read one file graph: tests excluded,
  // tsconfig aliases resolved, a partial cruise refused. graphify's graph.json
  // is not used: it can be stale.

  import { pairKey } from '../design/arch-pen.js';
  import { cruiseFileGraph, type CruiseModule } from './detect.js';

  export type ModulePairsResult =
    | { readonly kind: 'pairs'; readonly pairs: ReadonlySet<string> }
    | { readonly kind: 'unmeasurable'; readonly message: string };

  /** The module a repo-relative file sits in — the longest module path prefixing it — or `null`. */
  export function moduleOf(file: string, modules: readonly string[]): string | null {
    let best: string | null = null;
    for (const mod of modules) {
      if (file.startsWith(`${mod}/`) && (best === null || mod.length > best.length)) best = mod;
    }
    return best;
  }

  /** Every `from -> to` pair where a file in `from` imports a file in `to`; imports inside one module are not pairs. */
  export function pairsFromFiles(files: readonly CruiseModule[], modules: readonly string[]): Set<string> {
    const pairs = new Set<string>();
    for (const file of files) {
      const from = moduleOf(file.source, modules);
      if (from === null) continue;
      for (const dep of file.dependencies) {
        const to = moduleOf(dep.resolved, modules);
        if (to !== null && to !== from) pairs.add(pairKey(from, to));
      }
    }
    return pairs;
  }

  /**
   * The import pairs between `modules`, read off one cruise of `roots`. An empty
   * corpus has no pairs; a graph the cruise cannot build — or one holding an
   * in-repo import it could not resolve — is `unmeasurable`, never a set missing
   * pairs, which would read correctly drawn arrows as phantom.
   */
  export async function moduleImportPairs(
    cwd: string,
    roots: readonly string[],
    modules: readonly string[],
  ): Promise<ModulePairsResult> {
    const graph = await cruiseFileGraph({ cwd, roots });
    if (graph.kind === 'empty') return { kind: 'pairs', pairs: new Set() };
    if (graph.kind !== 'graph') return { kind: 'unmeasurable', message: graph.message };
    if (graph.unresolvedInScope.length > 0) {
      const shown = graph.unresolvedInScope.slice(0, 5).join(', ');
      return {
        kind: 'unmeasurable',
        message: `${graph.unresolvedInScope.length} in-repo import(s) could not be resolved, so module pairs are unknown: ${shown}`,
      };
    }
    return { kind: 'pairs', pairs: pairsFromFiles(graph.files, modules) };
  }
  ```

- [ ] **Step 9: Run the new tests, the typecheck and the indirection ratchet.**

  Run: `pnpm vitest run src/indirection/__tests__/module-pairs.test.ts`
  Expected: PASS — `Tests  5 passed (5)`.

  Run: `pnpm typecheck`
  Expected: exit 0, no output.

  Run: `pnpm noldor indirection check`
  Expected: exit 0. If it exits 1 with a higher excess sum, the new `module-pairs.ts` edges widened a closure. Re-record the baseline as its own commit before Step 10, as repo practice is for ratchet moves:

  ```bash
  pnpm noldor indirection baseline
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  chore(indirection): re-record the baseline for the module-pairs edges

  src/indirection/module-pairs.ts imports detect.ts and design/arch-pen.ts;
  moving the cruise into cruiseFileGraph added no edge of its own.

  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add .noldor/indirection-baseline.json
  git commit -F "$msg"
  ```

- [ ] **Step 10: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(indirection): expose the verified file graph and read module import pairs off it

  measureIndirection's cruise-and-verify head moves, unchanged, into
  cruiseFileGraph so a second reader shares the same graph — tests excluded,
  aliases resolved, a partial cruise refused — together with the in-repo
  imports cruise could not resolve. moduleImportPairs maps it to `from -> to`
  module pairs, spelled by pairKey, and refuses a graph with an unresolved
  in-repo import rather than silently dropping its pair.

  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/design/arch-pen.ts src/indirection/detect.ts src/indirection/module-pairs.ts \
    src/indirection/__tests__/module-pairs.test.ts src/indirection/__tests__/trees/modules
  git commit -F "$msg"
  ```

---

## Task 2: The arrow rules

**Files:**

- Replace: `src/design/arch-check.ts`
- Replace: `src/design/arch-baseline.ts`
- Replace: `src/checks/check-arch-baseline.ts`
- Modify: `docs/noldor/script-catalog.md`, `templates/docs/noldor/script-catalog.md`
- Test: `src/design/__tests__/arch-check.test.ts` (replace), `src/checks/__tests__/check-arch-baseline.test.ts` (modify)

The spec's arrow rules, applied after expansion to modules:
- An arrow is real when any expanded pair imports, whether its ends are groups or multi-module boxes.
- An import between two modules that share one box is internal, and is never reported.
- An import whose end module no box covers is already a `missing-module` finding, so it gets no advisory of its own.

When the cruise cannot build the graph, the result is an `unreadable` finding. Skipping the arrows would mint a green the check never earned.

- [ ] **Step 1: Replace the rule tests.**

  Replace the contents of `src/design/__tests__/arch-check.test.ts` with:

  ```ts
  // @tests: architecture-design-phase
  import { describe, expect, it } from 'vitest';

  import { checkArchDoc } from '../arch-check.js';
  import { pairKey, readArchPen, type ArchDoc } from '../arch-pen.js';

  interface Node {
    id: string;
    type: string;
    name?: string;
    children?: Node[];
  }
  let seq = 0;
  const node = (type: string, name: string, children: Node[] = []): Node => ({
    id: `n${++seq}`,
    type,
    name,
    children,
  });
  const box = (name: string): Node => node('frame', name, [node('text', 'Label')]);
  const group = (name: string, ...children: Node[]): Node => node('frame', `group: ${name}`, children);
  const arrow = (name: string): Node => node('path', name);

  function doc(...pages: Node[]): ArchDoc {
    const read = readArchPen(JSON.stringify({ version: '2.17', children: pages }));
    if (!read.ok) throw new Error(read.error);
    return read.doc;
  }
  const baseline = (...children: Node[]): ArchDoc =>
    doc(node('frame', 'context'), node('frame', 'containers'), node('frame', 'modules', children), node('frame', 'flows'));

  const MODULES = ['src/core', 'src/cr', 'src/utils'];
  const PAIRS = new Set([pairKey('src/cr', 'src/core'), pairKey('src/core', 'src/utils')]);
  const found = (d: ArchDoc): string[][] => checkArchDoc(d, MODULES, PAIRS).findings.map((f) => [f.kind, f.subject]);

  describe('arch-check / module coverage', () => {
    it('names an uncovered module', () => {
      expect(found(baseline(box('src/core'), box('src/cr')))).toEqual([['missing-module', 'src/utils']]);
    });

    it('names a box that is not a module, and a module drawn twice', () => {
      expect(found(baseline(box('src/core'), box('src/cr + src/utils'), box('src/utils'), box('src/ghost')))).toEqual([
        ['unknown-module', 'src/ghost'],
        ['duplicate-module', 'src/utils'],
      ]);
    });

    it('names an arrow end that resolves to nothing', () => {
      expect(found(baseline(box('src/core'), box('src/cr'), box('src/utils'), arrow('src/cr -> src/nowhere')))).toEqual([
        ['dangling-edge', 'src/cr -> src/nowhere'],
      ]);
    });

    it('needs exactly one page per view', () => {
      expect(checkArchDoc(doc(node('frame', 'modules'), node('frame', 'modules')), [], new Set()).findings.map((f) => f.subject)).toEqual([
        'context',
        'containers',
        'modules',
        'flows',
      ]);
    });
  });

  describe('arch-check / arrows', () => {
    it('passes real arrows and advises on an import no arrow draws', () => {
      const result = checkArchDoc(baseline(box('src/core'), box('src/cr'), box('src/utils'), arrow('src/cr -> src/core')), MODULES, PAIRS);
      expect(result.findings).toEqual([]);
      expect(result.advisories.map((a) => [a.kind, a.subject])).toEqual([['undrawn-edge', 'src/core -> src/utils']]);
    });

    it('names an arrow no import backs, and passes a group arrow one import backs', () => {
      expect(
        found(
          baseline(box('src/core'), group('Work', box('src/cr')), box('src/utils'), arrow('src/utils -> src/cr'), arrow('group: Work -> src/core')),
        ),
      ).toEqual([['phantom-edge', 'src/utils -> src/cr']]);
    });

    it('passes a multi-module arrow when any expanded pair imports', () => {
      expect(found(baseline(box('src/core + src/utils'), box('src/cr'), arrow('src/cr -> src/core + src/utils')))).toEqual([]);
    });

    it('never advises on an import between two modules that share one box', () => {
      const result = checkArchDoc(baseline(box('src/core + src/utils'), box('src/cr'), arrow('src/cr -> src/core')), MODULES, PAIRS);
      expect(result.advisories).toEqual([]);
    });
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail.**

  Run: `pnpm vitest run src/design/__tests__/arch-check.test.ts`
  Expected: FAIL. `result.advisories` is `undefined` (`Cannot read properties of undefined (reading 'map')`), and the phantom-arrow case finds no `phantom-edge`.

- [ ] **Step 3: Replace the rules.**

  Replace the contents of `src/design/arch-check.ts` with:

  ```ts
  // @fd: architecture-design-phase
  // The honesty rules for the architecture baseline (spec: "Honesty check"):
  // does the `modules` view cover every module exactly once, is every arrow
  // backed by an import, and does every arrow end on something? Pure — the
  // model, the module list and the import pairs in, findings out — so each rule
  // is a unit test; `arch-baseline.ts` gathers the inputs.

  import { ARCH_VIEWS, pairKey, type ArchDoc, type ArchPage } from './arch-pen.js';

  export type ArchFindingKind =
    | 'unreadable'
    | 'missing-module'
    | 'unknown-module'
    | 'duplicate-module'
    | 'dangling-edge'
    | 'phantom-edge';

  export interface ArchFinding {
    readonly kind: ArchFindingKind;
    /** The view it is on — `baseline` for a problem with the file as a whole. */
    readonly view: string;
    /** What it names: a module path, an arrow, a view or a file. */
    readonly subject: string;
    readonly message: string;
  }

  /** Reported, never blocking: an import the modules view does not draw. */
  export interface ArchAdvisory {
    readonly kind: 'undrawn-edge';
    readonly view: 'modules';
    readonly subject: string;
    readonly message: string;
  }

  export interface ArchCheckResult {
    readonly findings: readonly ArchFinding[];
    readonly advisories: readonly ArchAdvisory[];
  }

  const KIND_ORDER: readonly ArchFindingKind[] = [
    'unreadable',
    'missing-module',
    'unknown-module',
    'duplicate-module',
    'dangling-edge',
    'phantom-edge',
  ];

  /** Registry order for a view; `baseline` (the whole file) sorts first. */
  function viewRank(view: string): number {
    return ARCH_VIEWS.findIndex((v) => v === view);
  }

  /**
   * Hold a baseline to the code: one page per view, every arrow end on every page
   * resolving, the `modules` page covering each module once, and no arrow there
   * that `pairs` does not back. An import no arrow draws is advisory — a view that
   * had to draw every import would be a hairball.
   */
  export function checkArchDoc(doc: ArchDoc, modules: readonly string[], pairs: ReadonlySet<string>): ArchCheckResult {
    const findings: ArchFinding[] = [];
    const advisories: ArchAdvisory[] = [];
    const baseline = doc.pages.filter((page) => page.role === 'baseline');

    for (const view of ARCH_VIEWS) {
      const count = baseline.filter((page) => page.view === view).length;
      if (count === 0) findings.push({ kind: 'unreadable', view, subject: view, message: `the baseline has no \`${view}\` page` });
      if (count > 1) findings.push({ kind: 'unreadable', view, subject: view, message: `the baseline has ${count} \`${view}\` pages — keep one` });
    }

    for (const page of baseline) {
      for (const arrow of page.arrows) {
        for (const end of [arrow.from, arrow.to]) {
          if (end.kind !== 'unresolved') continue;
          findings.push({
            kind: 'dangling-edge',
            view: page.view,
            subject: arrow.name,
            message:
              end.matches === 0
                ? `\`${end.text}\` names nothing on the page`
                : `\`${end.text}\` names ${end.matches} boxes — rename all but one`,
          });
        }
      }
    }

    const modulesPages = baseline.filter((page) => page.view === 'modules');
    const [modulesPage] = modulesPages;
    if (modulesPages.length === 1 && modulesPage !== undefined) {
      checkCoverage(modulesPage, modules, findings);
      checkArrows(modulesPage, pairs, findings, advisories);
    }

    findings.sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        viewRank(a.view) - viewRank(b.view) ||
        a.subject.localeCompare(b.subject),
    );
    advisories.sort((a, b) => a.subject.localeCompare(b.subject));
    return { findings, advisories };
  }

  function checkCoverage(page: ArchPage, modules: readonly string[], findings: ArchFinding[]): void {
    const known = new Set(modules);
    const coveredBy = new Map<string, string[]>();
    for (const box of page.boxes) {
      for (const ref of box.refs) {
        if (known.has(ref)) coveredBy.set(ref, [...(coveredBy.get(ref) ?? []), box.name]);
        else findings.push({ kind: 'unknown-module', view: 'modules', subject: ref, message: `box \`${box.name}\` names ${ref}, which is not a module` });
      }
    }
    for (const mod of modules) {
      const boxes = coveredBy.get(mod) ?? [];
      if (boxes.length === 0) findings.push({ kind: 'missing-module', view: 'modules', subject: mod, message: `no box covers ${mod}` });
      if (boxes.length > 1) {
        findings.push({ kind: 'duplicate-module', view: 'modules', subject: mod, message: `${mod} is covered by ${boxes.length} boxes: ${boxes.join(', ')}` });
      }
    }
  }

  function checkArrows(page: ArchPage, pairs: ReadonlySet<string>, findings: ArchFinding[], advisories: ArchAdvisory[]): void {
    const drawn: Array<{ from: readonly string[]; to: readonly string[] }> = [];
    for (const arrow of page.arrows) {
      if (arrow.from.kind === 'unresolved' || arrow.to.kind === 'unresolved') continue;
      const from = arrow.from.refs;
      const to = arrow.to.refs;
      drawn.push({ from, to });
      if (from.some((a) => to.some((b) => a !== b && pairs.has(pairKey(a, b))))) continue;
      findings.push({
        kind: 'phantom-edge',
        view: 'modules',
        subject: arrow.name,
        message:
          from.length === 0 || to.length === 0
            ? 'one end covers no module, so no import can back it'
            : `no import from ${from.join(' + ')} into ${to.join(' + ')}`,
      });
    }

    /** Module → the id of the first box covering it, for the internal-import test. */
    const homeBox = new Map<string, string>();
    for (const box of page.boxes) for (const ref of box.refs) if (!homeBox.has(ref)) homeBox.set(ref, box.id);
    for (const pair of pairs) {
      const [a, b] = pair.split(' -> ');
      if (a === undefined || b === undefined) continue;
      const home = homeBox.get(a);
      const away = homeBox.get(b);
      // An uncovered module is already `missing-module`; an import inside one box is not an edge.
      if (home === undefined || away === undefined || home === away) continue;
      if (drawn.some((d) => d.from.includes(a) && d.to.includes(b))) continue;
      advisories.push({ kind: 'undrawn-edge', view: 'modules', subject: pair, message: `${a} imports ${b}, but no arrow shows it` });
    }
  }
  ```

- [ ] **Step 4: Run the rule tests to verify they pass.**

  Run: `pnpm vitest run src/design/__tests__/arch-check.test.ts`
  Expected: PASS — `Tests  8 passed (8)`.

- [ ] **Step 5: Add the failing end-to-end case.**

  In `src/checks/__tests__/check-arch-baseline.test.ts`, add this case inside `describe('checks arch-baseline', …)`, directly after the `'exits 0 on a baseline that covers every module'` case:

  ```ts
    it('exits 1 and names an arrow the imports do not back', async () => {
      const root = await makeRepo();
      await writeBaseline(root, [node('frame', 'src/a'), node('frame', 'src/b'), node('path', 'src/b -> src/a')]);
      const r = await run(root);
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/phantom-edge.*src\/b -> src\/a/);
    });
  ```

  Run: `pnpm vitest run src/checks/__tests__/check-arch-baseline.test.ts`
  Expected: FAIL. `pnpm typecheck` would already flag `checkArchDoc` missing its third argument in `arch-baseline.ts`, and the new case exits 0 because the pairs are not read yet.

- [ ] **Step 6: Replace the IO seam.**

  Replace the contents of `src/design/arch-baseline.ts` with:

  ```ts
  // @fd: architecture-design-phase
  // The architecture honesty check with its inputs gathered: the baseline read
  // from disk, the module set from the code (`listModuleDirs`), and the import
  // pairs from dependency-cruiser (`moduleImportPairs`). Shared by
  // `checks arch-baseline` and the release preflight row — which is why it lives
  // here rather than in the CLI file: src/release never imports src/checks.

  import { readFile } from 'node:fs/promises';
  import { join } from 'node:path';

  import { ARCH_BASELINE_PATH } from '../core/design-artifact-names.js';
  import { errMessage } from '../core/err-message.js';
  import { scanRoots } from '../core/repo-paths.js';
  import { listModuleDirs } from '../docs/docs-architecture.js';
  import { moduleImportPairs } from '../indirection/module-pairs.js';
  import { checkArchDoc, type ArchAdvisory, type ArchFinding } from './arch-check.js';
  import { readArchPen } from './arch-pen.js';

  export interface ArchBaselineReport {
    /** `absent` — no baseline, nothing checked; `ok` — no findings; `incomplete` — findings. */
    readonly status: 'absent' | 'ok' | 'incomplete';
    readonly findings: readonly ArchFinding[];
    readonly advisories: readonly ArchAdvisory[];
  }

  function unreadable(subject: string, message: string): ArchBaselineReport {
    return { status: 'incomplete', findings: [{ kind: 'unreadable', view: 'baseline', subject, message }], advisories: [] };
  }

  /**
   * Hold `docs/design/architecture/baseline.pen` to the code. Every read failure
   * is a finding, never a throw. An import graph the cruise cannot build is an
   * `unreadable` finding: skipping the arrows would mint a green never earned.
   */
  export async function checkArchBaseline(cwd: string): Promise<ArchBaselineReport> {
    let text: string;
    try {
      text = await readFile(join(cwd, ARCH_BASELINE_PATH), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'absent', findings: [], advisories: [] };
      return unreadable(ARCH_BASELINE_PATH, errMessage(err));
    }
    const read = readArchPen(text);
    if (!read.ok) return unreadable(ARCH_BASELINE_PATH, read.error);

    let roots: string[];
    try {
      roots = scanRoots(cwd);
    } catch (err) {
      return unreadable('.noldor/config.json', `scan roots unreadable: ${errMessage(err)}`);
    }
    const modules = await listModuleDirs(cwd);
    const pairs = await moduleImportPairs(cwd, roots, modules);
    if (pairs.kind === 'unmeasurable') return unreadable('import graph', pairs.message);

    const result = checkArchDoc(read.doc, modules, pairs.pairs);
    return { status: result.findings.length === 0 ? 'ok' : 'incomplete', ...result };
  }
  ```

- [ ] **Step 7: Replace the CLI so it renders the advisories.**

  Replace the contents of `src/checks/check-arch-baseline.ts` with:

  ```ts
  // @fd: architecture-design-phase
  // `noldor checks arch-baseline` — the architecture baseline held to the code.
  // Exit 0 when there is no baseline (absent) or it is clean, 1 on any finding;
  // advisories print and never change the exit code. Gate Step 4 runs it
  // advisorily; release preflight blocks on it (the `arch-baseline` row).

  import { runIfDirect } from '../core/cli-entry.js';
  import { ARCH_BASELINE_PATH } from '../core/design-artifact-names.js';
  import { checkArchBaseline, type ArchBaselineReport } from '../design/arch-baseline.js';

  export function row(kind: string, view: string, subject: string, message: string): string {
    return `  ${kind.padEnd(17)} ${view.padEnd(11)} ${subject} — ${message}`;
  }

  export function renderReport(report: ArchBaselineReport): string {
    if (report.status === 'absent') return `arch-baseline: absent — no ${ARCH_BASELINE_PATH}, nothing to check`;
    const lines = [
      report.status === 'ok'
        ? `arch-baseline: ok — ${ARCH_BASELINE_PATH} matches the code`
        : `arch-baseline: ${report.findings.length} finding(s) in ${ARCH_BASELINE_PATH}`,
      ...report.findings.map((f) => row(f.kind, f.view, f.subject, f.message)),
    ];
    if (report.advisories.length > 0) {
      lines.push(`advisory (${report.advisories.length}, exit unaffected):`);
      lines.push(...report.advisories.map((a) => row(a.kind, a.view, a.subject, a.message)));
    }
    return lines.join('\n');
  }

  export async function main(cwd: string = process.cwd()): Promise<number> {
    const report = await checkArchBaseline(cwd);
    console.log(renderReport(report));
    return report.status === 'incomplete' ? 1 : 0;
  }

  runIfDirect('check-arch-baseline', 'checks arch-baseline', async () => main());
  ```

- [ ] **Step 8: Run the tests and the typecheck to verify they pass.**

  Run: `pnpm vitest run src/checks/__tests__/check-arch-baseline.test.ts src/design/__tests__/arch-check.test.ts`
  Expected: PASS — `Tests  13 passed (13)`.

  Run: `pnpm typecheck`
  Expected: exit 0, no output.

- [ ] **Step 9: Update the catalog entry (both twins).**

  In `docs/noldor/script-catalog.md`, replace the `- **Inputs:**` and `- **Outputs:**` bullets of the `### \`check:arch-baseline\`` entry with:

  ```markdown
  - **Inputs:** `docs/design/architecture/baseline.pen`; the module set (`listModuleDirs` over `consumer.scanPaths`); module-to-module import pairs from dependency-cruiser (`moduleImportPairs` — tests excluded, tsconfig aliases resolved, the indirection ratchet's completeness guard).
  - **Outputs:** one row per finding, then advisory rows.
    - Findings:
      - `unreadable`: a view page missing or doubled, a file that is not a `.pen` document, or an import graph that could not be built.
      - `missing-module`, `unknown-module`, `duplicate-module`, `dangling-edge`.
      - `phantom-edge`: an arrow no import backs after group and multi-module expansion.
    - Advisory: `undrawn-edge`, an import between two boxed modules that no arrow shows.

    Exit 0 when the baseline is absent (nothing is checked) or clean; exit 1 on any finding. Advisories never change the exit code.
  ```

  Run: `cp docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md`

- [ ] **Step 10: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(design): the architecture check holds every modules-view arrow to an import

  An arrow is real when any expanded module pair imports, so group and
  multi-module arrows are judged the same way; an import no arrow shows is an
  advisory undrawn-edge, never a finding. An import graph the cruise cannot
  build is an unreadable finding rather than a skipped arrow check.

  Noldor-Sibling-Scope: noldor:script-catalog
  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/design/arch-check.ts src/design/__tests__/arch-check.test.ts src/design/arch-baseline.ts \
    src/checks/check-arch-baseline.ts src/checks/__tests__/check-arch-baseline.test.ts \
    docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md
  git commit -F "$msg"
  ```
