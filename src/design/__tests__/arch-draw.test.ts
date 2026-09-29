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
