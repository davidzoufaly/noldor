# One Detailed Architecture Canvas Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Replace the four-page architecture baseline with one detailed `architecture` page that `design arch-draw` draws from the code, that `checks arch-baseline` holds down to parts, and that one procedure page teaches every agent to finish and keep true.

**Architecture:** The pure reader (`src/design/arch-pen.ts`) reads one page, three new name prefixes and path boxes that know their enclosing path boxes. The pure rules (`src/design/arch-check.ts`) hold modules, parts and arrows to the file graph that `src/indirection/module-pairs.ts` already cruises. A new `src/design/arch-draw.ts` writes the first baseline and adds new modules later. Docs and skills point at one new page, `docs/noldor/architecture-canvas.md`.

**Tech Stack:** TypeScript run by tsx, vitest, dependency-cruiser (through `cruiseFileGraph`), pen.dev `.pen` JSON 2.19.

**Spec:** `docs/design/specs/2026-09-26-architecture-design-phase-one-detailed-canvas-design.md`

**Commit messages:** every Commit step writes the message to `"$(git rev-parse --git-dir)/TASK_MSG"` with a heredoc and commits with `git commit -F` on that file. The file lives in the git dir, so it is never staged. Run `git commit` in the background and read its log, because a foreground commit can hang in this harness.

---

## File Structure

- `src/design/arch-pen.ts` — the reader: one `architecture` page, `external:` / `container:` / `store:` prefixes, path boxes with `within`, `canonicalName`, and the `FileEdge` type.
- `src/design/arch-check.ts` — the rules: one page, module coverage, `unknown-part`, `misplaced-part`, file-level arrows with the nesting rule, resolve-only arrows for the outer layers.
- `src/indirection/module-pairs.ts` — `moduleImportPairs` also returns the file edges of its one cruise.
- `src/design/arch-baseline.ts` — gathers the modules, pairs, edges and existing part paths.
- `src/checks/check-arch-baseline.ts` — report rows without a view column.
- `src/design/arch-route.ts` — routes every arrow; `--view` goes.
- `src/design/arch-progress.ts` — one `FINAL:` page against the baseline page.
- `src/design/design-approval-cli.ts` — `--surface architecture` for an architecture `.pen`.
- `src/core/atomic-write.ts` — `writeFileSyncIfAbsent`, a create that never replaces.
- `src/design/arch-draw.ts` (new) — `design arch-draw [--refresh]`.
- `src/cli/manifest.ts` — the `arch-draw` entry, and the `arch-progress` description.
- `docs/design/architecture/baseline.pen` — regenerated as one page.
- `docs/noldor/architecture-canvas.md` (new) + `templates/docs/noldor/architecture-canvas.md` — the procedure page.
- `docs/noldor/README.md` + twin — the route-table row.
- `.claude/skills/noldor-spec/arch-design.md`, `.claude/skills/noldor-gate/design-writeback.md`, `.claude/skills/noldor-milestone/SKILL.md` + twins — one page, and a link to the procedure page.
- `docs/noldor/drain-mode.md`, `docs/noldor/versioning.md`, `docs/noldor/gotchas.md`, `docs/noldor/script-catalog.md` + twins — the new contract.
- `AGENTS.md` + `templates/AGENTS.md` — the regenerated capability index.
- `docs/backlog.md` — Q-0210 removed.
- Tests: `src/indirection/__tests__/module-pairs.test.ts`, `src/design/__tests__/arch-pen.test.ts`, `src/design/__tests__/arch-check.test.ts`, `src/design/__tests__/arch-route.test.ts`, `src/design/__tests__/arch-progress.test.ts`, `src/design/__tests__/design-approval.test.ts`, `src/checks/__tests__/check-arch-baseline.test.ts`, `src/core/__tests__/atomic-write.test.ts`, `src/design/__tests__/arch-draw.test.ts` (new).

---

## Task 1: Return the file edges from the one cruise

**Files:**
- Modify: `src/design/arch-pen.ts`
- Modify: `src/indirection/module-pairs.ts`
- Test: `src/indirection/__tests__/module-pairs.test.ts`

- [ ] **Step 1: Write the failing test.** In `src/indirection/__tests__/module-pairs.test.ts`, change the import line to

```ts
import { edgesFromFiles, moduleImportPairs, moduleOf, pairsFromFiles } from '../module-pairs.js';
```

and add these two tests at the end of the `describe('module-pairs', …)` block, before its closing `});`:

```ts
  it('keeps every import between two files as a file edge, inside one module too', () => {
    const files = [
      {
        source: 'src/a/x.ts',
        dependencies: [{ resolved: 'src/b/y.ts' }, { resolved: 'src/a/z.ts' }, { resolved: 'src/a/x.ts' }],
      },
    ];
    expect(edgesFromFiles(files)).toEqual([
      { from: 'src/a/x.ts', to: 'src/b/y.ts' },
      { from: 'src/a/x.ts', to: 'src/a/z.ts' },
    ]);
  });

  it('reads the file edges off the same cruise as the pairs, spec files excluded', async () => {
    const result = await moduleImportPairs(FIXTURE, ['src'], MODULES);
    if (result.kind !== 'pairs') throw new Error(result.message);
    expect(result.edges.map((e) => `${e.from} -> ${e.to}`).sort()).toEqual([
      'src/a/x.ts -> src/a/z.ts',
      'src/a/x.ts -> src/b/y.ts',
      'src/c/w.ts -> src/a/x.ts',
      'src/index.ts -> src/a/x.ts',
    ]);
  });
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm vitest run src/indirection/__tests__/module-pairs.test.ts`
Expected: FAIL — `edgesFromFiles is not a function` in the first new test, and `result.edges` is undefined in the second.

- [ ] **Step 3: Add the `FileEdge` type.** In `src/design/arch-pen.ts`, add after the `ArchDoc` interface:

```ts
/** One import in the file graph: a repo-relative file and the file it imports. */
export interface FileEdge {
  readonly from: string;
  readonly to: string;
}
```

- [ ] **Step 4: Return the edges.** In `src/indirection/module-pairs.ts`, replace the header comment, the import line and the `ModulePairsResult` type with:

```ts
// @fd: architecture-design-phase
// Module-to-module import pairs and the file edges under them — the code truth
// the architecture baseline's arrows are held to (spec: "Honesty check"). Built
// on the indirection ratchet's cruise (`cruiseFileGraph`), so both read one
// file graph: tests excluded, tsconfig aliases resolved, a partial cruise
// refused. graphify's graph.json is not used: it can be stale.

import { pairKey, type FileEdge } from '../design/arch-pen.js';
import { cruiseFileGraph, type CruiseModule } from './detect.js';

export type ModulePairsResult =
  | {
      readonly kind: 'pairs';
      readonly pairs: ReadonlySet<string>;
      /** Every import between two files, the ones inside one module included. */
      readonly edges: readonly FileEdge[];
    }
  | { readonly kind: 'unmeasurable'; readonly message: string };
```

Add after `pairsFromFiles`:

```ts
/** Every import between two different files — the graph a part arrow is held to. */
export function edgesFromFiles(files: readonly CruiseModule[]): FileEdge[] {
  const edges: FileEdge[] = [];
  for (const file of files)
    for (const dep of file.dependencies)
      if (dep.resolved !== file.source) edges.push({ from: file.source, to: dep.resolved });
  return edges;
}
```

In `moduleImportPairs`, replace `if (graph.kind === 'empty') return { kind: 'pairs', pairs: new Set() };` with

```ts
  if (graph.kind === 'empty') return { kind: 'pairs', pairs: new Set(), edges: [] };
```

and replace the last line, `return { kind: 'pairs', pairs: pairsFromFiles(graph.files, modules) };`, with

```ts
  return {
    kind: 'pairs',
    pairs: pairsFromFiles(graph.files, modules),
    edges: edgesFromFiles(graph.files),
  };
```

- [ ] **Step 5: Run the test to verify it passes.**

Run: `pnpm vitest run src/indirection/__tests__/module-pairs.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 6: Commit.**

```bash
git add src/design/arch-pen.ts src/indirection/module-pairs.ts src/indirection/__tests__/module-pairs.test.ts
cat > "$(git rev-parse --git-dir)/TASK_MSG" <<'EOF'
feat(design): read file edges off the architecture check's one cruise

Why — The architecture canvas grows a layer of parts inside each module, and an arrow that touches a part has to be held to real imports between files. Module pairs cannot say that; the file graph the check already cruises can.
How — moduleImportPairs returns the file edges of the same cruiseFileGraph pass beside the module pairs, so the check still runs dependency-cruiser once. The FileEdge type lives in arch-pen.ts so src/design never imports src/indirection.
What — edgesFromFiles in src/indirection/module-pairs.ts, an edges field on the pairs result, and the FileEdge type in src/design/arch-pen.ts, with tests over the real fixture cruise.

Noldor-FD: architecture-design-phase
EOF
git commit -F "$(git rev-parse --git-dir)/TASK_MSG"
```

---

## Task 2: Read and check one `architecture` page

`arch-route.ts`, `arch-progress.ts`, `arch-baseline.ts` and `design-approval-cli.ts` still read `ARCH_VIEWS`, `page.view` and the old `checkArchDoc` arguments after this task, so their tests and `pnpm typecheck` stay red until Task 3 moves them. This task runs only its own two test files.

**Files:**
- Modify: `src/design/arch-pen.ts`
- Modify: `src/design/arch-check.ts`
- Test: `src/design/__tests__/arch-pen.test.ts`
- Test: `src/design/__tests__/arch-check.test.ts`

- [ ] **Step 1: Write the failing reader test.** Replace the whole of `src/design/__tests__/arch-pen.test.ts` with:

```ts
// @tests: architecture-design-phase
import { describe, expect, it } from 'vitest';

import {
  arrowEndsOf,
  canonicalName,
  pageRoleOf,
  pathRefsOf,
  readArchPen,
  type ArchPage,
} from '../arch-pen.js';

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
/** A box the way `design arch-draw` draws one: a frame with a text label, and any boxes inside it. */
const box = (name: string, ...inside: Node[]): Node =>
  node('frame', name, [node('text', 'Label'), ...inside]);
const group = (name: string, ...children: Node[]): Node =>
  node('frame', `group: ${name}`, children);
const arrow = (name: string): Node => node('path', name);
const pen = (...pages: Node[]): string => JSON.stringify({ version: '2.19', children: pages });
const canvas = (...children: Node[]): string => pen(node('frame', 'architecture', children));

function onlyPage(text: string): ArchPage {
  const read = readArchPen(text);
  if (!read.ok) throw new Error(read.error);
  const [page, ...rest] = read.doc.pages;
  if (page === undefined || rest.length > 0) throw new Error('expected exactly one page');
  return page;
}

describe('arch-pen / names', () => {
  it.each([
    ['architecture', 'baseline'],
    ['BASE:architecture: as-built', 'base'],
    ['FINAL:architecture: add a queue', 'final'],
    ['architecture: variant b', 'variant'],
  ])('reads the page %s', (name, expected) => {
    expect(pageRoleOf(name)).toBe(expected);
  });

  it.each(['modules', 'FINAL:modules: split', 'architecturez', 'FINAL:architecture', 'app'])(
    'ignores the page %s',
    (name) => {
      expect(pageRoleOf(name)).toBeNull();
    },
  );

  it('reads path references, and refuses what is not one', () => {
    expect(pathRefsOf('src/cr')).toEqual(['src/cr']);
    expect(pathRefsOf('src/cr/orchestrate.ts')).toEqual(['src/cr/orchestrate.ts']);
    expect(pathRefsOf('src/utils + src/types')).toEqual(['src/utils', 'src/types']);
    for (const name of ['Workflow', 'src', 'src/cr (review)', 'src/../etc', 'src/cr + Notes', 'src/cr/'])
      expect(pathRefsOf(name)).toEqual([]);
  });

  it('reads arrow names with or without spaces, and refuses what is not one', () => {
    expect(arrowEndsOf('src/cr -> src/core')).toEqual({ from: 'src/cr', to: 'src/core' });
    expect(arrowEndsOf('group: Work->src/core')).toEqual({ from: 'group: Work', to: 'src/core' });
    for (const name of ['src/cr', 'a -> b -> c', ' -> src/core']) expect(arrowEndsOf(name)).toBeNull();
  });

  it('spells every prefix with one space before its label', () => {
    expect(canonicalName('container:CLI')).toBe('container: CLI');
    expect(canonicalName('  group:   Work ')).toBe('group: Work');
    expect(canonicalName('external:')).toBe('external:');
    expect(canonicalName('src/cr')).toBe('src/cr');
  });
});

describe('arch-pen / readArchPen', () => {
  it('refuses what is not a .pen document', () => {
    expect(readArchPen('{ nope').ok).toBe(false);
    expect(readArchPen(JSON.stringify({ version: '2.19' })).ok).toBe(false);
  });

  it('keeps only the pages that name the architecture surface, in file order', () => {
    const read = readArchPen(
      pen(
        node('frame', 'Notes'),
        node('frame', 'architecture'),
        node('frame', 'FINAL:architecture: new'),
        node('frame', 'modules'),
      ),
    );
    if (!read.ok) throw new Error(read.error);
    expect(read.doc.pages.map((p) => [p.name, p.role])).toEqual([
      ['architecture', 'baseline'],
      ['FINAL:architecture: new', 'final'],
    ]);
  });

  it('counts frames, rectangles, ellipses and refs as boxes, each with its kind', () => {
    const page = onlyPage(
      canvas(
        box('src/cr'),
        node('rectangle', 'src/core'),
        node('ellipse', 'Store'),
        node('ref', 'src/utils'),
        node('frame', 'container:CLI'),
        node('text', 'src/docs'),
        node('icon', 'src/lib'),
        arrow('src/cr -> src/core'),
      ),
    );
    expect(page.boxes.map((b) => [b.name, b.kind, b.refs])).toEqual([
      ['src/cr', 'path', ['src/cr']],
      ['src/core', 'path', ['src/core']],
      ['Store', 'plain', []],
      ['src/utils', 'path', ['src/utils']],
      ['container: CLI', 'container', []],
    ]);
  });

  it('gives each path box the paths of the path boxes around it', () => {
    const page = onlyPage(
      canvas(group('Work', box('src/cr', box('src/cr/lanes', box('src/cr/lanes/review.ts'))))),
    );
    expect(page.boxes.map((b) => [b.name, b.within])).toEqual([
      ['src/cr', []],
      ['src/cr/lanes', ['src/cr']],
      ['src/cr/lanes/review.ts', ['src/cr', 'src/cr/lanes']],
    ]);
  });

  it('collects every box inside a group, nested groups included', () => {
    const page = onlyPage(canvas(group('Work', box('src/cr'), group('Inner', box('src/prep')))));
    expect(page.groups.map((g) => [g.name, g.boxIds.length])).toEqual([
      ['group: Work', 2],
      ['group: Inner', 1],
    ]);
  });

  it('resolves an end to a box, to one module of a multi-module box, or to a group of modules', () => {
    const page = onlyPage(
      canvas(
        box('src/cr'),
        box('src/utils + src/types'),
        group('Shared', box('src/core', box('src/core/rules'))),
        arrow('src/cr -> src/types'),
        arrow('src/cr -> group:Shared'),
        arrow('src/cr -> src/utils + src/types'),
      ),
    );
    expect(page.arrows.map((a) => [a.to.kind, a.to.kind === 'unresolved' ? [] : a.to.refs])).toEqual([
      ['box', ['src/types']],
      ['group', ['src/core']],
      ['box', ['src/utils', 'src/types']],
    ]);
  });

  it('resolves an outer-layer end whatever its spacing, to a box with no refs', () => {
    const page = onlyPage(canvas(box('src/cr'), box('external: git'), arrow('src/cr -> external:git')));
    expect(page.arrows[0]?.to).toMatchObject({ kind: 'box', refs: [] });
  });

  it('leaves an end unresolved when it names nothing, or more than one box', () => {
    const page = onlyPage(canvas(box('git'), box('git'), arrow('git -> gh')));
    expect(page.arrows[0]?.from).toEqual({ kind: 'unresolved', text: 'git', matches: 2 });
    expect(page.arrows[0]?.to).toEqual({ kind: 'unresolved', text: 'gh', matches: 0 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm vitest run src/design/__tests__/arch-pen.test.ts`
Expected: FAIL — `pathRefsOf` and `canonicalName` are not exported, and `pageRoleOf('architecture')` returns `null`.

- [ ] **Step 3: Rewrite the reader.** Replace the whole of `src/design/arch-pen.ts` with:

```ts
// @fd: architecture-design-phase
// The architecture canvas contract (spec: "Tag contract"): which nodes of a
// `.pen` are boxes, groups and arrows, and what each one stands for. Pure —
// text in, a model out — so the check, `design arch-route`, `design
// arch-progress` and `design arch-draw` read one grammar and never disagree
// about what an arrow connects. Meaning lives in LAYER NAMES: a pen id may not
// contain `/`, and a layer name is what the operator can read and fix.

import { errMessage } from '../core/err-message.js';

/** The baseline's one page, and the one surface an architecture design approves. */
export const ARCH_PAGE = 'architecture';

/** Node types that count as boxes; text, icon and path nodes never do. */
const BOX_TYPES: ReadonlySet<string> = new Set(['frame', 'rectangle', 'ellipse', 'ref']);
/** One path segment: path characters only, never `.` or `..`. */
const SEGMENT_RE = /^[A-Za-z0-9_.@-]+$/;
const ARROW_RE = /\s*->\s*/;
const GROUP_PREFIX = 'group:';

/** What a box stands for: a code path (a module or a part), an outer-layer thing, or a free name. */
export type BoxKind = 'path' | 'external' | 'container' | 'store' | 'plain';

/** The outer layers. An arrow touching one of them is held to resolving only. */
const OUTER_PREFIXES: ReadonlyArray<readonly [string, BoxKind]> = [
  ['external:', 'external'],
  ['container:', 'container'],
  ['store:', 'store'],
];

/** How a page takes part in the design lifecycle. */
export type PageRole = 'baseline' | 'base' | 'variant' | 'final';

export interface ArchBox {
  readonly id: string;
  /** The layer name in canonical spelling ({@link canonicalName}). */
  readonly name: string;
  readonly kind: BoxKind;
  /** Code paths the name covers; empty unless `kind` is `path`. */
  readonly refs: readonly string[];
  /** The paths of every path box around this one, outermost first; empty when none encloses it. */
  readonly within: readonly string[];
}

export interface ArchGroup {
  readonly id: string;
  /** Canonical `group: <Name>`, whatever spacing the layer name used. */
  readonly name: string;
  /** Every box inside the group, nested groups included. */
  readonly boxIds: readonly string[];
}

/** An arrow end: what it resolves to and the code paths it stands for, or how many boxes it matched. */
export type ArchEndpoint =
  | {
      readonly kind: 'box' | 'group';
      readonly text: string;
      readonly id: string;
      readonly refs: readonly string[];
    }
  | { readonly kind: 'unresolved'; readonly text: string; readonly matches: number };

export interface ArchArrow {
  readonly id: string;
  readonly name: string;
  readonly from: ArchEndpoint;
  readonly to: ArchEndpoint;
}

export interface ArchPage {
  readonly id: string;
  readonly name: string;
  readonly role: PageRole;
  readonly boxes: readonly ArchBox[];
  readonly groups: readonly ArchGroup[];
  readonly arrows: readonly ArchArrow[];
}

/** Every top-level page that names the architecture surface, in file order; other pages are ignored. */
export interface ArchDoc {
  readonly pages: readonly ArchPage[];
}

/** One import in the file graph: a repo-relative file and the file it imports. */
export interface FileEdge {
  readonly from: string;
  readonly to: string;
}

export type ArchPenResult =
  | { readonly ok: true; readonly doc: ArchDoc }
  | { readonly ok: false; readonly error: string };

interface PenNode {
  readonly id: string;
  readonly type: string;
  readonly name?: string;
  readonly children?: readonly unknown[];
}

function isPenNode(value: unknown): value is PenNode {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.type === 'string' &&
    (v.name === undefined || typeof v.name === 'string') &&
    (v.children === undefined || Array.isArray(v.children))
  );
}

/** Whether `rest` — a page name after any `BASE:` / `FINAL:` — reads `architecture: <something>`. */
function namesSurface(rest: string): boolean {
  const colon = rest.indexOf(':');
  return colon !== -1 && rest.slice(0, colon).trim() === ARCH_PAGE;
}

/** The role a top-level page name declares, or `null` for a page the contract ignores. */
export function pageRoleOf(name: string): PageRole | null {
  const trimmed = name.trim();
  if (trimmed === ARCH_PAGE) return 'baseline';
  if (trimmed.startsWith('BASE:')) return namesSurface(trimmed.slice('BASE:'.length)) ? 'base' : null;
  if (trimmed.startsWith('FINAL:'))
    return namesSurface(trimmed.slice('FINAL:'.length)) ? 'final' : null;
  return namesSurface(trimmed) ? 'variant' : null;
}

/** The code paths a box name covers (`src/cr`, `src/cr/lanes`, `src/a + src/b`), or `[]` when it is not a path. */
export function pathRefsOf(name: string): string[] {
  const parts = name.split(' + ').map((part) => part.trim());
  const isPath = (part: string): boolean => {
    const segments = part.split('/');
    return (
      segments.length >= 2 && segments.every((s) => SEGMENT_RE.test(s) && s !== '.' && s !== '..')
    );
  };
  return parts.every(isPath) ? parts : [];
}

/** An arrow name's two ends, or `null` when the name is not `<from> -> <to>`. */
export function arrowEndsOf(name: string): { from: string; to: string } | null {
  const parts = name.split(ARROW_RE).map((part) => part.trim());
  const [from, to] = parts;
  if (parts.length !== 2 || from === undefined || to === undefined) return null;
  return from === '' || to === '' ? null : { from, to };
}

/** `from -> to` — the one spelling arrow names and module import pairs share. */
export function pairKey(from: string, to: string): string {
  return `${from} -> ${to}`;
}

/** A layer name in canonical spelling: a `group:`, `external:`, `container:` or `store:` prefix takes one space before its label. */
export function canonicalName(name: string): string {
  const trimmed = name.trim();
  for (const prefix of [GROUP_PREFIX, ...OUTER_PREFIXES.map(([p]) => p)]) {
    if (!trimmed.startsWith(prefix)) continue;
    const label = trimmed.slice(prefix.length).trim();
    return label === '' ? trimmed : `${prefix} ${label}`;
  }
  return trimmed;
}

/** What a canonical box name stands for. */
function boxKindOf(name: string): BoxKind {
  for (const [prefix, kind] of OUTER_PREFIXES) if (name.startsWith(`${prefix} `)) return kind;
  return pathRefsOf(name).length > 0 ? 'path' : 'plain';
}

/** `group: <Name>` in canonical spacing, or `null` for a name that is not a group. */
function groupNameOf(name: string): string | null {
  const canonical = canonicalName(name);
  return canonical.startsWith(`${GROUP_PREFIX} `) ? canonical : null;
}

function readPage(page: PenNode, role: PageRole): ArchPage {
  const boxes: ArchBox[] = [];
  const groups: Array<{ id: string; name: string; boxIds: string[] }> = [];
  const paths: Array<{ id: string; name: string }> = [];

  const walk = (
    node: PenNode,
    open: ReadonlyArray<{ boxIds: string[] }>,
    within: readonly string[],
  ): void => {
    const name = canonicalName(node.name ?? '');
    const group = node.type === 'frame' ? groupNameOf(name) : null;
    let inner = open;
    let innerWithin = within;
    if (node.type === 'path') {
      const raw = (node.name ?? '').trim();
      if (raw !== '') paths.push({ id: node.id, name: raw });
    } else if (group !== null) {
      const entry = { id: node.id, name: group, boxIds: [] as string[] };
      groups.push(entry);
      inner = [...open, entry];
    } else if (BOX_TYPES.has(node.type) && name !== '') {
      const kind = boxKindOf(name);
      const refs = kind === 'path' ? pathRefsOf(name) : [];
      boxes.push({ id: node.id, name, kind, refs, within });
      for (const g of open) g.boxIds.push(node.id);
      if (kind === 'path') innerWithin = [...within, ...refs];
    }
    for (const child of node.children ?? [])
      if (isPenNode(child)) walk(child, inner, innerWithin);
  };
  for (const child of page.children ?? []) if (isPenNode(child)) walk(child, [], []);

  const byId = new Map(boxes.map((box) => [box.id, box]));
  const resolve = (raw: string): ArchEndpoint => {
    const text = canonicalName(raw);
    const groupName = groupNameOf(text);
    if (groupName !== null) {
      const hits = groups.filter((g) => g.name === groupName);
      const [hit] = hits;
      if (hits.length !== 1 || hit === undefined)
        return { kind: 'unresolved', text: raw, matches: hits.length };
      // A group stands for its modules: the path boxes no other path box encloses.
      const refs = [
        ...new Set(
          hit.boxIds.flatMap((id) => {
            const box = byId.get(id);
            return box !== undefined && box.within.length === 0 ? box.refs : [];
          }),
        ),
      ].sort();
      return { kind: 'group', text: raw, id: hit.id, refs };
    }
    const hits = boxes.filter((box) => box.name === text || box.refs.includes(text));
    const [hit] = hits;
    if (hits.length !== 1 || hit === undefined)
      return { kind: 'unresolved', text: raw, matches: hits.length };
    return { kind: 'box', text: raw, id: hit.id, refs: hit.name === text ? hit.refs : [text] };
  };

  const arrows: ArchArrow[] = [];
  for (const path of paths) {
    const ends = arrowEndsOf(path.name);
    if (ends !== null)
      arrows.push({ id: path.id, name: path.name, from: resolve(ends.from), to: resolve(ends.to) });
  }
  return { id: page.id, name: (page.name ?? '').trim(), role, boxes, groups, arrows };
}

/**
 * Read a `.pen` into the architecture model. Refuses only what is not a `.pen`
 * document at all; a malformed node inside one is skipped, since an
 * editor-saved file never holds one and the check reports whatever it misses.
 */
export function readArchPen(text: string): ArchPenResult {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `not JSON (${errMessage(err)})` };
  }
  const children =
    typeof doc === 'object' && doc !== null ? (doc as { children?: unknown }).children : undefined;
  if (!Array.isArray(children))
    return { ok: false, error: 'no top-level children array — not a .pen document' };
  const pages: ArchPage[] = [];
  for (const child of children) {
    if (!isPenNode(child)) continue;
    const role = pageRoleOf(child.name ?? '');
    if (role !== null) pages.push(readPage(child, role));
  }
  return { ok: true, doc: { pages } };
}
```

- [ ] **Step 4: Run the reader test to verify it passes.**

Run: `pnpm vitest run src/design/__tests__/arch-pen.test.ts`
Expected: PASS — 20 tests.

- [ ] **Step 5: Write the failing check test.** Replace the whole of `src/design/__tests__/arch-check.test.ts` with:

```ts
// @tests: architecture-design-phase
import { describe, expect, it } from 'vitest';

import { backed, checkArchDoc, type CodeTruth } from '../arch-check.js';
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
const box = (name: string, ...inside: Node[]): Node =>
  node('frame', name, [node('text', 'Label'), ...inside]);
const group = (name: string, ...children: Node[]): Node =>
  node('frame', `group: ${name}`, children);
const arrow = (name: string): Node => node('path', name);

function doc(...pages: Node[]): ArchDoc {
  const read = readArchPen(JSON.stringify({ version: '2.19', children: pages }));
  if (!read.ok) throw new Error(read.error);
  return read.doc;
}
const canvas = (...children: Node[]): ArchDoc => doc(node('frame', 'architecture', children));

const edge = (from: string, to: string): { from: string; to: string } => ({ from, to });
const TRUTH: CodeTruth = {
  modules: ['src/core', 'src/cr', 'src/utils'],
  pairs: new Set([pairKey('src/cr', 'src/core'), pairKey('src/core', 'src/utils')]),
  edges: [
    edge('src/cr/orchestrate.ts', 'src/core/config.ts'),
    edge('src/core/config.ts', 'src/utils/log.ts'),
    edge('src/cr/lanes/review.ts', 'src/cr/orchestrate.ts'),
    edge('src/cr/lanes/review.ts', 'src/cr/lanes/prompt.ts'),
  ],
  parts: new Set(['src/cr/lanes']),
};
const found = (d: ArchDoc): string[][] =>
  checkArchDoc(d, TRUTH).findings.map((f) => [f.kind, f.subject]);
const allModules = (...extra: Node[]): ArchDoc =>
  canvas(box('src/core'), box('src/cr'), box('src/utils'), ...extra);

describe('arch-check / the page', () => {
  it('needs exactly one architecture page, and names arch-draw when there is none', () => {
    const none = checkArchDoc(doc(node('frame', 'modules')), TRUTH).findings;
    expect(none.map((f) => f.kind)).toEqual(['unreadable']);
    expect(none[0]?.message).toContain('arch-draw');
    expect(
      found(doc(node('frame', 'architecture'), node('frame', 'architecture'))).map((f) => f[0]),
    ).toEqual(['unreadable']);
  });
});

describe('arch-check / modules', () => {
  it('names an uncovered module', () => {
    expect(found(canvas(box('src/core'), box('src/cr')))).toEqual([['missing-module', 'src/utils']]);
  });

  it('names a box that is not a module, and a module drawn twice', () => {
    expect(
      found(canvas(box('src/core'), box('src/cr + src/utils'), box('src/utils'), box('src/ghost'))),
    ).toEqual([
      ['unknown-module', 'src/ghost'],
      ['duplicate-module', 'src/utils'],
    ]);
  });

  it('refuses a part inside a multi-module box name', () => {
    expect(found(canvas(box('src/core'), box('src/cr + src/cr/lanes'), box('src/utils')))).toEqual([
      ['unknown-module', 'src/cr/lanes'],
    ]);
  });

  it('names an arrow end that resolves to nothing', () => {
    expect(found(allModules(arrow('src/cr -> src/nowhere')))).toEqual([
      ['dangling-edge', 'src/cr -> src/nowhere'],
    ]);
  });
});

describe('arch-check / parts', () => {
  it('passes a part that exists inside its module box', () => {
    expect(found(canvas(box('src/core'), box('src/cr', box('src/cr/lanes')), box('src/utils')))).toEqual(
      [],
    );
  });

  it('names a part that does not exist, and a part outside its module box', () => {
    expect(
      found(
        canvas(box('src/core'), box('src/cr', box('src/cr/ghost')), box('src/utils'), box('src/cr/lanes')),
      ),
    ).toEqual([
      ['unknown-part', 'src/cr/ghost'],
      ['misplaced-part', 'src/cr/lanes'],
    ]);
  });
});

describe('arch-check / arrows', () => {
  it('passes real arrows and advises on an import no arrow draws', () => {
    const result = checkArchDoc(allModules(arrow('src/cr -> src/core')), TRUTH);
    expect(result.findings).toEqual([]);
    expect(result.advisories.map((a) => [a.kind, a.subject])).toEqual([
      ['undrawn-edge', 'src/core -> src/utils'],
    ]);
  });

  it('names an arrow no import backs, and passes a group arrow one import backs', () => {
    expect(
      found(
        canvas(
          box('src/core'),
          group('Work', box('src/cr', box('src/cr/lanes'))),
          box('src/utils'),
          arrow('src/utils -> src/cr'),
          arrow('group: Work -> src/core'),
        ),
      ),
    ).toEqual([['phantom-edge', 'src/utils -> src/cr']]);
  });

  it('passes a multi-module arrow when any expanded pair imports', () => {
    expect(
      found(canvas(box('src/core + src/utils'), box('src/cr'), arrow('src/cr -> src/core + src/utils'))),
    ).toEqual([]);
  });

  it('never advises on an import between two modules that share one box', () => {
    const result = checkArchDoc(
      canvas(box('src/core + src/utils'), box('src/cr'), arrow('src/cr -> src/core')),
      TRUTH,
    );
    expect(result.advisories).toEqual([]);
  });

  it('holds a part arrow to the files, and a nested arrow to the files outside the inner path', () => {
    expect(
      found(
        canvas(
          box('src/core'),
          box('src/cr', box('src/cr/lanes')),
          box('src/utils'),
          arrow('src/cr/lanes -> src/cr'),
          arrow('src/cr -> src/cr/lanes'),
          arrow('src/cr/lanes -> src/core'),
        ),
      ),
    ).toEqual([
      ['phantom-edge', 'src/cr -> src/cr/lanes'],
      ['phantom-edge', 'src/cr/lanes -> src/core'],
    ]);
  });

  it('holds an arrow to an external, container or store to resolving only', () => {
    expect(
      found(
        allModules(
          box('container: CLI'),
          box('external: git'),
          arrow('container: CLI -> external: git'),
          arrow('src/cr -> external:git'),
          arrow('container: CLI -> external: npm'),
        ),
      ),
    ).toEqual([['dangling-edge', 'container: CLI -> external: npm']]);
  });
});

describe('arch-check / backed', () => {
  const edges = TRUTH.edges;
  it('reads imports across two disjoint paths', () => {
    expect(backed(['src/cr'], ['src/core'], edges)).toBe(true);
    expect(backed(['src/core'], ['src/cr'], edges)).toBe(false);
  });

  it('lets imports inside the inner of two nested paths back neither direction', () => {
    expect(backed(['src/cr/lanes'], ['src/cr'], edges)).toBe(true);
    expect(backed(['src/cr'], ['src/cr/lanes'], edges)).toBe(false);
    expect(backed(['src/cr/lanes'], ['src/cr/lanes'], edges)).toBe(false);
  });
});
```

- [ ] **Step 6: Run it to verify it fails.**

Run: `pnpm vitest run src/design/__tests__/arch-check.test.ts`
Expected: FAIL — `backed is not a function`, and the old rules still ask for four view pages.

- [ ] **Step 7: Rewrite the rules.** Replace the whole of `src/design/arch-check.ts` with:

```ts
// @fd: architecture-design-phase
// The honesty rules for the architecture baseline (spec: "Honesty check"): is
// there exactly one `architecture` page, is every module boxed once, does every
// part exist and sit inside its module, is every arrow that touches code backed
// by an import, and does every arrow end on something? Pure — the model and the
// code truth in, findings out — so each rule is a unit test; `arch-baseline.ts`
// gathers the inputs.

import { ARCH_PAGE, pairKey, type ArchDoc, type ArchPage, type FileEdge } from './arch-pen.js';

export type ArchFindingKind =
  | 'unreadable'
  | 'missing-module'
  | 'unknown-module'
  | 'duplicate-module'
  | 'unknown-part'
  | 'misplaced-part'
  | 'dangling-edge'
  | 'phantom-edge';

export interface ArchFinding {
  readonly kind: ArchFindingKind;
  /** What it names: a module or part path, an arrow, the page or a file. */
  readonly subject: string;
  readonly message: string;
}

/** Reported, never blocking: a module import no arrow draws. */
export interface ArchAdvisory {
  readonly kind: 'undrawn-edge';
  readonly subject: string;
  readonly message: string;
}

export interface ArchCheckResult {
  readonly findings: readonly ArchFinding[];
  readonly advisories: readonly ArchAdvisory[];
}

/** The code the baseline is held to — everything `arch-baseline.ts` gathers. */
export interface CodeTruth {
  readonly modules: readonly string[];
  /** Module import pairs, `from -> to`. */
  readonly pairs: ReadonlySet<string>;
  readonly edges: readonly FileEdge[];
  /** The part paths the baseline names that exist on disk. */
  readonly parts: ReadonlySet<string>;
}

const KIND_ORDER: readonly ArchFindingKind[] = [
  'unreadable',
  'missing-module',
  'unknown-module',
  'duplicate-module',
  'unknown-part',
  'misplaced-part',
  'dangling-edge',
  'phantom-edge',
];

/** `file` is `path` itself or sits inside it. */
export function isUnder(file: string, path: string): boolean {
  return file === path || file.startsWith(`${path}/`);
}

/** The module `path` is or sits under, or `null`. */
function moduleOfPath(path: string, modules: readonly string[]): string | null {
  return modules.find((mod) => isUnder(path, mod)) ?? null;
}

/**
 * Whether a file of the `from` end imports a file of the `to` end. When one
 * end's path is inside the other's, the outer end stands only for its files
 * outside the inner path, so an import inside the inner path backs neither
 * direction (spec: "Honesty check").
 */
export function backed(
  from: readonly string[],
  to: readonly string[],
  edges: readonly FileEdge[],
): boolean {
  return from.some((f) =>
    to.some((t) => {
      if (f === t) return false;
      const fromIsOuter = isUnder(t, f);
      const toIsOuter = isUnder(f, t);
      return edges.some(
        (e) =>
          isUnder(e.from, f) &&
          isUnder(e.to, t) &&
          !(fromIsOuter && isUnder(e.from, t)) &&
          !(toIsOuter && isUnder(e.to, f)),
      );
    }),
  );
}

/**
 * Hold a baseline to the code: one `architecture` page, every arrow end
 * resolving, each module boxed once, each part real and inside its module, and
 * no arrow that touches code without an import behind it. A module import no
 * arrow draws is advisory — a page that had to draw every import would be a
 * hairball.
 */
export function checkArchDoc(doc: ArchDoc, truth: CodeTruth): ArchCheckResult {
  const findings: ArchFinding[] = [];
  const advisories: ArchAdvisory[] = [];
  const pages = doc.pages.filter((page) => page.role === 'baseline');
  const [page] = pages;
  if (pages.length !== 1 || page === undefined) {
    findings.push({
      kind: 'unreadable',
      subject: ARCH_PAGE,
      message:
        pages.length === 0
          ? `the baseline has no \`${ARCH_PAGE}\` page — draw one with \`pnpm noldor design arch-draw\``
          : `the baseline has ${pages.length} \`${ARCH_PAGE}\` pages — keep one`,
    });
    return { findings, advisories };
  }

  for (const arrow of page.arrows) {
    for (const end of [arrow.from, arrow.to]) {
      if (end.kind !== 'unresolved') continue;
      findings.push({
        kind: 'dangling-edge',
        subject: arrow.name,
        message:
          end.matches === 0
            ? `\`${end.text}\` names nothing on the page`
            : `\`${end.text}\` names ${end.matches} boxes — rename all but one`,
      });
    }
  }
  checkBoxes(page, truth, findings);
  checkArrows(page, truth, findings, advisories);

  findings.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      a.subject.localeCompare(b.subject, 'en'),
  );
  advisories.sort((a, b) => a.subject.localeCompare(b.subject, 'en'));
  return { findings, advisories };
}

function checkBoxes(page: ArchPage, truth: CodeTruth, findings: ArchFinding[]): void {
  const known = new Set(truth.modules);
  const coveredBy = new Map<string, string[]>();
  for (const box of page.boxes) {
    for (const ref of box.refs) {
      if (known.has(ref)) {
        coveredBy.set(ref, [...(coveredBy.get(ref) ?? []), box.name]);
        continue;
      }
      // A part is one path under a module; a `+` box joins modules only.
      const mod = box.refs.length === 1 ? moduleOfPath(ref, truth.modules) : null;
      if (mod === null) {
        findings.push({
          kind: 'unknown-module',
          subject: ref,
          message: `box \`${box.name}\` names ${ref}, which is not a module`,
        });
        continue;
      }
      if (!truth.parts.has(ref))
        findings.push({ kind: 'unknown-part', subject: ref, message: `part ${ref} does not exist` });
      if (!box.within.includes(mod))
        findings.push({
          kind: 'misplaced-part',
          subject: ref,
          message: `part ${ref} is not inside the ${mod} box`,
        });
    }
  }
  for (const mod of truth.modules) {
    const boxes = coveredBy.get(mod) ?? [];
    if (boxes.length === 0)
      findings.push({ kind: 'missing-module', subject: mod, message: `no box covers ${mod}` });
    if (boxes.length > 1)
      findings.push({
        kind: 'duplicate-module',
        subject: mod,
        message: `${mod} is covered by ${boxes.length} boxes: ${boxes.join(', ')}`,
      });
  }
}

function checkArrows(
  page: ArchPage,
  truth: CodeTruth,
  findings: ArchFinding[],
  advisories: ArchAdvisory[],
): void {
  /** Module pairs some arrow draws, for the undrawn-edge advisory. */
  const drawn = new Set<string>();
  for (const arrow of page.arrows) {
    if (arrow.from.kind === 'unresolved' || arrow.to.kind === 'unresolved') continue;
    const from = arrow.from.refs;
    const to = arrow.to.refs;
    // An end that names no code path (an external, container, store or free name) holds the arrow to resolving only.
    if (from.length === 0 || to.length === 0) continue;
    for (const a of from) {
      for (const b of to) {
        const ma = moduleOfPath(a, truth.modules);
        const mb = moduleOfPath(b, truth.modules);
        if (ma !== null && mb !== null && ma !== mb) drawn.add(pairKey(ma, mb));
      }
    }
    if (backed(from, to, truth.edges)) continue;
    findings.push({
      kind: 'phantom-edge',
      subject: arrow.name,
      message: `no import from ${from.join(' + ')} into ${to.join(' + ')}`,
    });
  }

  /** Module → the id of the first box covering it, for the internal-import test. */
  const homeBox = new Map<string, string>();
  for (const box of page.boxes)
    for (const ref of box.refs) if (!homeBox.has(ref)) homeBox.set(ref, box.id);
  for (const pair of truth.pairs) {
    const [a, b] = pair.split(' -> ');
    if (a === undefined || b === undefined) continue;
    const home = homeBox.get(a);
    const away = homeBox.get(b);
    // An uncovered module is already `missing-module`; an import inside one box is not an edge.
    if (home === undefined || away === undefined || home === away) continue;
    if (drawn.has(pair)) continue;
    advisories.push({
      kind: 'undrawn-edge',
      subject: pair,
      message: `${a} imports ${b}, but no arrow shows it`,
    });
  }
}
```

- [ ] **Step 8: Run both tests to verify they pass.**

Run: `pnpm vitest run src/design/__tests__/arch-pen.test.ts src/design/__tests__/arch-check.test.ts`
Expected: PASS — 20 + 15 tests.

- [ ] **Step 9: Commit.**

```bash
git add src/design/arch-pen.ts src/design/arch-check.ts src/design/__tests__/arch-pen.test.ts src/design/__tests__/arch-check.test.ts
cat > "$(git rev-parse --git-dir)/TASK_MSG" <<'EOF'
feat(design): read and check one detailed architecture page

The reader wants one top-level `architecture` page instead of four view pages, and reads three outer-layer prefixes (external:, container:, store:) with canonical spacing. A path box now knows the paths of the path boxes around it, so a part inside a module box is told apart from a module. The rules gain unknown-part and misplaced-part, and hold every arrow that touches code to the file graph, with the outer of two nested ends counting only its files outside the inner one. Arrows touching an outer layer are held to resolving only.

Noldor-FD: architecture-design-phase
EOF
git commit -F "$(git rev-parse --git-dir)/TASK_MSG"
```

---

## Task 3: Move every caller to the one page

**Files:**
- Modify: `src/design/arch-baseline.ts`
- Modify: `src/checks/check-arch-baseline.ts`
- Modify: `src/design/arch-route.ts`
- Modify: `src/design/arch-progress.ts`
- Modify: `src/design/design-approval-cli.ts`
- Modify: `src/cli/manifest.ts`
- Test: `src/checks/__tests__/check-arch-baseline.test.ts`
- Test: `src/design/__tests__/arch-route.test.ts`
- Test: `src/design/__tests__/arch-progress.test.ts`
- Test: `src/design/__tests__/design-approval.test.ts`

- [ ] **Step 1: Write the failing check-CLI tests.** In `src/checks/__tests__/check-arch-baseline.test.ts`, replace the `writeBaseline` function with:

```ts
/** Write a baseline whose one `architecture` page holds `children`. */
async function writeBaseline(root: string, children: Node[] | string): Promise<void> {
  await mkdir(join(root, 'docs', 'design', 'architecture'), { recursive: true });
  const body =
    typeof children === 'string'
      ? children
      : JSON.stringify({ version: '2.19', children: [node('frame', 'architecture', children)] });
  await writeFile(join(root, 'docs', 'design', 'architecture', 'baseline.pen'), body, 'utf8');
}
```

and add these tests at the end of the `describe('checks arch-baseline', …)` block:

```ts
  it('exits 0 on a real part inside its module, with an arrow its files back', async () => {
    const root = await makeRepo();
    await mkdir(join(root, 'src', 'a', 'inner'), { recursive: true });
    await writeFile(
      join(root, 'src', 'a', 'inner', 'q.ts'),
      "import { y } from '../../b/y.js';\n\nexport const q = (): string => y();\n",
      'utf8',
    );
    await writeBaseline(root, [
      node('frame', 'src/a', [node('frame', 'src/a/inner')]),
      node('frame', 'src/b'),
      node('path', 'src/a/inner -> src/b'),
    ]);
    const r = await run(root);
    expect(r.code).toBe(0);
    expect(r.out).toContain('ok');
  });

  it('exits 1 and names a part that does not exist', async () => {
    const root = await makeRepo();
    await writeBaseline(root, [node('frame', 'src/a', [node('frame', 'src/a/ghost')]), node('frame', 'src/b')]);
    const r = await run(root);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/unknown-part\s+src\/a\/ghost/);
  });

  it('exits 1 on the old four-page baseline, naming arch-draw', async () => {
    const root = await makeRepo();
    await writeBaseline(
      root,
      JSON.stringify({ version: '2.19', children: [node('frame', 'modules', [node('frame', 'src/a')])] }),
    );
    const r = await run(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain('arch-draw');
  });
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm vitest run src/checks/__tests__/check-arch-baseline.test.ts`
Expected: FAIL — `checkArchDoc` receives the old positional arguments, so the part tests do not report as specified.

- [ ] **Step 3: Gather the new code truth.** In `src/design/arch-baseline.ts`, replace the header comment and imports with:

```ts
// @fd: architecture-design-phase
// The architecture honesty check with its inputs gathered: the baseline read
// from disk, the module set from the code (`listModuleDirs`), the import pairs
// and file edges from one dependency-cruiser pass (`moduleImportPairs`), and
// which of the baseline's part paths exist. Shared by `checks arch-baseline`
// and the release preflight row — which is why it lives here rather than in
// the CLI file: src/release never imports src/checks.

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { ARCH_BASELINE_PATH } from '../core/design-artifact-names.js';
import { errMessage } from '../core/err-message.js';
import { scanRoots } from '../core/repo-paths.js';
import { listModuleDirs } from '../docs/docs-architecture.js';
import { moduleImportPairs } from '../indirection/module-pairs.js';
import { checkArchDoc, type ArchAdvisory, type ArchFinding } from './arch-check.js';
import { readArchPen, type ArchDoc } from './arch-pen.js';
```

Replace the `unreadable` function with:

```ts
function unreadable(subject: string, message: string): ArchBaselineReport {
  return {
    status: 'incomplete',
    findings: [{ kind: 'unreadable', subject, message }],
    advisories: [],
  };
}
```

Replace the last two lines of `checkArchBaseline` (`const result = …` and its `return`) with:

```ts
  const result = checkArchDoc(read.doc, {
    modules,
    pairs: pairs.pairs,
    edges: pairs.edges,
    parts: await existingParts(cwd, read.doc, modules),
  });
  return { status: result.findings.length === 0 ? 'ok' : 'incomplete', ...result };
}

/** The part paths the baseline names that exist on disk. A part is a path under a module, never a module itself. */
async function existingParts(
  cwd: string,
  doc: ArchDoc,
  modules: readonly string[],
): Promise<Set<string>> {
  const known = new Set(modules);
  const candidates = new Set(
    doc.pages
      .flatMap((page) => page.boxes.flatMap((box) => box.refs))
      .filter((ref) => !known.has(ref) && modules.some((mod) => ref.startsWith(`${mod}/`))),
  );
  const found = new Set<string>();
  for (const path of candidates) {
    try {
      await stat(join(cwd, path));
      found.add(path);
    } catch {
      // Absent — the check reports it as `unknown-part`.
    }
  }
  return found;
}
```

- [ ] **Step 4: Drop the view column.** In `src/checks/check-arch-baseline.ts`, replace the `row` function and the two `row(…)` call sites so the file reads:

```ts
export function row(kind: string, subject: string, message: string): string {
  return `  ${kind.padEnd(17)} ${subject} — ${message}`;
}
```

with `...report.findings.map((f) => row(f.kind, f.subject, f.message)),` and `lines.push(...report.advisories.map((a) => row(a.kind, a.subject, a.message)));` at the two call sites.

- [ ] **Step 5: Run the check-CLI test to verify it passes.**

Run: `pnpm vitest run src/checks/__tests__/check-arch-baseline.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 6: Write the failing re-route test.** In `src/design/__tests__/arch-route.test.ts`, change `name: 'modules',` in `PAGE` to `name: 'architecture',`. Replace the first `it(…)` in `describe('design arch-route', …)` with:

```ts
  it("routes every arrow whose ends resolve with the check's own reader, and names the rest", () => {
    const { edges, unresolved } = routeEdges(read.doc);
    expect(edges).toEqual([{ id: 'E', name: 'src/cr -> src/core', page: 'P', from: 'A', to: 'B' }]);
    expect(unresolved).toEqual(['architecture: src/cr -> src/nowhere']);
  });
```

and replace the last `it(…)` with:

```ts
  it('exits 0 printing the snippet, 1 with nothing to route, and 2 on bad arguments', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'arch-route-'));
    dirs.push(cwd);
    writeFileSync(join(cwd, 'design.pen'), PEN_TEXT);
    writeFileSync(
      join(cwd, 'empty.pen'),
      JSON.stringify({ version: '2.19', children: [{ id: 'Q', type: 'frame', name: 'architecture' }] }),
    );
    const out: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      out.push(a.join(' '));
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await main(['--pen', 'design.pen'], cwd)).toBe(0);
      expect(out.join('\n')).toContain('"id":"E"');
      expect(await main(['--pen', 'empty.pen'], cwd)).toBe(1);
      expect(await main(['--pen', 'missing.pen'], cwd)).toBe(2);
      expect(await main([], cwd)).toBe(2);
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
```

- [ ] **Step 7: Route every arrow on the page.** In `src/design/arch-route.ts`, replace the import block with:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { optionalFlag, runIfDirect } from '../core/cli-entry.js';
import { errMessage } from '../core/err-message.js';
import { readArchPen, type ArchDoc } from './arch-pen.js';
```

replace `routeEdges` with:

```ts
/** Every arrow whose ends resolve, on every page; the others are named, not routed. */
export function routeEdges(doc: ArchDoc): { edges: RouteEdge[]; unresolved: string[] } {
  const edges: RouteEdge[] = [];
  const unresolved: string[] = [];
  for (const page of doc.pages) {
    for (const arrow of page.arrows) {
      if (arrow.from.kind === 'unresolved' || arrow.to.kind === 'unresolved') {
        unresolved.push(`${page.name}: ${arrow.name}`);
        continue;
      }
      edges.push({
        id: arrow.id,
        name: arrow.name,
        page: page.id,
        from: arrow.from.id,
        to: arrow.to.id,
      });
    }
  }
  return { edges, unresolved };
}
```

and replace `main` with:

```ts
/** Exit 0 = snippet printed, 1 = no arrow to route, 2 = bad arguments or an unreadable `.pen`. */
export async function main(argv: readonly string[], cwd: string = process.cwd()): Promise<number> {
  const label = 'design arch-route';
  const pen = optionalFlag(argv, '--pen', label);
  if (!pen.ok) {
    console.error(pen.error);
    return 2;
  }
  if (pen.value === undefined || !pen.value.endsWith('.pen')) {
    console.error(`${label}: --pen <path.pen> is required`);
    return 2;
  }
  let text: string;
  try {
    text = readFileSync(resolve(cwd, pen.value), 'utf8');
  } catch (err) {
    console.error(`${label}: ${pen.value}: ${errMessage(err)}`);
    return 2;
  }
  const read = readArchPen(text);
  if (!read.ok) {
    console.error(`${label}: ${pen.value}: ${read.error}`);
    return 2;
  }
  const { edges, unresolved } = routeEdges(read.doc);
  for (const name of unresolved)
    console.error(`${label}: not routed, an end does not resolve: ${name}`);
  if (edges.length === 0) {
    console.error(`${label}: no arrow to route`);
    return 1;
  }
  console.log(renderRouteSnippet(edges));
  return 0;
}
```

- [ ] **Step 8: Write the failing progress test.** Replace the whole of `src/design/__tests__/arch-progress.test.ts` with:

```ts
// @tests: architecture-design-phase
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readArchPen, type ArchDoc } from '../arch-pen.js';
import { compareToTarget, main } from '../arch-progress.js';

interface Node {
  id: string;
  type: string;
  name: string;
  children?: Node[];
}
let seq = 0;
const node = (type: string, name: string, children: Node[] = []): Node => ({
  id: `n${++seq}`,
  type,
  name,
  children,
});
const text = (...pages: Node[]): string => JSON.stringify({ version: '2.19', children: pages });
function doc(...pages: Node[]): ArchDoc {
  const read = readArchPen(text(...pages));
  if (!read.ok) throw new Error(read.error);
  return read.doc;
}

const BASELINE = [
  node('frame', 'architecture', [
    node('frame', 'external:git'),
    node('frame', 'src/a', [node('frame', 'src/a/inner')]),
    node('frame', 'src/b'),
    node('frame', 'src/old'),
    node('path', 'src/b -> src/a'),
  ]),
];
const TARGET = [
  node('frame', 'BASE:architecture: as-built'),
  node('frame', 'FINAL:architecture: add a queue', [
    node('frame', 'external: git'),
    node('frame', 'src/a', [node('frame', 'src/a/inner')]),
    node('frame', 'src/b'),
    node('frame', 'src/queue'),
    node('path', 'src/queue->src/a'),
  ]),
];

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('design arch-progress', () => {
  it('lists what the target adds, what it removes and what is done', () => {
    expect(compareToTarget(doc(...TARGET), doc(...BASELINE))).toEqual({
      toBuild: ['arrow: src/queue -> src/a', 'box: src/queue'],
      toRemove: ['arrow: src/b -> src/a', 'box: src/old'],
      done: ['box: external: git', 'box: src/a', 'box: src/a/inner', 'box: src/b'],
    });
  });

  it('reports nothing planned for a target with no FINAL: page', () => {
    expect(compareToTarget(doc(node('frame', 'BASE:architecture: as-built')), doc(...BASELINE))).toBeNull();
  });

  it('exits 0 with the report, 1 when the target is missing, 2 on a bad slug', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'arch-progress-'));
    dirs.push(cwd);
    mkdirSync(join(cwd, 'docs', 'design', 'architecture', 'milestones'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'design', 'architecture', 'baseline.pen'), text(...BASELINE));
    writeFileSync(join(cwd, 'docs', 'design', 'architecture', 'milestones', 'm1.pen'), text(...TARGET));
    const out: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      out.push(a.join(' '));
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await main(['--milestone', 'm1'], cwd)).toBe(0);
      expect(out.join('\n')).toMatch(/to-build\s+box: src\/queue/);
      expect(await main(['--milestone', 'm2'], cwd)).toBe(1);
      expect(await main(['--milestone', 'Not A Slug'], cwd)).toBe(2);
      expect(await main([], cwd)).toBe(2);
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});
```

- [ ] **Step 9: Compare one page.** Replace the whole of `src/design/arch-progress.ts` with:

```ts
// @fd: architecture-design-phase
// `noldor design arch-progress --milestone <slug>` — how far the as-built
// baseline still is from a milestone's target architecture (spec: "Milestone
// target"). The target's FINAL:architecture: pages are held against the
// baseline's one page, by name: modules and parts by path, other boxes by
// canonical layer name, arrows by canonical `<from> -> <to>`. A target with no
// FINAL: page is "no change planned" and reports nothing. Advisory by design:
// milestones are optional and never block, so the report always exits 0 once
// it can read.

import { optionalFlag, runIfDirect } from '../core/cli-entry.js';
import { ARCH_BASELINE_PATH, milestonePenPath } from '../core/design-artifact-names.js';
import { readRepoText } from '../core/read-text.js';
import { isSlug } from '../core/slug.js';
import {
  arrowEndsOf,
  canonicalName,
  pairKey,
  readArchPen,
  type ArchDoc,
  type ArchPage,
} from './arch-pen.js';

export interface Progress {
  /** In the target, not yet in the baseline. */
  readonly toBuild: readonly string[];
  /** In the baseline, gone from the target. */
  readonly toRemove: readonly string[];
  readonly done: readonly string[];
}

/** What a page is made of, as comparable labels: `box: <path or name>` and `arrow: <from> -> <to>`. */
function itemsOf(page: ArchPage): string[] {
  const items: string[] = [];
  for (const box of page.boxes) {
    const names = box.refs.length > 0 ? box.refs : [box.name];
    for (const name of names) items.push(`box: ${name}`);
  }
  for (const arrow of page.arrows) {
    const ends = arrowEndsOf(arrow.name);
    if (ends !== null)
      items.push(`arrow: ${pairKey(canonicalName(ends.from), canonicalName(ends.to))}`);
  }
  return items;
}

/** The target's FINAL: pages against the baseline page, or `null` when the target plans nothing. */
export function compareToTarget(target: ArchDoc, baseline: ArchDoc): Progress | null {
  const finals = target.pages.filter((page) => page.role === 'final');
  if (finals.length === 0) return null;
  const want = new Set(finals.flatMap(itemsOf));
  const have = new Set(
    baseline.pages.filter((page) => page.role === 'baseline').flatMap(itemsOf),
  );
  return {
    toBuild: [...want].filter((item) => !have.has(item)).sort(),
    toRemove: [...have].filter((item) => !want.has(item)).sort(),
    done: [...want].filter((item) => have.has(item)).sort(),
  };
}

function readDoc(
  cwd: string,
  rel: string,
): { ok: true; doc: ArchDoc } | { ok: false; error: string } {
  const file = readRepoText(cwd, rel);
  if (!file.ok) return file;
  const read = readArchPen(file.text);
  return read.ok ? read : { ok: false, error: `${rel}: ${read.error}` };
}

/** Exit 0 = report printed, 1 = the target or the baseline cannot be read, 2 = bad arguments. */
export async function main(argv: readonly string[], cwd: string = process.cwd()): Promise<number> {
  const label = 'design arch-progress';
  const flag = optionalFlag(argv, '--milestone', label);
  if (!flag.ok) {
    console.error(flag.error);
    return 2;
  }
  const slug = flag.value;
  if (slug === undefined || !isSlug(slug)) {
    console.error(`${label}: --milestone <slug> is required, and must be a milestone slug`);
    return 2;
  }
  const target = readDoc(cwd, milestonePenPath(slug));
  if (!target.ok) {
    console.error(`${label}: no readable target — ${target.error}`);
    return 1;
  }
  const baseline = readDoc(cwd, ARCH_BASELINE_PATH);
  if (!baseline.ok) {
    console.error(`${label}: no readable baseline — ${baseline.error}`);
    return 1;
  }
  const progress = compareToTarget(target.doc, baseline.doc);
  if (progress === null) {
    console.log(`arch-progress: milestone ${slug} — no FINAL: page, nothing planned`);
    return 0;
  }
  console.log(
    `arch-progress: milestone ${slug} — ${progress.toBuild.length} to build, ${progress.toRemove.length} to remove, ${progress.done.length} done`,
  );
  for (const item of progress.toBuild) console.log(`  to-build   ${item}`);
  for (const item of progress.toRemove) console.log(`  to-remove  ${item}`);
  console.log(`  done       ${progress.done.length} item(s)`);
  return 0;
}

runIfDirect('arch-progress', 'design arch-progress', async (argv) => main(argv));
```

- [ ] **Step 10: Move the verdict tests to the one surface.** Run:

```bash
perl -0pi -e "s/'BASE:modules: as-built'/'BASE:architecture: as-built'/g; s/FINAL:modules: split cr/FINAL:architecture: split cr/g; s/\['modules'\]/['architecture']/g; s/^(\s+)'modules',\n/\$1'architecture',\n/mg; s/not an architecture view/not an architecture surface/g" src/design/__tests__/design-approval.test.ts
grep -n "modules" src/design/__tests__/design-approval.test.ts
```

Expected: the `grep` prints nothing.

- [ ] **Step 11: Run the progress, route and verdict tests to verify they fail.**

Run: `pnpm vitest run src/design/__tests__/arch-progress.test.ts src/design/__tests__/arch-route.test.ts src/design/__tests__/design-approval.test.ts`
Expected: arch-progress and arch-route PASS (Steps 7 and 9 already landed). design-approval FAILS: `--surface architecture` is refused as not an architecture view.

- [ ] **Step 12: Take `architecture` as the surface.** In `src/design/design-approval-cli.ts`, replace `import { ARCH_VIEWS } from './arch-pen.js';` with `import { ARCH_PAGE } from './arch-pen.js';`, and replace the block

```ts
  if (ctx.pen.kind === 'architecture') {
    const views: readonly string[] = ARCH_VIEWS;
    const stray = mode.surfaces.filter((surface) => !views.includes(surface));
    if (stray.length > 0) {
      return fail(
        `--surface ${stray.join(', ')} is not an architecture view (${views.join(' | ')})`,
        2,
      );
    }
  }
```

with

```ts
  if (ctx.pen.kind === 'architecture') {
    const stray = mode.surfaces.filter((surface) => surface !== ARCH_PAGE);
    if (stray.length > 0) {
      return fail(
        `--surface ${stray.join(', ')} is not an architecture surface — the only one is ${ARCH_PAGE}`,
        2,
      );
    }
  }
```

- [ ] **Step 13: Update the progress description.** In `src/cli/manifest.ts`, set the `arch-progress` entry's `desc` to:

```ts
        desc: "How far the architecture baseline is from a milestone's target: to-build / to-remove / done; advisory",
```

- [ ] **Step 14: Run every architecture test, the typecheck and the lint.**

Run: `pnpm vitest run src/design src/checks/__tests__/check-arch-baseline.test.ts src/indirection && pnpm typecheck && pnpm lint`
Expected: every test PASSES, and typecheck and lint exit 0.

- [ ] **Step 15: Commit.**

```bash
git add src/design/arch-baseline.ts src/checks/check-arch-baseline.ts src/design/arch-route.ts src/design/arch-progress.ts src/design/design-approval-cli.ts src/cli/manifest.ts src/checks/__tests__/check-arch-baseline.test.ts src/design/__tests__/arch-route.test.ts src/design/__tests__/arch-progress.test.ts src/design/__tests__/design-approval.test.ts
cat > "$(git rev-parse --git-dir)/TASK_MSG" <<'EOF'
feat(design): move the architecture check, re-route, progress and verdict to one page

checks arch-baseline gathers the file edges and the existing part paths and prints rows without a view column. design arch-route routes every arrow on the page and drops --view. design arch-progress compares the target's FINAL: page with the one baseline page. design verdict takes `architecture` as the only surface of an architecture .pen.

Noldor-FD: architecture-design-phase
EOF
git commit -F "$(git rev-parse --git-dir)/TASK_MSG"
```

---

## Task 4: A create that never replaces

`src/autonomous/drain-lock.ts` keeps its own private `linkIfAbsent`: its header pins it to Node builtins only, because vitest loads it as a globalSetup through vite-node.

**Files:**
- Modify: `src/core/atomic-write.ts`
- Test: `src/core/__tests__/atomic-write.test.ts`

- [ ] **Step 1: Write the failing test.** In `src/core/__tests__/atomic-write.test.ts`, change line 1 to `// @tests: state-file-fail-open-hardening, architecture-design-phase`, change the `../atomic-write.js` import to

```ts
import { atomicWriteFileSync, writeFileSyncIfAbsent } from '../atomic-write.js';
```

and add at the end of the file:

```ts
describe('writeFileSyncIfAbsent', () => {
  it('creates the file whole, and leaves no staged file behind', () => {
    const dir = mkdtempSync(join(tmpdir(), 'if-absent-'));
    expect(writeFileSyncIfAbsent(join(dir, 'a.pen'), 'first')).toBe(true);
    expect(readFileSync(join(dir, 'a.pen'), 'utf8')).toBe('first');
    expect(readdirSync(dir)).toEqual(['a.pen']);
  });

  it('never replaces a file that exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'if-absent-'));
    writeFileSync(join(dir, 'a.pen'), 'mine');
    expect(writeFileSyncIfAbsent(join(dir, 'a.pen'), 'theirs')).toBe(false);
    expect(readFileSync(join(dir, 'a.pen'), 'utf8')).toBe('mine');
    expect(readdirSync(dir)).toEqual(['a.pen']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm vitest run src/core/__tests__/atomic-write.test.ts`
Expected: FAIL — `writeFileSyncIfAbsent is not a function`.

- [ ] **Step 3: Add the helper.** In `src/core/atomic-write.ts`, replace the first three import lines with:

```ts
import { randomUUID } from 'node:crypto';
import { linkSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
```

and add after `atomicWriteFileSync`:

```ts
/**
 * Create `target` with `content` unless it already exists, and say which. The
 * content goes to a staged sibling that is hard-linked into place: the link
 * fails with `EEXIST` when `target` exists, so two writers racing cannot both
 * win, and `target` appears whole or not at all. The staged file is always
 * removed. `true` = created, `false` = `target` was already there.
 */
export function writeFileSyncIfAbsent(target: string, content: string): boolean {
  const staged = join(dirname(target), `${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  writeFileSync(staged, content, { encoding: 'utf8', flag: 'wx' });
  try {
    linkSync(staged, target);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  } finally {
    rmSync(staged, { force: true });
  }
}
```

- [ ] **Step 4: Run it to verify it passes.**

Run: `pnpm vitest run src/core/__tests__/atomic-write.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/core/atomic-write.ts src/core/__tests__/atomic-write.test.ts
cat > "$(git rev-parse --git-dir)/TASK_MSG" <<'EOF'
feat(core): add a file create that never replaces

writeFileSyncIfAbsent stages the content and hard-links it into place, the pattern the drain lock uses, so the first architecture draw cannot race another one or leave a half-written baseline.

Noldor-FD: architecture-design-phase
EOF
git commit -F "$(git rev-parse --git-dir)/TASK_MSG"
```

---

## Task 5: `design arch-draw` draws the first baseline

**Files:**
- Create: `src/design/arch-draw.ts`
- Modify: `src/cli/manifest.ts`
- Modify: `docs/noldor/script-catalog.md`, `templates/docs/noldor/script-catalog.md`
- Modify: `AGENTS.md`, `templates/AGENTS.md` (regenerated)
- Test: `src/design/__tests__/arch-draw.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/design/__tests__/arch-draw.test.ts`:

```ts
// @tests: architecture-design-phase
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkArchBaseline } from '../arch-baseline.js';
import { checkArchDoc } from '../arch-check.js';
import { drawBaseline, listPartDirs, main } from '../arch-draw.js';
import { readArchPen, type ArchPage } from '../arch-pen.js';

const BASELINE = join('docs', 'design', 'architecture', 'baseline.pen');
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

/** A repo whose `src/a` (with a part `src/a/inner`) imports `src/b`, with a schema-valid config. */
async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'arch-draw-'));
  roots.push(root);
  await mkdir(join(root, '.noldor'), { recursive: true });
  await writeFile(
    join(root, '.noldor', 'config.json'),
    JSON.stringify({
      consumer: {
        name: 'fixture',
        repoUrl: 'https://example.com/fixture',
        lockstepPackages: ['package.json'],
        scanPaths: ['src'],
        e2ePrefix: 'e2e',
        samplesPath: 'samples',
        packagePrefix: '@fixture/',
        appPathPrefix: 'apps/',
      },
    }),
    'utf8',
  );
  for (const dir of ['a/inner', 'a/__tests__', 'a/fixtures', 'b'])
    await mkdir(join(root, 'src', dir), { recursive: true });
  await writeFile(
    join(root, 'src', 'a', 'x.ts'),
    "import { y } from '../b/y.js';\n\nexport const x = (): string => y();\n",
    'utf8',
  );
  await writeFile(join(root, 'src', 'a', 'inner', 'q.ts'), 'export const q = 1;\n', 'utf8');
  await writeFile(join(root, 'src', 'b', 'y.ts'), "export const y = (): string => 'y';\n", 'utf8');
  return root;
}

async function run(argv: string[], root: string): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const push = (...a: unknown[]): void => {
    lines.push(a.join(' '));
  };
  const log = vi.spyOn(console, 'log').mockImplementation(push);
  const error = vi.spyOn(console, 'error').mockImplementation(push);
  try {
    return { code: await main(argv, root), out: lines.join('\n') };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

function onlyPage(text: string): ArchPage {
  const read = readArchPen(text);
  if (!read.ok) throw new Error(read.error);
  const [page, ...rest] = read.doc.pages;
  if (page === undefined || rest.length > 0) throw new Error('expected exactly one page');
  return page;
}

const INPUT = { modules: ['src/a', 'src/b'], parts: new Map([['src/a', ['src/a/inner']]]) };

describe('design arch-draw / drawBaseline', () => {
  it('boxes every module once in group: Unplaced, its parts inside it, and draws no arrow', () => {
    const page = onlyPage(drawBaseline(INPUT));
    expect(page.name).toBe('architecture');
    expect(page.boxes.filter((b) => b.kind === 'path').map((b) => [b.name, b.within])).toEqual([
      ['src/a', []],
      ['src/a/inner', ['src/a']],
      ['src/b', []],
    ]);
    expect(page.groups.map((g) => g.name)).toEqual(['group: Unplaced']);
    expect(page.boxes.filter((b) => b.kind !== 'path').map((b) => b.kind)).toEqual([
      'container',
      'store',
      'external',
    ]);
    expect(page.arrows).toEqual([]);
  });

  it('passes the honesty check as drawn, with unique ids', () => {
    const text = drawBaseline(INPUT);
    const read = readArchPen(text);
    if (!read.ok) throw new Error(read.error);
    const truth = { modules: INPUT.modules, pairs: new Set<string>(), edges: [], parts: new Set(['src/a/inner']) };
    expect(checkArchDoc(read.doc, truth).findings).toEqual([]);
    const ids = [...text.matchAll(/"id": "([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('design arch-draw / listPartDirs', () => {
  it("lists a module's direct sub-folders, test folders skipped", async () => {
    const root = await makeRepo();
    expect(await listPartDirs(root, 'src/a')).toEqual(['src/a/inner']);
    expect(await listPartDirs(root, 'src/missing')).toEqual([]);
  });
});

describe('design arch-draw / CLI', () => {
  it('writes a baseline the check passes, then refuses to overwrite it', async () => {
    const root = await makeRepo();
    expect((await run([], root)).code).toBe(0);
    expect((await checkArchBaseline(root)).status).toBe('ok');
    const before = await readFile(join(root, BASELINE), 'utf8');
    expect((await run([], root)).code).toBe(1);
    expect(await readFile(join(root, BASELINE), 'utf8')).toBe(before);
    expect((await run(['--bogus'], root)).code).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm vitest run src/design/__tests__/arch-draw.test.ts`
Expected: FAIL — cannot find module `../arch-draw.js`.

- [ ] **Step 3: Write the command.** Create `src/design/arch-draw.ts`:

```ts
// @fd: architecture-design-phase
// `noldor design arch-draw` — the first architecture canvas, drawn from the
// code (spec: "Draw command"). Every module lands in `group: Unplaced` with its
// non-test sub-folders as parts, beside one placeholder per outer layer. No
// arrow is drawn: every import at once is a hairball, and the check's
// `undrawn-edge` advisories list them instead. Placing, grouping and arrows are
// the operator's canvas work — docs/noldor/architecture-canvas.md.

import { mkdirSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { writeFileSyncIfAbsent } from '../core/atomic-write.js';
import { runIfDirect } from '../core/cli-entry.js';
import { ARCH_BASELINE_PATH } from '../core/design-artifact-names.js';
import { listModuleDirs } from '../docs/docs-architecture.js';
import { ARCH_PAGE } from './arch-pen.js';

export interface DrawInput {
  readonly modules: readonly string[];
  /** Module → its part paths. */
  readonly parts: ReadonlyMap<string, readonly string[]>;
}

/** A `.pen` node as this file writes it: layout `none`, every position explicit. */
interface PenNode {
  id: string;
  type: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: PenNode[];
  [key: string]: unknown;
}

type Mint = (prefix: string) => string;

const PEN_VERSION = '2.19';
const COLUMNS = 6;
const PAD = 16;
const TITLE_H = 28;
const BOX_W = 200;
const HEAD_H = 34;
const PART_W = 180;
const PART_H = 26;
const PART_GAP = 8;
const TEST_DIRS: ReadonlySet<string> = new Set(['__tests__', 'test', 'tests', 'fixtures']);
const OUTER_PLACEHOLDERS = [
  'container: Runnable unit',
  'store: Durable state',
  'external: Outside system',
];

/** Ids of the form `<prefix><n>`, never one already in `taken`. */
function idMinter(taken: Set<string>): Mint {
  let n = 0;
  return (prefix) => {
    let id = `${prefix}${++n}`;
    while (taken.has(id)) id = `${prefix}${++n}`;
    taken.add(id);
    return id;
  };
}

function labelNode(mint: Mint, content: string, font: 'Inter' | 'JetBrains Mono'): PenNode {
  return {
    id: mint('t'),
    type: 'text',
    name: 'Label',
    content,
    x: 10,
    y: 9,
    fontFamily: font,
    fontSize: 12,
    fill: '#1F2328',
  };
}

/** A module box with its parts stacked inside it. */
function moduleBox(mint: Mint, mod: string, parts: readonly string[]): PenNode {
  const children: PenNode[] = [labelNode(mint, mod, 'JetBrains Mono')];
  parts.forEach((part, i) => {
    children.push({
      id: mint('b'),
      type: 'frame',
      name: part,
      layout: 'none',
      x: 10,
      y: HEAD_H + i * (PART_H + PART_GAP),
      width: PART_W,
      height: PART_H,
      fill: '#F6F8FA',
      stroke: '#8C959F',
      strokeWidth: 1,
      cornerRadius: 3,
      children: [{ ...labelNode(mint, part.slice(mod.length + 1), 'JetBrains Mono'), y: 6 }],
    });
  });
  return {
    id: mint('b'),
    type: 'frame',
    name: mod,
    layout: 'none',
    x: 0,
    y: 0,
    width: BOX_W,
    height: parts.length === 0 ? HEAD_H : HEAD_H + parts.length * (PART_H + PART_GAP) + PART_GAP,
    fill: '#FFFFFF',
    stroke: '#57606A',
    strokeWidth: 1,
    cornerRadius: 4,
    children,
  };
}

/** A `group:` frame with its title; {@link fitFrame} sizes it. */
function groupFrame(mint: Mint, name: string, x: number, y: number): PenNode {
  return {
    id: mint('g'),
    type: 'frame',
    name: `group: ${name}`,
    layout: 'none',
    x,
    y,
    width: 0,
    height: 0,
    fill: '#F4F6F8',
    stroke: '#C9D1D9',
    strokeWidth: 1,
    cornerRadius: 8,
    children: [
      {
        id: mint('t'),
        type: 'text',
        name: 'Title',
        content: name,
        x: PAD,
        y: 8,
        fontFamily: 'Inter',
        fontSize: 13,
        fontWeight: '600',
        fill: '#1F2328',
      },
    ],
  };
}

/** Place `boxes` in rows of {@link COLUMNS}, the first row at `top`. */
function layRows(boxes: readonly PenNode[], top: number): void {
  let y = top;
  for (let i = 0; i < boxes.length; i += COLUMNS) {
    const row = boxes.slice(i, i + COLUMNS);
    row.forEach((box, col) => {
      box.x = PAD + col * (BOX_W + PAD);
      box.y = y;
    });
    y += Math.max(...row.map((box) => box.height ?? 0)) + PAD;
  }
}

/** The lowest edge among `nodes`, 0 for none. */
function bottomOf(nodes: readonly PenNode[]): number {
  return Math.max(0, ...nodes.map((n) => (n.y ?? 0) + (n.height ?? 0)));
}

/** Grow `frame` to hold every child plus `margin`; never shrink it, so a hand-sized frame keeps its size. */
function fitFrame(frame: PenNode, margin: number): void {
  const kids = frame.children ?? [];
  const right = Math.max(0, ...kids.map((c) => (c.x ?? 0) + (c.width ?? 0)));
  frame.width = Math.max(frame.width ?? 0, right + margin);
  frame.height = Math.max(frame.height ?? 0, bottomOf(kids) + margin);
}

function serialize(doc: unknown): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** The first baseline for `input`, as `.pen` JSON text. Pure. */
export function drawBaseline(input: DrawInput): string {
  const mint = idMinter(new Set());
  const unplaced = groupFrame(mint, 'Unplaced', 40, 40);
  const boxes = input.modules.map((mod) => moduleBox(mint, mod, input.parts.get(mod) ?? []));
  layRows(boxes, TITLE_H);
  unplaced.children = [...(unplaced.children ?? []), ...boxes];
  fitFrame(unplaced, PAD);
  const left = (unplaced.x ?? 0) + (unplaced.width ?? 0) + 80;
  const outer = OUTER_PLACEHOLDERS.map(
    (name, i): PenNode => ({
      id: mint('b'),
      type: 'frame',
      name,
      layout: 'none',
      x: left,
      y: 40 + i * (HEAD_H + PAD),
      width: BOX_W,
      height: HEAD_H,
      fill: '#FFFFFF',
      stroke: '#57606A',
      strokeWidth: 1,
      cornerRadius: 4,
      children: [labelNode(mint, name, 'Inter')],
    }),
  );
  const page: PenNode = {
    id: mint('p'),
    type: 'frame',
    name: ARCH_PAGE,
    layout: 'none',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    fill: '#FFFFFF',
    children: [unplaced, ...outer],
  };
  fitFrame(page, 40);
  return serialize({ version: PEN_VERSION, children: [page] });
}

/** A module's direct sub-folders as part paths — test, hidden and `_` folders skipped — sorted. */
export async function listPartDirs(cwd: string, mod: string): Promise<string[]> {
  try {
    const entries = await readdir(join(cwd, mod), { withFileTypes: true });
    return entries
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.isSymbolicLink() &&
          !e.name.startsWith('.') &&
          !e.name.startsWith('_') &&
          !TEST_DIRS.has(e.name),
      )
      .map((e) => `${mod}/${e.name}`)
      .sort();
  } catch {
    return [];
  }
}

async function readInput(cwd: string): Promise<DrawInput> {
  const modules = await listModuleDirs(cwd);
  const parts = new Map<string, readonly string[]>();
  for (const mod of modules) parts.set(mod, await listPartDirs(cwd, mod));
  return { modules, parts };
}

/** Exit 0 = baseline written, 1 = a baseline already exists, 2 = bad arguments. */
export async function main(argv: readonly string[], cwd: string = process.cwd()): Promise<number> {
  const label = 'design arch-draw';
  if (argv.length > 0) {
    console.error(`${label}: unexpected ${argv.join(' ')} — usage: design arch-draw`);
    return 2;
  }
  const input = await readInput(cwd);
  const target = join(cwd, ARCH_BASELINE_PATH);
  mkdirSync(dirname(target), { recursive: true });
  if (!writeFileSyncIfAbsent(target, drawBaseline(input))) {
    console.error(`${label}: ${ARCH_BASELINE_PATH} already exists — nothing written`);
    return 1;
  }
  console.log(
    `arch-draw: wrote ${ARCH_BASELINE_PATH} — ${input.modules.length} module(s) in group: Unplaced. Place them next: docs/noldor/architecture-canvas.md`,
  );
  return 0;
}

runIfDirect('arch-draw', 'design arch-draw', async (argv) => main(argv));
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm vitest run src/design/__tests__/arch-draw.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Register the command.** In `src/cli/manifest.ts`, add directly after the `'arch-progress'` entry:

```ts
      'arch-draw': {
        src: 'design/arch-draw.ts',
        desc: 'Draw the architecture baseline from the code: every module in group: Unplaced with its sub-folders as parts; --refresh adds new modules',
      },
```

- [ ] **Step 6: Catalog it.** In `docs/noldor/script-catalog.md`, insert before the `### \`design:arch-route\`` heading:

```markdown
### `design:arch-draw`

- **Trigger:** `pnpm noldor design arch-draw` once, to start a repo's architecture canvas; `pnpm noldor design arch-draw --refresh` whenever `checks arch-baseline` reports `missing-module`. The procedure page, [`architecture-canvas.md`](architecture-canvas.md), owns both calls.
- **Inputs:** the module set (`listModuleDirs` over `consumer.scanPaths`) and each module's direct sub-folders, skipping `__tests__`, `test`, `tests`, `fixtures` and hidden or `_` folders. `--refresh` also reads `docs/design/architecture/baseline.pen`.
- **Outputs:** the first run writes `docs/design/architecture/baseline.pen`: one `architecture` page, every module boxed in `group: Unplaced` with its sub-folders as part boxes inside it, and one `container:`, `store:` and `external:` placeholder. It draws no arrows. It refuses to replace an existing baseline (exit 1). `--refresh` adds a box, with its parts, for each module no box covers, and never moves, resizes or renames a box already there. It lists boxes whose module is gone without deleting them. Exit 0 on a write or a no-op, 1 when the baseline is missing or unreadable, 2 on bad arguments.
- **When to use:** at bootstrap, then after any change that adds a module. It needs no editor, so a headless drain can pay `missing-module` debt with it; the placing waits for a human.
- **Source:** [`src/design/arch-draw.ts`](../../src/design/arch-draw.ts)

```

Then run `cp docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md`.

- [ ] **Step 7: Regenerate the capability index.**

Run: `pnpm noldor docs capability-index --write && git status --short AGENTS.md templates/AGENTS.md`
Expected: `AGENTS.md` shows as modified, its `design` line now listing `arch-draw`. `templates/AGENTS.md` shows as modified when it carries the index too.

- [ ] **Step 8: Validate.**

Run: `pnpm noldor validate script-catalog && pnpm noldor docs capability-index && pnpm typecheck`
Expected: all three exit 0.

- [ ] **Step 9: Commit.**

```bash
git add src/design/arch-draw.ts src/design/__tests__/arch-draw.test.ts src/cli/manifest.ts docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md AGENTS.md templates/AGENTS.md
cat > "$(git rev-parse --git-dir)/TASK_MSG" <<'EOF'
feat(design): draw the first architecture baseline from the code

design arch-draw writes docs/design/architecture/baseline.pen with one architecture page: every module in group: Unplaced with its non-test sub-folders as parts, and a placeholder for each outer layer. It draws no arrows, and it never replaces an existing baseline.

Noldor-FD: architecture-design-phase
EOF
git commit -F "$(git rev-parse --git-dir)/TASK_MSG"
```

---

## Task 6: Regenerate this repo's baseline

The six groups and ten arrows of the old baseline are not carried over. The operator regroups the modules and draws the arrows on the canvas, guided by the check's `undrawn-edge` advisories.

**Files:**
- Modify: `docs/design/architecture/baseline.pen`

- [ ] **Step 1: Confirm the old baseline no longer reads.**

Run: `pnpm noldor checks arch-baseline`
Expected: exit 1, one `unreadable` row naming `arch-draw`.

- [ ] **Step 2: Draw the new one.**

Run: `rm docs/design/architecture/baseline.pen && pnpm noldor design arch-draw`
Expected: `arch-draw: wrote docs/design/architecture/baseline.pen — 34 module(s) in group: Unplaced. …` (the count is whatever `listModuleDirs` returns today).

- [ ] **Step 3: Check it.**

Run: `pnpm noldor checks arch-baseline`
Expected: exit 0, `arch-baseline: ok`, then `undrawn-edge` advisory rows only.

- [ ] **Step 4: Commit.** The pre-commit guard refuses a baseline staged from a worktree unless `NOLDOR_ALLOW_PEN_WRITE=1` is set.

```bash
git add docs/design/architecture/baseline.pen
cat > "$(git rev-parse --git-dir)/TASK_MSG" <<'EOF'
chore(design): redraw the architecture baseline as one page

Regenerated with design arch-draw: every module in group: Unplaced with its sub-folders as parts, no arrows. Grouping and arrows are canvas work for the operator; the check's undrawn-edge advisories list the imports to draw.

Noldor-FD: architecture-design-phase
EOF
NOLDOR_ALLOW_PEN_WRITE=1 git commit -F "$(git rev-parse --git-dir)/TASK_MSG"
```

---

## Task 7: `design arch-draw --refresh`

**Files:**
- Modify: `src/design/arch-draw.ts`
- Test: `src/design/__tests__/arch-draw.test.ts`

- [ ] **Step 1: Write the failing test.** In `src/design/__tests__/arch-draw.test.ts`, add this block at the end of the file:

```ts
interface RawNode {
  id: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: RawNode[];
}

describe('design arch-draw --refresh', () => {
  it('adds a box for a new module and keeps every placed box where it was', async () => {
    const root = await makeRepo();
    await run([], root);
    const file = join(root, BASELINE);
    // Move src/a out of Unplaced by hand, as the operator would.
    const doc = JSON.parse(await readFile(file, 'utf8')) as { children: RawNode[] };
    const page = doc.children[0]!;
    const unplaced = page.children!.find((n) => n.name === 'group: Unplaced')!;
    const a = unplaced.children!.find((n) => n.name === 'src/a')!;
    unplaced.children = unplaced.children!.filter((n) => n !== a);
    Object.assign(a, { x: 900, y: 700 });
    page.children!.push(a);
    await writeFile(file, JSON.stringify(doc), 'utf8');
    await mkdir(join(root, 'src', 'c'), { recursive: true });
    await writeFile(join(root, 'src', 'c', 'w.ts'), 'export const w = 1;\n', 'utf8');

    const r = await run(['--refresh'], root);
    expect(r.code).toBe(0);
    expect(r.out).toContain('src/c');
    const after = JSON.parse(await readFile(file, 'utf8')) as { children: RawNode[] };
    const moved = after.children[0]!.children!.find((n) => n.name === 'src/a')!;
    expect([moved.x, moved.y, moved.width, moved.height]).toEqual([900, 700, a.width, a.height]);
    const refreshed = onlyPage(await readFile(file, 'utf8'));
    const c = refreshed.boxes.find((b) => b.name === 'src/c')!;
    expect(refreshed.groups.find((g) => g.name === 'group: Unplaced')?.boxIds).toContain(c.id);
    expect((await checkArchBaseline(root)).status).toBe('ok');
  });

  it('lists a box whose module is gone without deleting it, and leaves the file alone when nothing is new', async () => {
    const root = await makeRepo();
    await run([], root);
    await rm(join(root, 'src', 'b'), { recursive: true, force: true });
    const before = await readFile(join(root, BASELINE), 'utf8');
    const r = await run(['--refresh'], root);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/gone: `src\/b`/);
    expect(await readFile(join(root, BASELINE), 'utf8')).toBe(before);
  });

  it('exits 1 with no baseline to refresh', async () => {
    const root = await makeRepo();
    expect((await run(['--refresh'], root)).code).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm vitest run src/design/__tests__/arch-draw.test.ts`
Expected: FAIL — the three new tests get exit 2, because `--refresh` is still an unexpected argument.

- [ ] **Step 3: Add the refresh.** In `src/design/arch-draw.ts`, replace the import block with:

```ts
import { mkdirSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { atomicWriteFileSync, writeFileSyncIfAbsent } from '../core/atomic-write.js';
import { runIfDirect } from '../core/cli-entry.js';
import { ARCH_BASELINE_PATH } from '../core/design-artifact-names.js';
import { readRepoText } from '../core/read-text.js';
import { listModuleDirs } from '../docs/docs-architecture.js';
import { ARCH_PAGE, canonicalName, readArchPen } from './arch-pen.js';
```

Add after `drawBaseline`:

```ts
export type RefreshResult =
  | {
      readonly ok: true;
      /** The new file text, or `null` when there is nothing to add. */
      readonly text: string | null;
      readonly added: readonly string[];
      readonly gone: readonly string[];
    }
  | { readonly ok: false; readonly error: string };

function idsOf(nodes: readonly PenNode[], into: Set<string> = new Set()): Set<string> {
  for (const n of nodes) {
    into.add(n.id);
    idsOf(n.children ?? [], into);
  }
  return into;
}

/**
 * `text` with a box, parts included, added to `group: Unplaced` for every
 * module no box covers. Nothing already on the page moves, resizes or is
 * renamed. `gone` names the top-level path boxes whose module no longer
 * exists; only the operator deletes those.
 */
export function refreshBaseline(text: string, input: DrawInput): RefreshResult {
  const read = readArchPen(text);
  if (!read.ok) return read;
  const pages = read.doc.pages.filter((p) => p.role === 'baseline');
  const [page] = pages;
  if (pages.length !== 1 || page === undefined)
    return { ok: false, error: `expected one \`${ARCH_PAGE}\` page, found ${pages.length}` };
  const known = new Set(input.modules);
  const underModule = (ref: string): boolean =>
    input.modules.some((mod) => ref.startsWith(`${mod}/`));
  const gone = page.boxes
    .filter(
      (b) =>
        b.kind === 'path' &&
        b.within.length === 0 &&
        b.refs.some((ref) => !known.has(ref) && !underModule(ref)),
    )
    .map((b) => b.name)
    .sort();
  const covered = new Set(page.boxes.flatMap((b) => b.refs));
  const added = input.modules.filter((mod) => !covered.has(mod));
  if (added.length === 0) return { ok: true, text: null, added, gone };

  const root = JSON.parse(text) as { children: PenNode[] };
  const pageNode = root.children.find((n) => n.id === page.id);
  if (pageNode === undefined) return { ok: false, error: `the \`${ARCH_PAGE}\` page has no node` };
  const mint = idMinter(idsOf(root.children));
  const kids = (pageNode.children ??= []);
  let unplaced = kids.find(
    (n) => n.type === 'frame' && canonicalName(n.name ?? '') === 'group: Unplaced',
  );
  if (unplaced === undefined) {
    const right = Math.max(0, ...kids.map((n) => (n.x ?? 0) + (n.width ?? 0)));
    unplaced = groupFrame(mint, 'Unplaced', right + 80, 40);
    kids.push(unplaced);
  }
  const boxes = added.map((mod) => moduleBox(mint, mod, input.parts.get(mod) ?? []));
  const inside = unplaced.children ?? [];
  layRows(boxes, Math.max(TITLE_H, bottomOf(inside.filter((n) => n.type !== 'text')) + PAD));
  unplaced.children = [...inside, ...boxes];
  fitFrame(unplaced, PAD);
  fitFrame(pageNode, 40);
  return { ok: true, text: serialize(root), added, gone };
}
```

Replace `main` with:

```ts
/**
 * Exit 0 = baseline written, or nothing to add; 1 = a baseline already exists
 * (first draw), or none is readable (`--refresh`); 2 = bad arguments.
 */
export async function main(argv: readonly string[], cwd: string = process.cwd()): Promise<number> {
  const label = 'design arch-draw';
  const refresh = argv.includes('--refresh');
  const stray = argv.filter((arg) => arg !== '--refresh');
  if (stray.length > 0) {
    console.error(`${label}: unexpected ${stray.join(' ')} — usage: design arch-draw [--refresh]`);
    return 2;
  }
  const input = await readInput(cwd);
  const target = join(cwd, ARCH_BASELINE_PATH);
  if (!refresh) {
    mkdirSync(dirname(target), { recursive: true });
    if (!writeFileSyncIfAbsent(target, drawBaseline(input))) {
      console.error(
        `${label}: ${ARCH_BASELINE_PATH} already exists — nothing written; add new modules with --refresh`,
      );
      return 1;
    }
    console.log(
      `arch-draw: wrote ${ARCH_BASELINE_PATH} — ${input.modules.length} module(s) in group: Unplaced. Place them next: docs/noldor/architecture-canvas.md`,
    );
    return 0;
  }
  const file = readRepoText(cwd, ARCH_BASELINE_PATH);
  if (!file.ok) {
    console.error(`${label}: no readable baseline — ${file.error}; draw one with design arch-draw`);
    return 1;
  }
  const result = refreshBaseline(file.text, input);
  if (!result.ok) {
    console.error(`${label}: ${ARCH_BASELINE_PATH}: ${result.error}`);
    return 1;
  }
  if (result.text !== null) atomicWriteFileSync(target, result.text);
  console.log(
    result.added.length === 0
      ? 'arch-draw: nothing to add'
      : `arch-draw: added ${result.added.join(', ')} to group: Unplaced — place them on the canvas`,
  );
  for (const name of result.gone)
    console.log(`  gone: \`${name}\` names no module any more — delete the box on the canvas`);
  return 0;
}
```

Also change the header comment's first sentence to read: `` // `noldor design arch-draw [--refresh]` — the first architecture canvas, drawn from the `` and add, before `// Placing, grouping …`, the line `` // code, and new modules added to it later. `--refresh` never moves, resizes or ``, `` // renames a box already there, so the hand layout survives. `` — so the header reads:

```ts
// @fd: architecture-design-phase
// `noldor design arch-draw [--refresh]` — the first architecture canvas, drawn
// from the code, and new modules added to it later (spec: "Draw command").
// Every module lands in `group: Unplaced` with its non-test sub-folders as
// parts, beside one placeholder per outer layer. No arrow is drawn: every
// import at once is a hairball, and the check's `undrawn-edge` advisories list
// them instead. `--refresh` never moves, resizes or renames a box already
// there, so the hand layout survives. Placing, grouping and arrows are the
// operator's canvas work — docs/noldor/architecture-canvas.md.
```

- [ ] **Step 4: Run it to verify it passes.**

Run: `pnpm vitest run src/design/__tests__/arch-draw.test.ts && pnpm typecheck`
Expected: PASS — 7 tests; typecheck exits 0.

- [ ] **Step 5: Commit.**

```bash
git add src/design/arch-draw.ts src/design/__tests__/arch-draw.test.ts
cat > "$(git rev-parse --git-dir)/TASK_MSG" <<'EOF'
feat(design): add new modules to the architecture baseline with arch-draw --refresh

--refresh adds a box, with its parts, to group: Unplaced for each module no box covers, and lists boxes whose module is gone without deleting them. Nothing already placed moves, and the write is atomic. It needs no editor, so a headless drain can pay missing-module debt.

Noldor-FD: architecture-design-phase
EOF
git commit -F "$(git rev-parse --git-dir)/TASK_MSG"
```

---

## Task 8: The procedure page

**Files:**
- Create: `docs/noldor/architecture-canvas.md`, `templates/docs/noldor/architecture-canvas.md`
- Modify: `docs/noldor/README.md`, `templates/docs/noldor/README.md`

- [ ] **Step 1: Write the page.** Create `docs/noldor/architecture-canvas.md`:

```markdown
---
noldor-page: architecture-canvas
---

# Architecture Canvas

How to draw and keep `docs/design/architecture/baseline.pen`, the repo's one detailed architecture picture. Follow this page whenever you are asked to draw, finish, fix or update the architecture canvas. The `docs/architecture/*.md` mermaid pages are the short overview and stay hand-written; this canvas is the detailed picture, and the two are never generated from each other.

## The level

One page, named `architecture`, drawn between C4 containers and components. It reads from the outside in:

1. **Externals** round the edge: an `external: <Name>` box for each system the repo talks to (git, GitHub, npm, an agent runtime).
2. **Containers and stores:** a `container: <Name>` frame for each runnable unit (a CLI, a server, a hook runner), and a `store: <Name>` box for each place durable state lives.
3. **Modules** inside the containers: one box per module directory under the scan roots, named by its path (`src/cr`), inside `group: <Name>` frames by responsibility. A module more than one container uses goes in a `group: Shared` frame outside every container, and the containers point into it.
4. **Parts** inside each module box: smaller boxes named by a path under that module (`src/cr/lanes`, `src/cr/orchestrate.ts`). Keep the entry points and the sub-folders a reader needs, not every file.

## The names are the contract

The check reads layer names, never labels or geometry.

- A box named by a path is a module when the path is a module directory, and a part when it sits under one. `src/a + src/b` joins two modules in one box; every path in it must be a module.
- A part box must sit inside its module's box.
- `group: <Name>` frames group boxes. An arrow to a group stands for the modules in it, never its parts.
- `external:`, `container:` and `store:` name the outer layers. Spacing after the colon does not matter.
- An arrow is a path named `<from> -> <to>`, where each end is a box's name, one path a box covers, or a group's name.
- Anything else is decoration.

`pnpm noldor checks arch-baseline` holds the names to the code:

- `missing-module`, `unknown-module`, `duplicate-module`: every module is boxed exactly once.
- `unknown-part`, `misplaced-part`: every part exists and sits inside its module.
- `phantom-edge`: an arrow between two code paths needs a real import. Each end stands for the files under its path; when one end sits inside the other, the outer end counts only its files outside the inner one, so `src/cr/lanes -> src/cr` means "lanes imports the rest of `src/cr`".
- `dangling-edge`: an arrow end names nothing, or more than one box.
- `undrawn-edge` (advisory): a module import no arrow shows. It never fails the check.

Arrows that touch an external, container or store are checked only for resolving.

## Draw it the first time

1. `pnpm noldor design arch-draw` writes the baseline: every module in `group: Unplaced` with its sub-folders as parts, and one `container:`, `store:` and `external:` placeholder. It draws no arrows.
2. `pnpm noldor checks arch-baseline` is green on it straight away.
3. Open the file: `pnpm noldor design pen-bridge --pen docs/design/architecture/baseline.pen`. Pencil MCP needs a terminal Claude Code session; it does not connect under the VS Code extension.
4. Rename the placeholders and copy them for each runnable unit, store and external.
5. Move the modules out of `Unplaced` into `group:` frames inside the containers, and the shared ones into `group: Shared`. Delete `Unplaced` once it is empty.
6. Prune the parts a reader does not need, and add boxes for key files.
7. Draw the arrows that matter, group arrows first (`group: Workflow -> src/core`), then the module and part arrows the `undrawn-edge` rows point at. Do not draw them all.
8. Save, then `pnpm -s noldor design arch-route --pen docs/design/architecture/baseline.pen` and pass its stdout to pencil `execute` to lay the arrows border to border.
9. `pnpm noldor checks arch-baseline` until it is green.

## Keep it true

- **A module appears:** the check reports `missing-module`. Run `pnpm noldor design arch-draw --refresh`: the new module lands in `Unplaced` with its parts, and nothing else moves. Close or reload the file in the editor first, or its next save overwrites the refresh. Place the new box when an editor is at hand.
- **A module goes:** `--refresh` lists its box as gone. Delete it on the canvas.
- **A design changes the architecture:** `/noldor-spec` step 1.6 copies the baseline, the design ends on a `FINAL:architecture: <name>` page, and gate Step 4 writes the approved change back onto the current baseline.
- **Boxes moved:** arrows are loose paths, so re-run `design arch-route` after dragging.
```

Then run `cp docs/noldor/architecture-canvas.md templates/docs/noldor/architecture-canvas.md`.

- [ ] **Step 2: Route to it.** In `docs/noldor/README.md`, add this row to the "When to read" table directly after the `Writing a UI baseline` row:

```markdown
| Drawing the architecture canvas       | [`architecture-canvas.md`](architecture-canvas.md)                                                                                                                                          |
```

and this bullet to `## Pages` directly after the `ui-baseline.md` bullet:

```markdown
- [`architecture-canvas.md`](architecture-canvas.md) — the one-page architecture baseline `.pen`: its four layers, the layer-name contract `checks arch-baseline` reads, drawing it with `design arch-draw`, and keeping it true
```

Then run `cp docs/noldor/README.md templates/docs/noldor/README.md`.

- [ ] **Step 3: Validate.**

Run: `pnpm noldor validate noldor && pnpm noldor checks template-sync && pnpm fmt`
Expected: all exit 0. If `pnpm fmt` re-pads the table, run the two `cp` commands again.

- [ ] **Step 4: Commit.**

```bash
git add docs/noldor/architecture-canvas.md templates/docs/noldor/architecture-canvas.md docs/noldor/README.md templates/docs/noldor/README.md
cat > "$(git rev-parse --git-dir)/TASK_MSG" <<'EOF'
docs(noldor): add the architecture canvas procedure page

One page every agent follows to draw, finish and keep the architecture baseline: the four layers, the layer-name contract the check reads, the first draw with design arch-draw, and the upkeep with --refresh and the gate write-back.

Noldor-FD: architecture-design-phase
EOF
git commit -F "$(git rev-parse --git-dir)/TASK_MSG"
```

---

## Task 9: Point the skills and docs at the one page

Skill files are shared files that `checks shared-files` refuses from a worktree, so this commit uses `NOLDOR_ALLOW_SHARED=1`, as Q-0201 did.

**Files:**
- Modify: `.claude/skills/noldor-spec/arch-design.md` + `templates/.claude/skills/noldor-spec/arch-design.md`
- Modify: `.claude/skills/noldor-gate/design-writeback.md` + twin
- Modify: `.claude/skills/noldor-milestone/SKILL.md` + twin
- Modify: `docs/noldor/drain-mode.md`, `docs/noldor/versioning.md`, `docs/noldor/gotchas.md`, `docs/noldor/script-catalog.md` + twins

- [ ] **Step 1: The spec step.** Replace the whole of `.claude/skills/noldor-spec/arch-design.md` with:

```markdown
# /noldor-spec — architecture design (step 1.6, `required`)

Read when step 1.6's architecture verdict is `required`. **Read now:** [`pen-canvas.md`](pen-canvas.md) — every hazard there applies to this canvas: assert the write target before every pencil write, wake the bridge before concluding the editor is unavailable, verify a new node in a follow-up `execute`, waive only after a wake attempt, and keep a seeded `.pen` and its link on a waiver after Seed. The canvas's layers and layer-name contract live in [`docs/noldor/architecture-canvas.md`](../../../docs/noldor/architecture-canvas.md); keep to them on every page you draw.

- **Seed.** `cp docs/design/architecture/baseline.pen docs/design/architecture/<date>-<dialogue-key>.pen`, open the copy with `pnpm noldor design pen-bridge --pen <that path>`, confirm it with `get_app_state`, and rename its one page to `BASE:architecture: as-built` with `Update(<pageId>, {name})` — `Print(Get(document, {depth: 1}).children.map(c => [c.id, c.name]))` lists it.
- **Iterate.** Draw each variant as a page named `architecture: <variant>`, starting from a `Copy` of the `BASE:` page. A module or part the design proposes is a box named by the path it will have. After boxes move, save the `.pen`, run `pnpm -s noldor design arch-route --pen <that path>` and pass its stdout as `execute`'s `input`. Converge with the operator on one winner and rename it `FINAL:architecture: <name>`.
- **Record.** Name the chosen variant and the alternatives in the spec's `## Design`, link the `.pen`, and set FD `links.arch`.
- **Verdict at step 7.5.** Taken exactly like the ratification steps (a)–(g) in `pen-canvas.md`: `pnpm noldor design verdict --pen <the architecture .pen> --approve --surface architecture --spec <this spec> --editor-page "<name>" [--editor-page "<name>"...]`. A waiver after Seed runs `pnpm noldor design verdict --pen <the architecture .pen> --waive --reason "<why>"` and keeps the `.pen` and `links.arch`.

The architecture `.pen` and its record commit with the spec at gate Step 2.5, beside any UI `.pen`. Then continue to step 1.7.
```

Then run `cp .claude/skills/noldor-spec/arch-design.md templates/.claude/skills/noldor-spec/arch-design.md`.

- [ ] **Step 2: The gate write-back.** In `.claude/skills/noldor-gate/design-writeback.md`, replace the two bullets that begin `- **The session approved an architecture `.pen`**` and `- **The check is red on a session with no architecture design**` with:

```markdown
- **The session approved an architecture `.pen`** (`archVerdict: required`, no `archWaiver`; the archive step just moved it into `docs/design/architecture/archive/`): apply the change its `FINAL:architecture:` page makes against its `BASE:architecture:` page onto the **current** baseline through pencil MCP — never copy the page over, because another feature may have written the baseline back since Seed. Open the baseline with `pnpm noldor design pen-bridge --pen docs/design/architecture/baseline.pen` and assert it with `get_app_state` before the first write. Save, re-route (`pnpm -s noldor design arch-route --pen docs/design/architecture/baseline.pen`, stdout as `execute`'s `input`), and re-run the check until it is green. The layer names to keep are in [`docs/noldor/architecture-canvas.md`](../../../docs/noldor/architecture-canvas.md).
- **The check is red on a session with no architecture design:** on `missing-module`, run `pnpm noldor design arch-draw --refresh` — it needs no editor, so it runs headless too — and stage the result; the new box waits in `group: Unplaced` for a human to place it. Any other finding (a module removed or rewired, a part renamed): fix exactly the boxes and arrows the findings name, through pencil MCP, following the same page.
```

Then run `cp .claude/skills/noldor-gate/design-writeback.md templates/.claude/skills/noldor-gate/design-writeback.md`.

- [ ] **Step 3: The milestone target.** In `.claude/skills/noldor-milestone/SKILL.md`, replace sub-step 2 of step 4.5 (the line starting `   2. Rename the four pages`) with:

```markdown
   2. Rename the one page `BASE:architecture: as-built`, draw the target on a `Copy` of it, and rename the copy `FINAL:architecture: <name>`. Keep the layer-name contract in [`docs/noldor/architecture-canvas.md`](../../../docs/noldor/architecture-canvas.md), and after moving boxes save and run `pnpm -s noldor design arch-route --pen docs/design/architecture/milestones/<slug>.pen`, passing its stdout to `execute`.
```

and in sub-step 4 replace `--surface <view> [--surface <view>...]` with `--surface architecture`. Then run `cp .claude/skills/noldor-milestone/SKILL.md templates/.claude/skills/noldor-milestone/SKILL.md`.

- [ ] **Step 4: The drain page.** In `docs/noldor/drain-mode.md`, replace the whole bullet that starts `- Design debt: when `docs/design/architecture/baseline.pen` exists, run` and ends `preflight holds the line.` with:

```markdown
- Design debt: when `docs/design/architecture/baseline.pen` exists, run
  `pnpm noldor checks arch-baseline`. On `missing-module`, run
  `pnpm noldor design arch-draw --refresh` and commit the baseline with
  `NOLDOR_ALLOW_PEN_WRITE=1` — it needs no editor. Then run
  `pnpm noldor checks ui-design-freshness` after the last commit. Print both
  checks' rows. Every other row is debt a headless child cannot pay, never a
  reason to stop — release preflight holds the line.
```

and in step 3 of the Finish path replace `print the debt instead — the rows of `pnpm noldor checks arch-baseline`` with `` print the debt instead — the rows of `pnpm noldor checks arch-baseline` left after `design arch-draw --refresh` `` (keep the rest of that item). Then run `cp docs/noldor/drain-mode.md templates/docs/noldor/drain-mode.md`.

- [ ] **Step 5: The release page.** In `docs/noldor/versioning.md`, replace

```markdown
     (`docs/design/architecture/baseline.pen`) must cover every module once
     and draw no arrow the imports do not back. Skipped for a repo with no
```

with

```markdown
     (`docs/design/architecture/baseline.pen`) must cover every module once,
     keep every part real and inside its module, and draw no arrow the
     imports do not back. Skipped for a repo with no
```

Then run `cp docs/noldor/versioning.md templates/docs/noldor/versioning.md`.

- [ ] **Step 6: The gotchas.** In `docs/noldor/gotchas.md`, replace `<path> --view <view>` and pass its stdout to pencil `execute`.` in the loose-path bullet with `` <path>` and pass its stdout to pencil `execute`. `` and, in the next bullet, replace `A module box means its layer name (`src/cr`), an arrow its `<from> -> <to>`` with ``A module or part box means its layer name (`src/cr`, `src/cr/lanes`), an arrow its `<from> -> <to>` ``. Then run `cp docs/noldor/gotchas.md templates/docs/noldor/gotchas.md`.

- [ ] **Step 7: The catalog.** In `docs/noldor/script-catalog.md`:
  - in `### \`design:arch-route\``, replace `` `pnpm noldor design arch-route --pen <path.pen> [--view context|containers|modules|flows]` `` with `` `pnpm noldor design arch-route --pen <path.pen>` ``;
  - in `### \`design:arch-progress\``, replace `its `FINAL:<view>:` pages;` with `its `FINAL:architecture:` page;`, replace `a summary line, then, for each view the target covers:` with `a summary line, then:`, replace `the target's page dropped;` with `the target dropped;`, and replace `Items compare by name: modules by path, other boxes by layer name, arrows by canonical `<from> -> <to>`. A view with no `FINAL:` page is no change planned and is not reported.` with `Items compare by name: modules and parts by path, other boxes by canonical layer name, arrows by canonical `<from> -> <to>`. A target with no `FINAL:` page is no change planned.`;
  - in `### \`check:arch-baseline\``, replace everything from the `- **Inputs:**` bullet down to the line before `- **Source:**` with:

```markdown
- **Inputs:** `docs/design/architecture/baseline.pen`; the module set (`listModuleDirs` over `consumer.scanPaths`); module import pairs and file edges from one dependency-cruiser pass (`moduleImportPairs` — tests excluded, tsconfig aliases resolved, the indirection ratchet's completeness guard); which of the baseline's part paths exist on disk.
- **Outputs:** one row per finding, then advisory rows.
  - Findings:
    - `unreadable`: no `architecture` page or more than one (the old four-page file included — redraw it with `design arch-draw`), a file that is not a `.pen` document, or an import graph that could not be built.
    - `missing-module`, `unknown-module`, `duplicate-module`, `unknown-part`, `misplaced-part`, `dangling-edge`.
    - `phantom-edge`: an arrow between two code paths that no file import backs; when one end sits inside the other, the outer end counts only its files outside the inner one.
  - Advisory: `undrawn-edge`, a module import between two boxed modules that no arrow shows.

  Exit 0 when the baseline is absent (nothing is checked) or clean; exit 1 on any finding. Advisories never change the exit code.
- **When to use:** after drawing or editing the baseline, and whenever a change adds, removes or renames a module. `missing-module` is repaired with `pnpm noldor design arch-draw --refresh`; every other finding by fixing the named box or arrow. The layer-name contract is in [`architecture-canvas.md`](architecture-canvas.md).
```

Then run `cp docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md`.

- [ ] **Step 8: Validate.**

Run: `pnpm noldor checks template-sync && pnpm noldor validate script-catalog && pnpm noldor validate skill-catalog && pnpm noldor checks skill-portability && pnpm noldor skill-size check && pnpm fmt`
Expected: all exit 0. Re-run the `cp` commands if `pnpm fmt` changed a source file.

- [ ] **Step 9: Commit.**

```bash
git add .claude/skills/noldor-spec/arch-design.md templates/.claude/skills/noldor-spec/arch-design.md .claude/skills/noldor-gate/design-writeback.md templates/.claude/skills/noldor-gate/design-writeback.md .claude/skills/noldor-milestone/SKILL.md templates/.claude/skills/noldor-milestone/SKILL.md docs/noldor/drain-mode.md templates/docs/noldor/drain-mode.md docs/noldor/versioning.md templates/docs/noldor/versioning.md docs/noldor/gotchas.md templates/docs/noldor/gotchas.md docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md
cat > "$(git rev-parse --git-dir)/TASK_MSG" <<'EOF'
docs(noldor): point the architecture steps at the one canvas page

The spec step, gate write-back and milestone target seed and approve one `architecture` page and link to the procedure page instead of each carrying the contract. A missing-module finding is repaired with design arch-draw --refresh, headless drains included. The catalog, gotchas and release page describe the part rules and the dropped --view.

Noldor-FD: architecture-design-phase
EOF
NOLDOR_ALLOW_SHARED=1 git commit -F "$(git rev-parse --git-dir)/TASK_MSG"
```

---

## Task 10: Drop Q-0210

**Files:**
- Modify: `docs/backlog.md`

- [ ] **Step 1: Find the block's slug.**

Run: `pnpm noldor roadmap has-block --backlog archify-diagrams-in-the-framework; echo "exit=$?"`
Expected: `exit=0`. Otherwise run `grep -n -B2 -A2 "id: Q-0210" docs/backlog.md` and use the kebab-case of the `###` heading above it as the slug in Step 2.

- [ ] **Step 2: Remove it.**

Run: `pnpm noldor roadmap remove-block --backlog archify-diagrams-in-the-framework && grep -c "Q-0210" docs/backlog.md`
Expected: `0`.

- [ ] **Step 3: Validate.**

Run: `pnpm noldor triage validate`
Expected: exit 0.

- [ ] **Step 4: Commit.**

```bash
git add docs/backlog.md
cat > "$(git rev-parse --git-dir)/TASK_MSG" <<'EOF'
docs(triage): drop Q-0210 archify diagrams

The architecture canvas is one detailed pen.dev page seeded by design arch-draw, and the mermaid pages and FD diagrams stay hand-written (ADR 0010). No generator is wanted for either, so the archify entry is dropped rather than deferred.

Noldor-FD: architecture-design-phase
EOF
git commit -F "$(git rev-parse --git-dir)/TASK_MSG"
```

---

## Task 11: Verify the whole branch

**Files:** none changed unless a gate below goes red.

- [ ] **Step 1: The full suite, typecheck and lint.**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: every test passes; typecheck and lint exit 0.

- [ ] **Step 2: The architecture check on this repo.**

Run: `pnpm noldor checks arch-baseline`
Expected: exit 0, `arch-baseline: ok`, advisory rows only.

- [ ] **Step 3: The push-range ratchets.**

Run: `pnpm noldor clones check; echo "clones=$?"; pnpm noldor indirection check; echo "indirection=$?"`
Expected: `clones=0` and `indirection=0`. If `indirection` is red only from the new `src/design/arch-draw.ts` imports, run `pnpm noldor indirection baseline` and commit the baseline file as its own `chore(indirection): re-record the ratchet for arch-draw` commit with `Noldor-FD: architecture-design-phase`. If `clones` is red on the manifest entry only, follow the `clones` entries in `docs/noldor/gotchas.md` before touching the code.

- [ ] **Step 4: The framework validators.**

Run: `pnpm noldor validate features && pnpm noldor checks invariants && pnpm noldor checks template-sync && pnpm noldor docs capability-index && pnpm noldor docs adr --check`
Expected: all exit 0.
