# pen.dev Architecture Design Phase Implementation Plan — Part 6: arrow re-route

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** after the operator drags boxes on an architecture canvas, `pnpm -s noldor design arch-route --pen <path> [--view <view>]` prints a pencil `execute` snippet. Running that snippet puts every arrow back on its two boxes.

**Architecture:** pen.dev has no sticky connector, so an arrow is a loose `path` node. The command works in two halves:
1. **Resolve.** `routeEdges` runs the check's own reader (`readArchPen`) over the file on disk and matches each arrow to its two node ids. Re-route and the check therefore never disagree about what an arrow connects.
2. **Print.** `renderRouteSnippet` bakes those ids into a fixed snippet. In the editor, the snippet reads each box's **live** bounds with `Get`, walking parent frames up to page coordinates, and rewrites each arrow with `Update`: a border-to-border segment plus a two-stroke arrowhead in one path geometry. The format has no `<marker>`, so the arrowhead is part of the path.

Moved boxes need no save; a newly drawn arrow does, because matching reads the disk. The snippet lives in a TypeScript string constant, with no template literals or comments inside it, so it embeds verbatim and ships in `dist` with no runtime-asset entry. The test runs it in a `node:vm` context against stub `Get` / `Update` / `Print` functions.

**Tech Stack:** TypeScript (ESM, Node >= 24), vitest, `node:vm`.

**Parts:** 6 of 9. Part 7 wires re-route into the spec and gate steps.

---

## File Structure

- `src/design/arch-route.ts` — **Create.** Holds `RouteEdge`, `routeEdges(doc, view?)`, `renderRouteSnippet(edges)` and the `design arch-route` CLI (`main`).
- `src/design/__tests__/arch-route.test.ts` — **Create.** Covers edge resolution, the snippet run against stubs over a nested fixture page, and the CLI's exit codes.
- `src/cli/manifest.ts` — **Modify.** Registers `design arch-route`.
- `docs/noldor/script-catalog.md` + `templates/docs/noldor/script-catalog.md` — **Modify.** Adds the `design:arch-route` entry.
- `AGENTS.md` + `templates/AGENTS.md` — **Modify (generated).** Updates the `design` line of the capability index.

---

## Task 1: Resolve the arrows and print the snippet

**Files:**

- Create: `src/design/arch-route.ts`
- Test: `src/design/__tests__/arch-route.test.ts`

- [ ] **Step 1: Write the failing test file.**

  Create `src/design/__tests__/arch-route.test.ts`:

  ```ts
  // @tests: architecture-design-phase
  import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { runInNewContext } from 'node:vm';

  import { afterEach, describe, expect, it, vi } from 'vitest';

  import { readArchPen } from '../arch-pen.js';
  import { main, renderRouteSnippet, routeEdges } from '../arch-route.js';

  interface Node {
    id: string;
    type: string;
    name: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    children?: Node[];
  }

  /** A modules page: box A nested in a group at (100, 50), box B at the page level, one routable arrow, one not. */
  const PAGE: Node = {
    id: 'P',
    type: 'frame',
    name: 'modules',
    width: 800,
    height: 600,
    children: [
      {
        id: 'G',
        type: 'frame',
        name: 'group: Work',
        x: 100,
        y: 50,
        width: 300,
        height: 200,
        children: [{ id: 'A', type: 'frame', name: 'src/cr', x: 10, y: 20, width: 100, height: 30 }],
      },
      { id: 'B', type: 'frame', name: 'src/core', x: 400, y: 300, width: 100, height: 30 },
      { id: 'E', type: 'path', name: 'src/cr -> src/core', width: 1, height: 1 },
      { id: 'F', type: 'path', name: 'src/cr -> src/nowhere', width: 1, height: 1 },
    ],
  };
  const PEN_TEXT = JSON.stringify({ version: '2.17', children: [PAGE] });

  /** The pencil runtime, stubbed: `Get` visits top-down with parent-relative bounds, `Update` records. */
  function runSnippet(source: string): { updates: Map<string, Record<string, unknown>>; printed: string[] } {
    const updates = new Map<string, Record<string, unknown>>();
    const printed: string[] = [];
    const find = (id: string, n: Node): Node | undefined =>
      n.id === id ? n : (n.children ?? []).map((c) => find(id, c)).find((hit) => hit !== undefined);
    const Get = (id: string, visit: (n: Node, ctx: unknown) => unknown): void => {
      const walk = (n: Node, parentCtx: unknown): void => {
        const ctx = { node: n, parentCtx, bounds: { x: n.x ?? 0, y: n.y ?? 0, width: n.width ?? 0, height: n.height ?? 0 } };
        visit(n, ctx);
        for (const child of n.children ?? []) walk(child, ctx);
      };
      const root = find(id, PAGE);
      if (root !== undefined) walk(root, undefined);
    };
    const Update = (id: string, data: Record<string, unknown>): void => {
      updates.set(id, data);
    };
    const Print = (...values: unknown[]): void => {
      printed.push(values.join(' '));
    };
    runInNewContext(source, { Get, Update, Print });
    return { updates, printed };
  }

  function onBorder(p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): boolean {
    const e = 0.2;
    const within = p.x >= r.x - e && p.x <= r.x + r.w + e && p.y >= r.y - e && p.y <= r.y + r.h + e;
    const onEdge =
      Math.abs(p.x - r.x) < e || Math.abs(p.x - (r.x + r.w)) < e || Math.abs(p.y - r.y) < e || Math.abs(p.y - (r.y + r.h)) < e;
    return within && onEdge;
  }

  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  describe('design arch-route', () => {
    const read = readArchPen(PEN_TEXT);
    if (!read.ok) throw new Error(read.error);

    it("routes every arrow whose ends resolve with the check's own reader, and names the rest", () => {
      const { edges, unresolved } = routeEdges(read.doc);
      expect(edges).toEqual([{ id: 'E', name: 'src/cr -> src/core', page: 'P', from: 'A', to: 'B' }]);
      expect(unresolved).toEqual(['modules: src/cr -> src/nowhere']);
      expect(routeEdges(read.doc, 'context').edges).toEqual([]);
    });

    it("prints a snippet that puts both ends of each arrow on its boxes' borders, nested frames included", () => {
      const { updates, printed } = runSnippet(renderRouteSnippet(routeEdges(read.doc).edges));
      const [x1, y1, x2, y2] = String(updates.get('E')?.geometry).match(/-?\d+(\.\d+)?/g)?.slice(0, 4).map(Number) ?? [];
      expect(onBorder({ x: x1 ?? NaN, y: y1 ?? NaN }, { x: 110, y: 70, w: 100, h: 30 })).toBe(true);
      expect(onBorder({ x: x2 ?? NaN, y: y2 ?? NaN }, { x: 400, y: 300, w: 100, h: 30 })).toBe(true);
      expect(printed).toEqual(['re-routed 1 of 1 arrow(s)']);
    });

    it('bakes names in verbatim, replacement patterns included', () => {
      const edges = [{ id: 'E', name: "Pay $' -> $$Bank", page: 'P', from: 'A', to: 'B' }];
      const snippet = renderRouteSnippet(edges);
      expect(snippet).toContain(JSON.stringify(edges));
      expect(runSnippet(snippet).printed).toEqual(['re-routed 1 of 1 arrow(s)']);
    });

    it('exits 0 printing the snippet, 1 with nothing to route, and 2 on bad arguments', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'arch-route-'));
      dirs.push(cwd);
      writeFileSync(join(cwd, 'design.pen'), PEN_TEXT);
      const out: string[] = [];
      const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
        out.push(a.join(' '));
      });
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        expect(await main(['--pen', 'design.pen', '--view', 'modules'], cwd)).toBe(0);
        expect(out.join('\n')).toContain('"id":"E"');
        expect(await main(['--pen', 'design.pen', '--view', 'flows'], cwd)).toBe(1);
        expect(await main(['--pen', 'design.pen', '--view', 'app'], cwd)).toBe(2);
        expect(await main([], cwd)).toBe(2);
      } finally {
        log.mockRestore();
        error.mockRestore();
      }
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `pnpm vitest run src/design/__tests__/arch-route.test.ts`
  Expected: FAIL — `Failed to resolve import "../arch-route.js"`.

- [ ] **Step 3: Write the resolver, the snippet and the CLI.**

  Create `src/design/arch-route.ts`:

  ```ts
  // @fd: architecture-design-phase
  // `noldor design arch-route` — redraw the arrows a moved box left behind
  // (spec: "Arrow re-route"). pen.dev has no connector node, so an arrow is a
  // loose path. This command resolves every arrow's two boxes with the SAME
  // reader the honesty check uses, so the two never disagree about what an
  // arrow connects, and prints a pencil `execute` snippet with those node ids
  // baked in. The snippet reads each box's LIVE bounds: moved boxes need no
  // save, a newly drawn arrow does, because the matching reads the disk.

  import { readFileSync } from 'node:fs';
  import { resolve } from 'node:path';

  import { optionalFlag, runIfDirect } from '../core/cli-entry.js';
  import { errMessage } from '../core/err-message.js';
  import type { ArchitecturePageId } from '../docs/architecture-schema.js';
  import { ARCH_VIEWS, readArchPen, type ArchDoc } from './arch-pen.js';

  /** One arrow to redraw: its node, the page it sits on, and the two nodes it joins. */
  export interface RouteEdge {
    readonly id: string;
    readonly name: string;
    readonly page: string;
    readonly from: string;
    readonly to: string;
  }

  /** Every arrow whose ends resolve, on every page or on one view's pages; the others are named, not routed. */
  export function routeEdges(doc: ArchDoc, view?: ArchitecturePageId): { edges: RouteEdge[]; unresolved: string[] } {
    const edges: RouteEdge[] = [];
    const unresolved: string[] = [];
    for (const page of doc.pages) {
      if (view !== undefined && page.view !== view) continue;
      for (const arrow of page.arrows) {
        if (arrow.from.kind === 'unresolved' || arrow.to.kind === 'unresolved') {
          unresolved.push(`${page.name}: ${arrow.name}`);
          continue;
        }
        edges.push({ id: arrow.id, name: arrow.name, page: page.id, from: arrow.from.id, to: arrow.to.id });
      }
    }
    return { edges, unresolved };
  }

  /**
   * The pencil `execute` snippet. Plain JS with no comments, backticks or `${`,
   * so it embeds in this constant verbatim; `__EDGES__` is the one substitution.
   * Bounds are summed up the parent chain to page coordinates, and an arrow
   * drawn inside a frame is written in that frame's coordinates.
   */
  const ROUTE_SNIPPET = `const EDGES = __EDGES__;
  const f = (n) => Math.round(n * 10) / 10;
  function edgePoint(r, t) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = t.x + t.w / 2 - cx, dy = t.y + t.h / 2 - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const s = Math.min(dx === 0 ? Infinity : r.w / 2 / Math.abs(dx), dy === 0 ? Infinity : r.h / 2 / Math.abs(dy));
    return { x: cx + dx * s, y: cy + dy * s };
  }
  function shape(a, b, o) {
    const p1 = edgePoint(a, b), p2 = edgePoint(b, a), ang = Math.atan2(p2.y - p1.y, p2.x - p1.x), L = 9, W = 0.45;
    const h1 = { x: p2.x - L * Math.cos(ang - W), y: p2.y - L * Math.sin(ang - W) };
    const h2 = { x: p2.x - L * Math.cos(ang + W), y: p2.y - L * Math.sin(ang + W) };
    const pts = [p1, p2, h1, h2].map((p) => ({ x: p.x - o.x, y: p.y - o.y }));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x = f(Math.min(...xs) - 2), y = f(Math.min(...ys) - 2), w = f(Math.max(...xs) + 2 - x), h = f(Math.max(...ys) + 2 - y);
    const q = pts.map((p) => f(p.x) + ' ' + f(p.y));
    return { geometry: 'M ' + q[0] + ' L ' + q[1] + ' M ' + q[2] + ' L ' + q[1] + ' L ' + q[3], viewBox: [x, y, w, h], x, y, width: w, height: h };
  }
  function offset(ctx, page) {
    let x = 0, y = 0;
    for (let k = ctx; k && k.node.id !== page; k = k.parentCtx) { x += k.bounds.x; y += k.bounds.y; }
    return { x, y };
  }
  const boxIds = new Set(EDGES.flatMap((e) => [e.from, e.to]));
  const arrowIds = new Set(EDGES.map((e) => e.id));
  const rects = {}, origins = {};
  for (const page of [...new Set(EDGES.map((e) => e.page))]) {
    Get(page, (n, c) => {
      if (boxIds.has(n.id)) { const o = offset(c, page); rects[n.id] = { x: o.x, y: o.y, w: c.bounds.width, h: c.bounds.height }; }
      if (arrowIds.has(n.id)) origins[n.id] = c.parentCtx ? offset(c.parentCtx, page) : { x: 0, y: 0 };
      return undefined;
    });
  }
  let done = 0;
  for (const e of EDGES) {
    const a = rects[e.from], b = rects[e.to], o = origins[e.id];
    if (!a || !b || !o) { Print('skipped', e.name, '- an end or the arrow is gone'); continue; }
    Update(e.id, shape(a, b, o));
    done += 1;
  }
  Print('re-routed', done, 'of', EDGES.length, 'arrow(s)');`;

  /**
   * The snippet with `edges` baked in, ready to pass as pencil `execute`'s
   * `input`. A replacer function, not a string: a box or arrow name holding
   * `$'`, `$&` or `$$` would otherwise be read as a replacement pattern.
   */
  export function renderRouteSnippet(edges: readonly RouteEdge[]): string {
    return ROUTE_SNIPPET.replace('__EDGES__', () => JSON.stringify(edges));
  }

  /** Exit 0 = snippet printed, 1 = no arrow to route, 2 = bad arguments or an unreadable `.pen`. */
  export async function main(argv: readonly string[], cwd: string = process.cwd()): Promise<number> {
    const label = 'design arch-route';
    const pen = optionalFlag(argv, '--pen', label);
    const view = optionalFlag(argv, '--view', label);
    if (!pen.ok) {
      console.error(pen.error);
      return 2;
    }
    if (!view.ok) {
      console.error(view.error);
      return 2;
    }
    if (pen.value === undefined || !pen.value.endsWith('.pen')) {
      console.error(`${label}: --pen <path.pen> is required`);
      return 2;
    }
    const views: readonly string[] = ARCH_VIEWS;
    if (view.value !== undefined && !views.includes(view.value)) {
      console.error(`${label}: --view must be one of ${views.join(' | ')}`);
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
    const { edges, unresolved } = routeEdges(read.doc, view.value as ArchitecturePageId | undefined);
    for (const name of unresolved) console.error(`${label}: not routed, an end does not resolve: ${name}`);
    if (edges.length === 0) {
      console.error(`${label}: no arrow to route`);
      return 1;
    }
    console.log(renderRouteSnippet(edges));
    return 0;
  }

  runIfDirect('arch-route', 'design arch-route', async (argv) => main(argv));
  ```

- [ ] **Step 4: Run the test and the typecheck to verify they pass.**

  Run: `pnpm vitest run src/design/__tests__/arch-route.test.ts`
  Expected: PASS — `Tests  4 passed (4)`.

  Run: `pnpm typecheck`
  Expected: exit 0, no output.

- [ ] **Step 5: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(design): resolve an architecture canvas's arrows and print the snippet that redraws them

  routeEdges matches every arrow to its two node ids with the check's own
  reader, and renderRouteSnippet bakes them into a fixed pencil execute
  snippet that reads the boxes' live bounds up the parent chain and rewrites
  each arrow border to border with its arrowhead — pen.dev has no connector
  node, so a moved box otherwise leaves its arrows behind.

  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/design/arch-route.ts src/design/__tests__/arch-route.test.ts
  git commit -F "$msg"
  ```

---

## Task 2: Register `design arch-route`

**Files:**

- Modify: `src/cli/manifest.ts`
- Modify: `docs/noldor/script-catalog.md`, `templates/docs/noldor/script-catalog.md`
- Modify (generated): `AGENTS.md`, `templates/AGENTS.md`

- [ ] **Step 1: Register the command.**

  In `src/cli/manifest.ts`, inside `design.subs`, directly after the `'pen-bridge'` entry, add:

  ```ts
        'arch-route': {
          src: 'design/arch-route.ts',
          desc: "Print a pencil execute snippet that redraws an architecture .pen's named arrows from their boxes' live bounds",
        },
  ```

- [ ] **Step 2: Document it (both twins) and regenerate the capability index.**

  In `docs/noldor/script-catalog.md`, directly after the `### \`design:verdict\`` entry (after its `- **Source:**` line), insert:

  ```markdown
  ### `design:arch-route`

  - **Trigger:** `pnpm -s noldor design arch-route --pen <path.pen> [--view context|containers|modules|flows]`. Run after boxes move on an architecture canvas, by `/noldor-spec` step 1.6 while iterating and by gate Step 4 after the baseline write-back.
  - **Inputs:** the `.pen` on disk, read with the architecture reader (`readArchPen`), so arrows resolve exactly as `checks arch-baseline` resolves them. Moved boxes need no save: the snippet reads live bounds. A newly drawn arrow needs one, because matching reads the file.
  - **Outputs:** a pencil `execute` snippet on stdout. Pass it as `input`, with `filePath` set to the same `.pen`. It rewrites every routable arrow as a border-to-border path with a two-stroke arrowhead, and prints `re-routed <n> of <m> arrow(s)`. Arrows whose ends do not resolve are named on stderr and left alone. Exit 0 = snippet printed, 1 = no arrow to route, 2 = bad arguments or an unreadable `.pen`.
  - **When to use:** whenever dragging boxes left arrows behind. The check never reads geometry, so a green check can sit on a canvas whose arrows are out of place.
  - **Source:** [`src/design/arch-route.ts`](../../src/design/arch-route.ts)
  ```

  Then run:

  ```bash
  cp docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md
  pnpm noldor docs capability-index --write
  pnpm noldor validate script-catalog
  ```

  Expected:
  - `capability-index --write` exits 0. The `design` line in `AGENTS.md` and `templates/AGENTS.md` now lists `arch-route`.
  - `validate script-catalog` exits 0.

- [ ] **Step 3: Confirm the command answers through the CLI.**

  Run: `pnpm -s noldor design arch-route --pen docs/design/architecture/baseline.pen --view modules | head -1`
  Expected: `const EDGES = [{"id":…` — the baseline Part 3 drew has routable arrows on `modules`.

- [ ] **Step 4: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(design): register design arch-route

  The command joins the design group, its catalog entry documents the
  save-before-routing rule for newly drawn arrows, and the capability index
  carries it.

  Noldor-Sibling-Scope: noldor:script-catalog
  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/cli/manifest.ts docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md AGENTS.md templates/AGENTS.md
  git commit -F "$msg"
  ```
