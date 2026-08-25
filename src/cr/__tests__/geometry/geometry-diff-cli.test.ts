// @tests: ui-design-review-lane
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runGeometryDiff } from '../../geometry/geometry-diff-cli.js';

const write = async (dir: string, name: string, body: unknown): Promise<string> => {
  const p = join(dir, name);
  await writeFile(p, JSON.stringify(body), 'utf8');
  return p;
};

const doc = (nodes: unknown[]): unknown => ({
  surface: 'dashboard',
  viewport: { width: 1440, height: 900 },
  nodes,
});
const card = (x: number): unknown => ({ kind: 'shape', box: { x, y: 0, w: 100, h: 40 } });

describe('runGeometryDiff', () => {
  it('exits 0 and reports every family clean on identical documents', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'geo-diff-'));
    const a = await write(dir, 'design.json', doc([card(24)]));
    const b = await write(dir, 'impl.json', doc([card(24)]));
    const out: string[] = [];
    const code = await runGeometryDiff([a, b, '--surface', 'dashboard'], (s) => out.push(s));
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('edges: 0 unmatched');
  });

  it('exits 1 and names the unmatched value on drift', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'geo-diff-'));
    const a = await write(dir, 'design.json', doc([card(24)]));
    const b = await write(dir, 'impl.json', doc([card(24), card(30)]));
    const out: string[] = [];
    const code = await runGeometryDiff([a, b, '--surface', 'dashboard'], (s) => out.push(s));
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('impl-only');
  });

  it('exits 2 on an unparseable document', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'geo-diff-'));
    const a = await write(
      dir,
      'design.json',
      doc([{ kind: 'text', box: { x: 0, y: 0, w: 1, h: 1 } }]),
    );
    const b = await write(dir, 'impl.json', doc([card(24)]));
    const out: string[] = [];
    expect(await runGeometryDiff([a, b, '--surface', 'dashboard'], (s) => out.push(s))).toBe(2);
  });

  it('exits 2 on a missing path, a missing --surface, an unknown flag, and a value-less flag', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'geo-diff-'));
    const a = await write(dir, 'design.json', doc([card(24)]));
    const b = await write(dir, 'impl.json', doc([card(24)]));
    const out: string[] = [];
    expect(await runGeometryDiff([a, '--surface', 'dashboard'], (s) => out.push(s))).toBe(2);
    expect(await runGeometryDiff([a, b], (s) => out.push(s))).toBe(2);
    expect(
      await runGeometryDiff([a, b, '--surface', 'dashboard', '--zoom'], (s) => out.push(s)),
    ).toBe(2);
    expect(await runGeometryDiff([a, b, '--surface', '--zoom'], (s) => out.push(s))).toBe(2);
  });
});
