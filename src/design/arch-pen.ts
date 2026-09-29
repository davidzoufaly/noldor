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
  if (trimmed.startsWith('BASE:'))
    return namesSurface(trimmed.slice('BASE:'.length)) ? 'base' : null;
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
    for (const child of node.children ?? []) if (isPenNode(child)) walk(child, inner, innerWithin);
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
