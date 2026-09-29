// @tests: architecture-design-phase
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readArchPen, type ArchDoc } from '../arch-pen.js';
import { compareToTarget, main } from '../arch-progress.js';

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
const text = (...pages: Node[]): string => JSON.stringify({ version: '2.19', children: pages });
function doc(...pages: Node[]): ArchDoc {
  const read = readArchPen(text(...pages));
  if (!read.ok) throw new Error(read.error);
  return read.doc;
}

const BASELINE = [
  node('frame', 'architecture', [
    node('frame', 'external:git'),
    node('frame', 'src/a', [node('frame', 'src/a/inner')]),
    node('frame', 'src/b'),
    node('frame', 'src/old'),
    node('path', 'src/b -> src/a'),
  ]),
];
const TARGET = [
  node('frame', 'BASE:architecture: as-built'),
  node('frame', 'FINAL:architecture: add a queue', [
    node('frame', 'external: git'),
    node('frame', 'src/a', [node('frame', 'src/a/inner')]),
    node('frame', 'src/b'),
    node('frame', 'src/queue'),
    node('path', 'src/queue->src/a'),
  ]),
];

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('design arch-progress', () => {
  it('lists what the target adds, what it removes and what is done', () => {
    expect(compareToTarget(doc(...TARGET), doc(...BASELINE))).toEqual({
      toBuild: ['arrow: src/queue -> src/a', 'box: src/queue'],
      toRemove: ['arrow: src/b -> src/a', 'box: src/old'],
      done: ['box: external: git', 'box: src/a', 'box: src/a/inner', 'box: src/b'],
    });
  });

  it('reports nothing planned for a target with no FINAL: page', () => {
    expect(
      compareToTarget(doc(node('frame', 'BASE:architecture: as-built')), doc(...BASELINE)),
    ).toBeNull();
  });

  it('exits 0 with the report, 1 when the target is missing, 2 on a bad slug', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'arch-progress-'));
    dirs.push(cwd);
    mkdirSync(join(cwd, 'docs', 'design', 'architecture', 'milestones'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'design', 'architecture', 'baseline.pen'), text(...BASELINE));
    writeFileSync(
      join(cwd, 'docs', 'design', 'architecture', 'milestones', 'm1.pen'),
      text(...TARGET),
    );
    const out: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      out.push(a.join(' '));
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await main(['--milestone', 'm1'], cwd)).toBe(0);
      expect(out.join('\n')).toMatch(/to-build\s+box: src\/queue/);
      expect(await main(['--milestone', 'm2'], cwd)).toBe(1);
      expect(await main(['--milestone', 'Not A Slug'], cwd)).toBe(2);
      expect(await main([], cwd)).toBe(2);
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});
