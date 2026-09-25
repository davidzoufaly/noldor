# pen.dev Architecture Design Phase Implementation Plan — Part 1: `checks arch-baseline` and module coverage

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** `pnpm noldor checks arch-baseline` reads `docs/design/architecture/baseline.pen` and reports every module the `modules` view leaves out, names wrongly or draws twice, and every arrow end that points at nothing. With no baseline file it reports `absent` and exits 0.

**Architecture:** four files, one job each.
- `src/design/arch-pen.ts` is a pure reader. It turns a `.pen` into pages of boxes, groups and arrows, keyed on **layer names**.
- `src/design/arch-check.ts` holds that model to the module list from `listModuleDirs`.
- `src/design/arch-baseline.ts` gathers the inputs. It lives in `src/design` rather than in the CLI file because the release row in Part 3 needs it too, and `src/release` never imports `src/checks`.
- `src/checks/check-arch-baseline.ts` renders the report.

Part 2 adds import-backed arrows to the same command.

**Tech Stack:** TypeScript (ESM, Node >= 24), vitest.

**Parts:** 1 of 9. In order: module coverage (this file), import-backed arrows, the release row and this repo's baseline, `design verdict` for architecture designs, the guard and archive, arrow re-route, the spec and gate steps, milestone-target approval, and milestone progress with the milestone skill.

---

## File Structure

- `src/design/arch-pen.ts` — **Create.** The tag contract as a pure reader: `readArchPen`, `pageRoleOf`, `moduleRefsOf`, `arrowEndsOf`, `ARCH_VIEWS` and the model types.
- `src/design/__tests__/arch-pen.test.ts` — **Create.** Tests page roles, the two name grammars, which nodes count as boxes, groups, and endpoint resolution.
- `src/design/arch-check.ts` — **Create.** `checkArchDoc(doc, modules)`, with three rule sets: view pages, dangling edges, and module coverage.
- `src/design/__tests__/arch-check.test.ts` — **Create.** One case per finding kind.
- `src/core/design-artifact-names.ts` — **Modify.** Adds `ARCH_DESIGN_DIR` and `ARCH_BASELINE_PATH` beside the UI constants.
- `src/design/arch-baseline.ts` — **Create.** `checkArchBaseline(cwd)` returns an `absent` / `ok` / `incomplete` report.
- `src/checks/check-arch-baseline.ts` — **Create.** The CLI. It renders the report and exits 1 on findings, 0 otherwise.
- `src/checks/__tests__/check-arch-baseline.test.ts` — **Create.** End-to-end tests over temp repos.
- `src/cli/manifest.ts` — **Modify.** Registers `checks arch-baseline`.
- `docs/noldor/script-catalog.md` + `templates/docs/noldor/script-catalog.md` — **Modify.** Adds the `check:arch-baseline` entry. The two files are byte-identical twins.
- `AGENTS.md` + `templates/AGENTS.md` — **Modify (generated).** The `checks` line of the capability index.

---

## Task 1: The canvas reader

**Files:**

- Create: `src/design/arch-pen.ts`
- Test: `src/design/__tests__/arch-pen.test.ts`

This task turns the spec's "Tag contract" into one pure function.
- **Pages:** `modules` is a baseline page, `BASE:modules: …` the seeded copy, `FINAL:modules: …` the winner, and `modules: …` a variant.
- **Boxes:** named `frame`, `rectangle`, `ellipse` and `ref` nodes. A box named by a module path covers that module; `a/b + c/d` covers both.
- **Groups and arrows:** a frame named `group: <Name>` is a group, and a path named `<from> -> <to>` is an arrow.
- **Endpoint resolution:** an end resolves to the one group with that name, or to the one box whose full name or covered module matches it. An end that matches no box, or several, stays unresolved.

- [ ] **Step 1: Write the failing test file.**

  Create `src/design/__tests__/arch-pen.test.ts`:

  ```ts
  // @tests: architecture-design-phase
  import { describe, expect, it } from 'vitest';

  import { arrowEndsOf, moduleRefsOf, pageRoleOf, readArchPen, type ArchPage } from '../arch-pen.js';

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
  /** A box the way Part 3 draws one: a frame with a text label inside. */
  const box = (name: string): Node => node('frame', name, [node('text', 'Label')]);
  const group = (name: string, ...children: Node[]): Node => node('frame', `group: ${name}`, children);
  const arrow = (name: string): Node => node('path', name);
  const pen = (...pages: Node[]): string => JSON.stringify({ version: '2.17', children: pages });

  function onlyPage(text: string): ArchPage {
    const read = readArchPen(text);
    if (!read.ok) throw new Error(read.error);
    const [page, ...rest] = read.doc.pages;
    if (page === undefined || rest.length > 0) throw new Error('expected exactly one page');
    return page;
  }

  describe('arch-pen / names', () => {
    it.each([
      ['modules', { view: 'modules', role: 'baseline' }],
      ['BASE:modules: as-built', { view: 'modules', role: 'base' }],
      ['FINAL:containers: add a queue', { view: 'containers', role: 'final' }],
      ['flows: variant b', { view: 'flows', role: 'variant' }],
    ])('reads the page %s', (name, expected) => {
      expect(pageRoleOf(name)).toEqual(expected);
    });

    it.each(['app', 'FINAL:app: rest', 'modulez', 'FINAL:modules'])('ignores the page %s', (name) => {
      expect(pageRoleOf(name)).toBeNull();
    });

    it('reads module references, and refuses what is not one', () => {
      expect(moduleRefsOf('src/cr')).toEqual(['src/cr']);
      expect(moduleRefsOf('src/utils + src/types')).toEqual(['src/utils', 'src/types']);
      for (const name of ['Workflow', 'src', 'src/cr (review)', 'src/../etc', 'src/cr + Notes', 'src/cr/']) {
        expect(moduleRefsOf(name)).toEqual([]);
      }
    });

    it('reads arrow names with or without spaces, and refuses what is not one', () => {
      expect(arrowEndsOf('src/cr -> src/core')).toEqual({ from: 'src/cr', to: 'src/core' });
      expect(arrowEndsOf('group: Work->src/core')).toEqual({ from: 'group: Work', to: 'src/core' });
      for (const name of ['src/cr', 'a -> b -> c', ' -> src/core']) expect(arrowEndsOf(name)).toBeNull();
    });
  });

  describe('arch-pen / readArchPen', () => {
    it('refuses what is not a .pen document', () => {
      expect(readArchPen('{ nope').ok).toBe(false);
      expect(readArchPen(JSON.stringify({ version: '2.17' })).ok).toBe(false);
    });

    it('keeps only the pages that name a view, in file order', () => {
      const read = readArchPen(pen(node('frame', 'Notes'), node('frame', 'modules'), node('frame', 'FINAL:flows: new')));
      if (!read.ok) throw new Error(read.error);
      expect(read.doc.pages.map((p) => [p.name, p.role])).toEqual([
        ['modules', 'baseline'],
        ['FINAL:flows: new', 'final'],
      ]);
    });

    it('counts frames, rectangles, ellipses and refs as boxes — never text, icons or paths', () => {
      const page = onlyPage(
        pen(
          node('frame', 'modules', [
            box('src/cr'),
            node('rectangle', 'src/core'),
            node('ellipse', 'Store'),
            node('ref', 'src/utils'),
            node('text', 'src/docs'),
            node('icon', 'src/lib'),
            arrow('src/cr -> src/core'),
          ]),
        ),
      );
      expect(page.boxes.map((b) => [b.name, b.refs])).toEqual([
        ['src/cr', ['src/cr']],
        ['src/core', ['src/core']],
        ['Store', []],
        ['src/utils', ['src/utils']],
      ]);
    });

    it('collects every box inside a group, nested groups included', () => {
      const page = onlyPage(pen(node('frame', 'modules', [group('Work', box('src/cr'), group('Inner', box('src/prep')))])));
      expect(page.groups.map((g) => [g.name, g.boxIds.length])).toEqual([
        ['group: Work', 2],
        ['group: Inner', 1],
      ]);
    });

    it('resolves an end to a box, to one module of a multi-module box, or to a group', () => {
      const page = onlyPage(
        pen(
          node('frame', 'modules', [
            box('src/cr'),
            box('src/utils + src/types'),
            group('Shared', box('src/core')),
            arrow('src/cr -> src/types'),
            arrow('src/cr -> group:Shared'),
            arrow('src/cr -> src/utils + src/types'),
          ]),
        ),
      );
      expect(page.arrows.map((a) => [a.to.kind, a.to.kind === 'unresolved' ? [] : a.to.refs])).toEqual([
        ['box', ['src/types']],
        ['group', ['src/core']],
        ['box', ['src/utils', 'src/types']],
      ]);
    });

    it('leaves an end unresolved when it names nothing, or more than one box', () => {
      const page = onlyPage(pen(node('frame', 'context', [box('git'), box('git'), arrow('git -> gh')])));
      expect(page.arrows[0]?.from).toEqual({ kind: 'unresolved', text: 'git', matches: 2 });
      expect(page.arrows[0]?.to).toEqual({ kind: 'unresolved', text: 'gh', matches: 0 });
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `pnpm vitest run src/design/__tests__/arch-pen.test.ts`
  Expected: FAIL — `Failed to resolve import "../arch-pen.js"`, because the module does not exist yet.

- [ ] **Step 3: Write the reader.**

  Create `src/design/arch-pen.ts`:

  ```ts
  // @fd: architecture-design-phase
  // The architecture canvas contract (spec: "Tag contract"): which nodes of a
  // `.pen` are boxes, groups and arrows, and which modules each one stands for.
  // Pure — text in, a model out — so the check, `design arch-route` and
  // `design arch-progress` read one grammar and never disagree about what an
  // arrow connects. Meaning lives in LAYER NAMES: a pen id may not contain `/`,
  // and a layer name is what the operator can read and fix in the editor.

  import { errMessage } from '../core/err-message.js';
  import { ARCHITECTURE_PAGES, type ArchitecturePageId } from '../docs/architecture-schema.js';

  /** The four views, in registry order — the baseline holds one page per view. */
  export const ARCH_VIEWS: readonly ArchitecturePageId[] = ARCHITECTURE_PAGES.map((page) => page.id);

  /** Node types that count as boxes; text, icon and path nodes never do. */
  const BOX_TYPES: ReadonlySet<string> = new Set(['frame', 'rectangle', 'ellipse', 'ref']);
  /** One module-path segment: path characters only, never `.` or `..`. */
  const SEGMENT_RE = /^[A-Za-z0-9_.@-]+$/;
  const ARROW_RE = /\s*->\s*/;
  const GROUP_PREFIX = 'group:';

  /** How a page takes part in the design lifecycle. */
  export type PageRole = 'baseline' | 'base' | 'variant' | 'final';

  export interface ArchBox {
    readonly id: string;
    readonly name: string;
    /** Module paths the name covers; empty for a box that names no module. */
    readonly refs: readonly string[];
  }

  export interface ArchGroup {
    readonly id: string;
    /** Canonical `group: <Name>`, whatever spacing the layer name used. */
    readonly name: string;
    /** Every box inside the group, nested groups included. */
    readonly boxIds: readonly string[];
  }

  /** An arrow end: what it resolves to and the modules it stands for, or how many boxes it matched. */
  export type ArchEndpoint =
    | { readonly kind: 'box' | 'group'; readonly text: string; readonly id: string; readonly refs: readonly string[] }
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
    readonly view: ArchitecturePageId;
    readonly role: PageRole;
    readonly boxes: readonly ArchBox[];
    readonly groups: readonly ArchGroup[];
    readonly arrows: readonly ArchArrow[];
  }

  /** Every top-level page that names a view, in file order; other pages are ignored. */
  export interface ArchDoc {
    readonly pages: readonly ArchPage[];
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

  function viewNamed(text: string): ArchitecturePageId | undefined {
    const trimmed = text.trim();
    return ARCH_VIEWS.find((view) => view === trimmed);
  }

  /** The view and role a top-level page name declares, or `null` for a page the contract ignores. */
  export function pageRoleOf(name: string): { view: ArchitecturePageId; role: PageRole } | null {
    const trimmed = name.trim();
    const bare = viewNamed(trimmed);
    if (bare !== undefined) return { view: bare, role: 'baseline' };
    for (const [prefix, role] of [
      ['BASE:', 'base'],
      ['FINAL:', 'final'],
    ] as const) {
      if (!trimmed.startsWith(prefix)) continue;
      const rest = trimmed.slice(prefix.length);
      const colon = rest.indexOf(':');
      const view = colon === -1 ? undefined : viewNamed(rest.slice(0, colon));
      return view === undefined ? null : { view, role };
    }
    const colon = trimmed.indexOf(':');
    const view = colon === -1 ? undefined : viewNamed(trimmed.slice(0, colon));
    return view === undefined ? null : { view, role: 'variant' };
  }

  /** The module paths a box name covers (`src/cr`, `src/a + src/b`), or `[]` when it is not a module reference. */
  export function moduleRefsOf(name: string): string[] {
    const parts = name.split(' + ').map((part) => part.trim());
    const isPath = (part: string): boolean => {
      const segments = part.split('/');
      return segments.length >= 2 && segments.every((s) => SEGMENT_RE.test(s) && s !== '.' && s !== '..');
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

  /** `group: <Name>` in canonical spacing, or `null` for a name that is not a group. */
  function groupNameOf(name: string): string | null {
    const trimmed = name.trim();
    if (!trimmed.startsWith(GROUP_PREFIX)) return null;
    const label = trimmed.slice(GROUP_PREFIX.length).trim();
    return label === '' ? null : `${GROUP_PREFIX} ${label}`;
  }

  function readPage(page: PenNode, view: ArchitecturePageId, role: PageRole): ArchPage {
    const boxes: ArchBox[] = [];
    const groups: Array<{ id: string; name: string; boxIds: string[] }> = [];
    const paths: Array<{ id: string; name: string }> = [];

    const walk = (node: PenNode, open: ReadonlyArray<{ boxIds: string[] }>): void => {
      const name = (node.name ?? '').trim();
      const group = node.type === 'frame' ? groupNameOf(name) : null;
      let inner = open;
      if (node.type === 'path') {
        if (name !== '') paths.push({ id: node.id, name });
      } else if (group !== null) {
        const entry = { id: node.id, name: group, boxIds: [] as string[] };
        groups.push(entry);
        inner = [...open, entry];
      } else if (BOX_TYPES.has(node.type) && name !== '') {
        boxes.push({ id: node.id, name, refs: moduleRefsOf(name) });
        for (const g of open) g.boxIds.push(node.id);
      }
      for (const child of node.children ?? []) if (isPenNode(child)) walk(child, inner);
    };
    for (const child of page.children ?? []) if (isPenNode(child)) walk(child, []);

    const byId = new Map(boxes.map((box) => [box.id, box]));
    const resolve = (text: string): ArchEndpoint => {
      const groupName = groupNameOf(text);
      if (groupName !== null) {
        const hits = groups.filter((g) => g.name === groupName);
        const [hit] = hits;
        if (hits.length !== 1 || hit === undefined) return { kind: 'unresolved', text, matches: hits.length };
        const refs = [...new Set(hit.boxIds.flatMap((id) => byId.get(id)?.refs ?? []))].sort();
        return { kind: 'group', text, id: hit.id, refs };
      }
      const hits = boxes.filter((box) => box.name === text || box.refs.includes(text));
      const [hit] = hits;
      if (hits.length !== 1 || hit === undefined) return { kind: 'unresolved', text, matches: hits.length };
      return { kind: 'box', text, id: hit.id, refs: hit.name === text ? hit.refs : [text] };
    };

    const arrows: ArchArrow[] = [];
    for (const path of paths) {
      const ends = arrowEndsOf(path.name);
      if (ends !== null) arrows.push({ id: path.id, name: path.name, from: resolve(ends.from), to: resolve(ends.to) });
    }
    return { id: page.id, name: (page.name ?? '').trim(), view, role, boxes, groups, arrows };
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
    const children = typeof doc === 'object' && doc !== null ? (doc as { children?: unknown }).children : undefined;
    if (!Array.isArray(children)) return { ok: false, error: 'no top-level children array — not a .pen document' };
    const pages: ArchPage[] = [];
    for (const child of children) {
      if (!isPenNode(child)) continue;
      const role = pageRoleOf(child.name ?? '');
      if (role !== null) pages.push(readPage(child, role.view, role.role));
    }
    return { ok: true, doc: { pages } };
  }
  ```

- [ ] **Step 4: Run the test and the typecheck to verify they pass.**

  Run: `pnpm vitest run src/design/__tests__/arch-pen.test.ts`
  Expected: PASS — `Tests  15 passed (15)`.

  Run: `pnpm typecheck`
  Expected: exit 0, no output.

- [ ] **Step 5: Commit.**

  This is the first code-bearing commit, so its body carries the PR Summary's three sections.

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(design): read an architecture .pen into boxes, groups and arrows

  Why — the architecture baseline lives on the pen.dev canvas, and every
  architecture command (the honesty check, arrow re-route, milestone progress)
  must agree on what a box covers and what an arrow connects; pen.dev has no
  connector node, so that meaning has to live somewhere the operator can see
  and edit.
  How — one pure reader keyed on layer names: a box named by a module path
  covers it, a `group: <Name>` frame groups boxes, a path named
  `<from> -> <to>` is an arrow, and every arrow end resolves to exactly one
  box or group or is reported unresolved.
  What — src/design/arch-pen.ts (readArchPen, pageRoleOf, moduleRefsOf,
  arrowEndsOf, ARCH_VIEWS and the model types) with its unit tests.

  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/design/arch-pen.ts src/design/__tests__/arch-pen.test.ts
  git commit -F "$msg"
  ```

  Expected: the commit lands. The pre-commit `test-links` job adds the test file to the FD's `links.tests` and stages the FD into the same commit.

---

## Task 2: Module coverage

**Files:**

- Create: `src/design/arch-check.ts`
- Test: `src/design/__tests__/arch-check.test.ts`

These are the spec's "Honesty check" findings that need nothing but the module list:
- `unreadable`: a view page is missing or doubled.
- `dangling-edge`: an arrow end on any page does not resolve.
- On `modules` only:
  - `missing-module`: a module no box covers.
  - `unknown-module`: a box names a path that is not a module.
  - `duplicate-module`: a module covered twice.

Part 2 adds the import-backed arrow rules to the same function.

- [ ] **Step 1: Write the failing test file.**

  Create `src/design/__tests__/arch-check.test.ts`:

  ```ts
  // @tests: architecture-design-phase
  import { describe, expect, it } from 'vitest';

  import { checkArchDoc } from '../arch-check.js';
  import { readArchPen, type ArchDoc } from '../arch-pen.js';

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
  const arrow = (name: string): Node => node('path', name);

  function doc(...pages: Node[]): ArchDoc {
    const read = readArchPen(JSON.stringify({ version: '2.17', children: pages }));
    if (!read.ok) throw new Error(read.error);
    return read.doc;
  }
  /** A baseline with the three other views present and empty, and `children` on `modules`. */
  const baseline = (...children: Node[]): ArchDoc =>
    doc(node('frame', 'context'), node('frame', 'containers'), node('frame', 'modules', children), node('frame', 'flows'));

  const MODULES = ['src/core', 'src/cr', 'src/utils'];
  const found = (d: ArchDoc): string[][] => checkArchDoc(d, MODULES).findings.map((f) => [f.kind, f.subject]);

  describe('arch-check / module coverage', () => {
    it('passes a view that covers every module once', () => {
      expect(found(baseline(box('src/core'), box('src/cr + src/utils'), arrow('src/cr -> src/core')))).toEqual([]);
    });

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
  });

  describe('arch-check / the file and the other views', () => {
    it('needs exactly one page per view', () => {
      expect(checkArchDoc(doc(node('frame', 'modules'), node('frame', 'modules')), []).findings.map((f) => [f.kind, f.subject])).toEqual([
        ['unreadable', 'context'],
        ['unreadable', 'containers'],
        ['unreadable', 'modules'],
        ['unreadable', 'flows'],
      ]);
    });

    it('checks only that arrow ends resolve on the views with no code truth', () => {
      const d = doc(
        node('frame', 'context', [box('noldor CLI'), box('git'), arrow('noldor CLI -> git'), arrow('git -> gh')]),
        node('frame', 'containers'),
        node('frame', 'modules', [box('src/core'), box('src/cr'), box('src/utils')]),
        node('frame', 'flows'),
      );
      expect(checkArchDoc(d, MODULES).findings.map((f) => [f.kind, f.view, f.subject])).toEqual([
        ['dangling-edge', 'context', 'git -> gh'],
      ]);
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `pnpm vitest run src/design/__tests__/arch-check.test.ts`
  Expected: FAIL — `Failed to resolve import "../arch-check.js"`.

- [ ] **Step 3: Write the rules.**

  Create `src/design/arch-check.ts`:

  ```ts
  // @fd: architecture-design-phase
  // The honesty rules for the architecture baseline (spec: "Honesty check").
  // Pure — the model and the module list in, findings out — so each rule is a
  // unit test; `arch-baseline.ts` gathers the inputs.

  import { ARCH_VIEWS, type ArchDoc, type ArchPage } from './arch-pen.js';

  export type ArchFindingKind = 'unreadable' | 'missing-module' | 'unknown-module' | 'duplicate-module' | 'dangling-edge';

  export interface ArchFinding {
    readonly kind: ArchFindingKind;
    /** The view it is on — `baseline` for a problem with the file as a whole. */
    readonly view: string;
    /** What it names: a module path, an arrow, a view or a file. */
    readonly subject: string;
    readonly message: string;
  }

  export interface ArchCheckResult {
    readonly findings: readonly ArchFinding[];
  }

  const KIND_ORDER: readonly ArchFindingKind[] = ['unreadable', 'missing-module', 'unknown-module', 'duplicate-module', 'dangling-edge'];

  /** Registry order for a view; `baseline` (the whole file) sorts first. */
  function viewRank(view: string): number {
    return ARCH_VIEWS.findIndex((v) => v === view);
  }

  /**
   * Hold a baseline to the module list: one page per view, every arrow end on
   * every page resolving, and the `modules` page covering each module once.
   */
  export function checkArchDoc(doc: ArchDoc, modules: readonly string[]): ArchCheckResult {
    const findings: ArchFinding[] = [];
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
    if (modulesPages.length === 1 && modulesPage !== undefined) checkCoverage(modulesPage, modules, findings);

    findings.sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        viewRank(a.view) - viewRank(b.view) ||
        a.subject.localeCompare(b.subject),
    );
    return { findings };
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
  ```

- [ ] **Step 4: Run the test and the typecheck to verify they pass.**

  Run: `pnpm vitest run src/design/__tests__/arch-check.test.ts`
  Expected: PASS — `Tests  6 passed (6)`.

  Run: `pnpm typecheck`
  Expected: exit 0, no output.

- [ ] **Step 5: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(design): hold an architecture baseline's modules view to the module list

  The first honesty rules: one page per view, every arrow end resolving on
  every page, and the modules page covering each module exactly once — the
  findings that need only listModuleDirs. Import-backed arrows follow.

  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/design/arch-check.ts src/design/__tests__/arch-check.test.ts
  git commit -F "$msg"
  ```

---

## Task 3: The `checks arch-baseline` command

**Files:**

- Modify: `src/core/design-artifact-names.ts`
- Create: `src/design/arch-baseline.ts`
- Create: `src/checks/check-arch-baseline.ts`
- Modify: `src/cli/manifest.ts`
- Modify: `docs/noldor/script-catalog.md`, `templates/docs/noldor/script-catalog.md`
- Modify (generated): `AGENTS.md`, `templates/AGENTS.md`
- Test: `src/checks/__tests__/check-arch-baseline.test.ts`

When the file does not exist, `checkArchBaseline` reports `absent` and reads nothing else. That is what keeps the surface inert in a repo that never opted in. Every read failure becomes an `unreadable` finding rather than a throw.

- [ ] **Step 1: Add the location constants.**

  In `src/core/design-artifact-names.ts`, directly after the `UI_DESIGN_DIR` export, add:

  ```ts
  /**
   * Directory holding architecture-design `.pen` files: the baseline, the dated
   * per-session designs and their `archive/`, and milestone targets under
   * `milestones/`. Parallel to {@link UI_DESIGN_DIR}; see ADR 0007.
   */
  export const ARCH_DESIGN_DIR = 'docs/design/architecture';

  /**
   * The as-built architecture baseline: one `.pen`, one top-level page per
   * architecture view. Its presence is the opt-in — every architecture check is
   * inert while it is absent.
   */
  export const ARCH_BASELINE_PATH = `${ARCH_DESIGN_DIR}/baseline.pen`;
  ```

- [ ] **Step 2: Write the failing test file.**

  Create `src/checks/__tests__/check-arch-baseline.test.ts`:

  ```ts
  // @tests: architecture-design-phase
  import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';

  import { afterEach, describe, expect, it, vi } from 'vitest';

  import { main } from '../check-arch-baseline.js';

  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  interface Node {
    id: string;
    type: string;
    name: string;
    children?: Node[];
  }
  let seq = 0;
  const node = (type: string, name: string, children: Node[] = []): Node => ({ id: `n${++seq}`, type, name, children });

  /** A repo whose `src/a` imports `src/b`, with a schema-valid config. */
  async function makeRepo(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'arch-baseline-'));
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
    await mkdir(join(root, 'src', 'a'), { recursive: true });
    await mkdir(join(root, 'src', 'b'), { recursive: true });
    await writeFile(join(root, 'src', 'a', 'x.ts'), "import { y } from '../b/y.js';\n\nexport const x = (): string => y();\n", 'utf8');
    await writeFile(join(root, 'src', 'b', 'y.ts'), "export const y = (): string => 'y';\n", 'utf8');
    return root;
  }

  /** Write a baseline whose three other views are empty and whose `modules` holds `children`. */
  async function writeBaseline(root: string, children: Node[] | string): Promise<void> {
    await mkdir(join(root, 'docs', 'design', 'architecture'), { recursive: true });
    const body =
      typeof children === 'string'
        ? children
        : JSON.stringify({
            version: '2.17',
            children: [node('frame', 'context'), node('frame', 'containers'), node('frame', 'modules', children), node('frame', 'flows')],
          });
    await writeFile(join(root, 'docs', 'design', 'architecture', 'baseline.pen'), body, 'utf8');
  }

  async function run(root: string): Promise<{ code: number; out: string }> {
    const lines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      lines.push(a.join(' '));
    });
    try {
      return { code: await main(root), out: lines.join('\n') };
    } finally {
      log.mockRestore();
    }
  }

  describe('checks arch-baseline', () => {
    it('exits 0 and says absent when the repo has no baseline', async () => {
      const r = await run(await makeRepo());
      expect(r.code).toBe(0);
      expect(r.out).toContain('absent');
    });

    it('exits 0 on a baseline that covers every module', async () => {
      const root = await makeRepo();
      await writeBaseline(root, [node('frame', 'src/a'), node('frame', 'src/b'), node('path', 'src/a -> src/b')]);
      const r = await run(root);
      expect(r.code).toBe(0);
      expect(r.out).toContain('ok');
    });

    it('exits 1 and names a module the baseline leaves out', async () => {
      const root = await makeRepo();
      await writeBaseline(root, [node('frame', 'src/a')]);
      const r = await run(root);
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/missing-module.*src\/b/);
    });

    it('exits 1 on a baseline that is not a .pen document', async () => {
      const root = await makeRepo();
      await writeBaseline(root, '{ nope');
      const r = await run(root);
      expect(r.code).toBe(1);
      expect(r.out).toContain('unreadable');
    });
  });
  ```

- [ ] **Step 3: Run the test to verify it fails.**

  Run: `pnpm vitest run src/checks/__tests__/check-arch-baseline.test.ts`
  Expected: FAIL — `Failed to resolve import "../check-arch-baseline.js"`.

- [ ] **Step 4: Write the IO seam.**

  Create `src/design/arch-baseline.ts`:

  ```ts
  // @fd: architecture-design-phase
  // The architecture honesty check with its inputs gathered: the baseline read
  // from disk and the module set from the code. Shared by `checks arch-baseline`
  // and the release preflight row — which is why it lives here rather than in
  // the CLI file: src/release never imports src/checks.

  import { readFile } from 'node:fs/promises';
  import { join } from 'node:path';

  import { ARCH_BASELINE_PATH } from '../core/design-artifact-names.js';
  import { errMessage } from '../core/err-message.js';
  import { listModuleDirs } from '../docs/docs-architecture.js';
  import { checkArchDoc, type ArchFinding } from './arch-check.js';
  import { readArchPen } from './arch-pen.js';

  export interface ArchBaselineReport {
    /** `absent` — no baseline, nothing checked; `ok` — no findings; `incomplete` — findings. */
    readonly status: 'absent' | 'ok' | 'incomplete';
    readonly findings: readonly ArchFinding[];
  }

  function unreadable(subject: string, message: string): ArchBaselineReport {
    return { status: 'incomplete', findings: [{ kind: 'unreadable', view: 'baseline', subject, message }] };
  }

  /** Hold `docs/design/architecture/baseline.pen` to the code. Every read failure is a finding, never a throw. */
  export async function checkArchBaseline(cwd: string): Promise<ArchBaselineReport> {
    let text: string;
    try {
      text = await readFile(join(cwd, ARCH_BASELINE_PATH), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'absent', findings: [] };
      return unreadable(ARCH_BASELINE_PATH, errMessage(err));
    }
    const read = readArchPen(text);
    if (!read.ok) return unreadable(ARCH_BASELINE_PATH, read.error);
    const result = checkArchDoc(read.doc, await listModuleDirs(cwd));
    return { status: result.findings.length === 0 ? 'ok' : 'incomplete', ...result };
  }
  ```

- [ ] **Step 5: Write the CLI.**

  Create `src/checks/check-arch-baseline.ts`:

  ```ts
  // @fd: architecture-design-phase
  // `noldor checks arch-baseline` — the architecture baseline held to the code.
  // Exit 0 when there is no baseline (absent) or it is clean, 1 on any finding.
  // Gate Step 4 runs it advisorily; release preflight blocks on it (the
  // `arch-baseline` row).

  import { runIfDirect } from '../core/cli-entry.js';
  import { ARCH_BASELINE_PATH } from '../core/design-artifact-names.js';
  import { checkArchBaseline, type ArchBaselineReport } from '../design/arch-baseline.js';

  export function row(kind: string, view: string, subject: string, message: string): string {
    return `  ${kind.padEnd(17)} ${view.padEnd(11)} ${subject} — ${message}`;
  }

  export function renderReport(report: ArchBaselineReport): string {
    if (report.status === 'absent') return `arch-baseline: absent — no ${ARCH_BASELINE_PATH}, nothing to check`;
    return [
      report.status === 'ok'
        ? `arch-baseline: ok — ${ARCH_BASELINE_PATH} matches the code`
        : `arch-baseline: ${report.findings.length} finding(s) in ${ARCH_BASELINE_PATH}`,
      ...report.findings.map((f) => row(f.kind, f.view, f.subject, f.message)),
    ].join('\n');
  }

  export async function main(cwd: string = process.cwd()): Promise<number> {
    const report = await checkArchBaseline(cwd);
    console.log(renderReport(report));
    return report.status === 'incomplete' ? 1 : 0;
  }

  runIfDirect('check-arch-baseline', 'checks arch-baseline', async () => main());
  ```

- [ ] **Step 6: Run the test and the typecheck to verify they pass.**

  Run: `pnpm vitest run src/checks/__tests__/check-arch-baseline.test.ts`
  Expected: PASS — `Tests  4 passed (4)`.

  Run: `pnpm typecheck`
  Expected: exit 0, no output.

- [ ] **Step 7: Register and document the command.**

  In `src/cli/manifest.ts`, inside `checks.subs`, directly after the `'ui-design-freshness'` entry, add:

  ```ts
        'arch-baseline': {
          src: 'checks/check-arch-baseline.ts',
          desc: 'Architecture baseline .pen held to the code; exit 1 on findings, 0 when absent or clean',
        },
  ```

  In `docs/noldor/script-catalog.md`, directly after the `### \`check:ui-design-freshness\`` entry (after its `- **Source:**` line), insert:

  ```markdown
  ### `check:arch-baseline`

  - **Trigger:** `pnpm noldor checks arch-baseline`. Run by `/noldor-gate` Step 4 (advisory — the exit code never blocks `pr-flow`) and by release preflight (the `arch-baseline` row, blocking when the baseline exists).
  - **Inputs:** `docs/design/architecture/baseline.pen` and the module set (`listModuleDirs` over `consumer.scanPaths`).
  - **Outputs:** one row per finding:
    - `unreadable` — a view page missing or doubled, or a file that is not a `.pen` document;
    - `missing-module`, `unknown-module`, `duplicate-module`;
    - `dangling-edge`.

    Exit 0 when the baseline is absent (nothing is checked) or clean, 1 on any finding.
  - **When to use:** after drawing or editing the baseline, and whenever a change adds, removes or renames a module. Repair by redrawing the named box or arrow. The layer names are the contract:
    - a module box is named by its path: `src/cr`, or `src/a + src/b` for a box that covers two;
    - a group frame is named `group: <Name>`;
    - an arrow is named `<from> -> <to>`.
  - **Source:** [`src/checks/check-arch-baseline.ts`](../../src/checks/check-arch-baseline.ts)
  ```

  Then run:

  ```bash
  cp docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md
  pnpm noldor docs capability-index --write
  pnpm noldor validate script-catalog
  ```

  Expected:
  - `capability-index --write` exits 0, and the `checks` line in both `AGENTS.md` and `templates/AGENTS.md` now lists `arch-baseline`.
  - `validate script-catalog` exits 0 and prints `Validated script-catalog: … all cited …`.

- [ ] **Step 8: Commit.**

  The commit mixes code with a `docs/noldor/` page, so it carries a `Noldor-Sibling-Scope` trailer in the same trailer paragraph.

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(checks): checks arch-baseline holds the architecture baseline to the module set

  Reads docs/design/architecture/baseline.pen and the module set and reports
  each finding; absent when the repo has no baseline, so the surface stays
  inert until someone draws one. Every read failure is an unreadable finding.

  Noldor-Sibling-Scope: noldor:script-catalog
  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/core/design-artifact-names.ts src/design/arch-baseline.ts src/checks/check-arch-baseline.ts \
    src/checks/__tests__/check-arch-baseline.test.ts src/cli/manifest.ts \
    docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md AGENTS.md templates/AGENTS.md
  git commit -F "$msg"
  ```

  Expected: the commit lands, and the pre-commit `script-catalog`, `capability-index` and `template-sync` jobs pass.

  Run: `pnpm noldor checks arch-baseline`
  Expected: exit 0, printing `arch-baseline: absent — no docs/design/architecture/baseline.pen, nothing to check`. This repo draws its baseline in Part 3.
