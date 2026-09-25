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
export function routeEdges(
  doc: ArchDoc,
  view?: ArchitecturePageId,
): { edges: RouteEdge[]; unresolved: string[] } {
  const edges: RouteEdge[] = [];
  const unresolved: string[] = [];
  for (const page of doc.pages) {
    if (view !== undefined && page.view !== view) continue;
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
  for (const name of unresolved)
    console.error(`${label}: not routed, an end does not resolve: ${name}`);
  if (edges.length === 0) {
    console.error(`${label}: no arrow to route`);
    return 1;
  }
  console.log(renderRouteSnippet(edges));
  return 0;
}

runIfDirect('arch-route', 'design arch-route', async (argv) => main(argv));
