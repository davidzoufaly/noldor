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
const node = (type: string, name: string, children: Node[] = []): Node => ({
  id: `n${++seq}`,
  type,
  name,
  children,
});

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
  await writeFile(
    join(root, 'src', 'a', 'x.ts'),
    "import { y } from '../b/y.js';\n\nexport const x = (): string => y();\n",
    'utf8',
  );
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
          children: [
            node('frame', 'context'),
            node('frame', 'containers'),
            node('frame', 'modules', children),
            node('frame', 'flows'),
          ],
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
    await writeBaseline(root, [
      node('frame', 'src/a'),
      node('frame', 'src/b'),
      node('path', 'src/a -> src/b'),
    ]);
    const r = await run(root);
    expect(r.code).toBe(0);
    expect(r.out).toContain('ok');
  });

  it('exits 1 and names an arrow the imports do not back', async () => {
    const root = await makeRepo();
    await writeBaseline(root, [
      node('frame', 'src/a'),
      node('frame', 'src/b'),
      node('path', 'src/b -> src/a'),
    ]);
    const r = await run(root);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/phantom-edge.*src\/b -> src\/a/);
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
