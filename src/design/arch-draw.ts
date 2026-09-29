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
import { EXCLUDED_DIRS, listModuleDirs } from '../docs/docs-architecture.js';
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
