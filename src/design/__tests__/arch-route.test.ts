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
function runSnippet(source: string): {
  updates: Map<string, Record<string, unknown>>;
  printed: string[];
} {
  const updates = new Map<string, Record<string, unknown>>();
  const printed: string[] = [];
  const find = (id: string, n: Node): Node | undefined =>
    n.id === id ? n : (n.children ?? []).map((c) => find(id, c)).find((hit) => hit !== undefined);
  const Get = (id: string, visit: (n: Node, ctx: unknown) => unknown): void => {
    const walk = (n: Node, parentCtx: unknown): void => {
      const ctx = {
        node: n,
        parentCtx,
        bounds: { x: n.x ?? 0, y: n.y ?? 0, width: n.width ?? 0, height: n.height ?? 0 },
      };
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

function onBorder(
  p: { x: number; y: number },
  r: { x: number; y: number; w: number; h: number },
): boolean {
  const e = 0.2;
  const within = p.x >= r.x - e && p.x <= r.x + r.w + e && p.y >= r.y - e && p.y <= r.y + r.h + e;
  const onEdge =
    Math.abs(p.x - r.x) < e ||
    Math.abs(p.x - (r.x + r.w)) < e ||
    Math.abs(p.y - r.y) < e ||
    Math.abs(p.y - (r.y + r.h)) < e;
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
    const [x1, y1, x2, y2] =
      String(updates.get('E')?.geometry)
        .match(/-?\d+(\.\d+)?/g)
        ?.slice(0, 4)
        .map(Number) ?? [];
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
