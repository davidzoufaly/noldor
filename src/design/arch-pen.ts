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
      if (hits.length !== 1 || hit === undefined)
        return { kind: 'unresolved', text, matches: hits.length };
      const refs = [...new Set(hit.boxIds.flatMap((id) => byId.get(id)?.refs ?? []))].sort();
      return { kind: 'group', text, id: hit.id, refs };
    }
    const hits = boxes.filter((box) => box.name === text || box.refs.includes(text));
    const [hit] = hits;
    if (hits.length !== 1 || hit === undefined)
      return { kind: 'unresolved', text, matches: hits.length };
    return { kind: 'box', text, id: hit.id, refs: hit.name === text ? hit.refs : [text] };
  };

  const arrows: ArchArrow[] = [];
  for (const path of paths) {
    const ends = arrowEndsOf(path.name);
    if (ends !== null)
      arrows.push({ id: path.id, name: path.name, from: resolve(ends.from), to: resolve(ends.to) });
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
  const children =
    typeof doc === 'object' && doc !== null ? (doc as { children?: unknown }).children : undefined;
  if (!Array.isArray(children))
    return { ok: false, error: 'no top-level children array — not a .pen document' };
  const pages: ArchPage[] = [];
  for (const child of children) {
    if (!isPenNode(child)) continue;
    const role = pageRoleOf(child.name ?? '');
    if (role !== null) pages.push(readPage(child, role.view, role.role));
  }
  return { ok: true, doc: { pages } };
}
