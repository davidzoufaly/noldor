// @tests: ui-design-review-lane
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runGeometryValidate } from '../../geometry/geometry-validate-cli.js';

const write = async (name: string, body: unknown): Promise<string> => {
  const p = join(await mkdtemp(join(tmpdir(), 'geo-val-')), name);
  await writeFile(p, JSON.stringify(body), 'utf8');
  return p;
};

const doc = (nodes: unknown[]): unknown => ({
  surface: 'dashboard',
  viewport: { width: 1440, height: 900 },
  nodes,
});

describe('runGeometryValidate', () => {
  it('exits 0 and reports the node count on a conformant document', async () => {
    const p = await write('impl.json', doc([{ kind: 'shape', box: { x: 0, y: 0, w: 10, h: 10 } }]));
    const out: string[] = [];
    const code = await runGeometryValidate([p, '--side', 'impl', '--surface', 'dashboard'], (s) =>
      out.push(s),
    );
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('1 node');
  });

  it('exits 1 and names the violation on a non-conformant document', async () => {
    const p = await write('impl.json', doc([{ kind: 'text', box: { x: 0, y: 0, w: 1, h: 1 } }]));
    const out: string[] = [];
    const code = await runGeometryValidate([p, '--side', 'impl', '--surface', 'dashboard'], (s) =>
      out.push(s),
    );
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('fontSize');
  });

  it('exits 1 when the surface does not match', async () => {
    const p = await write('impl.json', doc([{ kind: 'shape', box: { x: 0, y: 0, w: 1, h: 1 } }]));
    const out: string[] = [];
    expect(
      await runGeometryValidate([p, '--side', 'impl', '--surface', 'settings'], (s) => out.push(s)),
    ).toBe(1);
  });

  it('exits 2 on a bad side, a missing --surface, an unknown flag, and no path', async () => {
    const p = await write('impl.json', doc([]));
    const out: string[] = [];
    expect(
      await runGeometryValidate([p, '--side', 'nonsense', '--surface', 'x'], (s) => out.push(s)),
    ).toBe(2);
    expect(await runGeometryValidate([p, '--side', 'impl'], (s) => out.push(s))).toBe(2);
    expect(
      await runGeometryValidate([p, '--side', 'impl', '--surface', 'x', '--zoom'], (s) =>
        out.push(s),
      ),
    ).toBe(2);
    expect(
      await runGeometryValidate(['--side', 'impl', '--surface', 'x'], (s) => out.push(s)),
    ).toBe(2);
  });

  it('does not mistake a path whose text equals a flag value for that value', async () => {
    // The positional is string-equal to the --surface value, which is what the
    // old by-value filter dropped; index-based filtering keeps it.
    const dir = await mkdtemp(join(tmpdir(), 'geo-val-'));
    const rel = 'surface-doc';
    await writeFile(
      join(dir, rel),
      JSON.stringify({
        surface: rel,
        viewport: { width: 10, height: 10 },
        nodes: [{ kind: 'shape', box: { x: 0, y: 0, w: 1, h: 1 } }],
      }),
      'utf8',
    );
    const out: string[] = [];
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      expect(
        await runGeometryValidate([rel, '--side', 'impl', '--surface', rel], (s) => out.push(s)),
      ).toBe(0);
    } finally {
      process.chdir(cwd);
    }
  });

  it('exits 2 on malformed JSON and on a value-less flag that would swallow the next', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'geo-val-'));
    const bad = join(dir, 'bad.json');
    await writeFile(bad, '{not json', 'utf8');
    const out: string[] = [];
    expect(
      await runGeometryValidate([bad, '--side', 'impl', '--surface', 'x'], (s) => out.push(s)),
    ).toBe(2);
    const good = await write('ok.json', doc([]));
    expect(
      await runGeometryValidate([good, '--side', 'impl', '--surface', '--zoom'], (s) =>
        out.push(s),
      ),
    ).toBe(2);
  });
});
