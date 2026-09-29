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
    const truth = {
      modules: INPUT.modules,
      pairs: new Set<string>(),
      edges: [],
      parts: new Set(['src/a/inner']),
    };
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

  it('leaves a non-number size the editor set alone', async () => {
    const root = await makeRepo();
    await run([], root);
    const file = join(root, BASELINE);
    const doc = JSON.parse(await readFile(file, 'utf8')) as { children: RawNode[] };
    const unplaced = doc.children[0]!.children!.find((n) => n.name === 'group: Unplaced')!;
    (unplaced as { height?: unknown }).height = 'fit_content';
    await writeFile(file, JSON.stringify(doc), 'utf8');
    await mkdir(join(root, 'src', 'c'), { recursive: true });
    await writeFile(join(root, 'src', 'c', 'w.ts'), 'export const w = 1;\n', 'utf8');
    expect((await run(['--refresh'], root)).code).toBe(0);
    const text = await readFile(file, 'utf8');
    expect(text).not.toContain('null');
    const after = JSON.parse(text) as { children: RawNode[] };
    expect(
      (
        after.children[0]!.children!.find((n) => n.name === 'group: Unplaced') as {
          height?: unknown;
        }
      ).height,
    ).toBe('fit_content');
  });

  it('exits 1 with no baseline to refresh', async () => {
    const root = await makeRepo();
    expect((await run(['--refresh'], root)).code).toBe(1);
  });
});
