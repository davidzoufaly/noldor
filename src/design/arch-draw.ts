// @fd: architecture-design-phase
// `noldor design arch-draw [--refresh]` — the first architecture canvas, drawn
// from the code, and new modules added to it later (spec: "Draw command").
// Every module lands in `group: Unplaced` with its non-test sub-folders as
// parts, beside one placeholder per outer layer. No arrow is drawn: every
// import at once is a hairball, and the check's `undrawn-edge` advisories list
// them instead. `--refresh` never moves, resizes or renames a box already
// there, so the hand layout survives. Placing, grouping and arrows are the
// operator's canvas work — docs/noldor/architecture-canvas.md.

import { mkdirSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { atomicWriteFileSync, writeFileSyncIfAbsent } from '../core/atomic-write.js';
import { runIfDirect } from '../core/cli-entry.js';
import { ARCH_BASELINE_PATH } from '../core/design-artifact-names.js';
import { readRepoText } from '../core/read-text.js';
import { EXCLUDED_DIRS, listModuleDirs } from '../docs/docs-architecture.js';
import { ARCH_PAGE, canonicalName, readArchPen } from './arch-pen.js';

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
  /** A number when this file wrote it; pen also allows `fit_content`, `fill_container` or a `$variable`. */
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
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
    y += Math.max(...row.map((box) => num(box.height) ?? 0)) + PAD;
  }
}

/** A measurable position or size, or `undefined` for a non-number one (`fit_content`, a `$variable`). */
function num(value: number | string | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** The far edge of `start + size` over `nodes`, skipping a node whose size cannot be measured; 0 for none. */
function farEdge(
  nodes: readonly PenNode[],
  start: (n: PenNode) => number | string | undefined,
  size: (n: PenNode) => number | string | undefined,
): number {
  const edges = nodes.flatMap((n) => {
    const extent = num(size(n));
    return extent === undefined ? [] : [(num(start(n)) ?? 0) + extent];
  });
  return Math.max(0, ...edges);
}

/** The lowest edge among `nodes`, 0 for none. */
function bottomOf(nodes: readonly PenNode[]): number {
  return farEdge(
    nodes,
    (n) => n.y,
    (n) => n.height,
  );
}

/**
 * Grow `frame` to hold every child plus `margin`; never shrink it, so a
 * hand-sized frame keeps its size. A non-number width or height is the
 * editor's own sizing rule and is left alone.
 */
function fitFrame(frame: PenNode, margin: number): void {
  const kids = frame.children ?? [];
  if (frame.width === undefined || typeof frame.width === 'number')
    frame.width = Math.max(
      frame.width ?? 0,
      farEdge(
        kids,
        (c) => c.x,
        (c) => c.width,
      ) + margin,
    );
  if (frame.height === undefined || typeof frame.height === 'number')
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
  const left = (num(unplaced.x) ?? 0) + (num(unplaced.width) ?? 0) + 80;
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
    const right = farEdge(
      kids,
      (n) => n.x,
      (n) => n.width,
    );
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

/** A module's direct sub-folders as part paths — test, hidden, `_` and `listModuleDirs`-excluded folders skipped — sorted. */
export async function listPartDirs(cwd: string, mod: string): Promise<string[]> {
  try {
    const entries = await readdir(join(cwd, mod), { withFileTypes: true });
    return entries
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.name.startsWith('.') &&
          !e.name.startsWith('_') &&
          !EXCLUDED_DIRS.has(e.name) &&
          !TEST_DIRS.has(e.name),
      )
      .map((e) => `${mod}/${e.name}`)
      .sort();
  } catch (err) {
    // A module with no readable folder has no parts; any other error is real and surfaces.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw err;
  }
}

async function readInput(cwd: string): Promise<DrawInput> {
  const modules = await listModuleDirs(cwd);
  const parts = new Map<string, readonly string[]>();
  // A sub-folder that is itself a module (nested scan roots) is boxed as a module, never as a part too.
  const known = new Set(modules);
  for (const mod of modules)
    parts.set(
      mod,
      (await listPartDirs(cwd, mod)).filter((part) => !known.has(part)),
    );
  return { modules, parts };
}

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

runIfDirect('arch-draw', 'design arch-draw', async (argv) => main(argv));
