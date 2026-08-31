// @tests: abstraction-cost-ratchet
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { measureIndirection } from '../detect.js';
import { parseIndirectionArgs, renderReport, runIndirection } from '../indirection-cli.js';

const treeDir = (name: string): string => join(import.meta.dirname, 'trees', name);

/** Capture stdout for one call. */
async function capture(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const chunks: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((s: string) => {
    chunks.push(s);
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: await fn(), out: chunks.join('') };
  } finally {
    process.stdout.write = write;
  }
}

describe('parseIndirectionArgs', () => {
  it('rejects an unknown subcommand', () => {
    expect(() => parseIndirectionArgs(['wat'])).toThrow(/usage: noldor indirection/);
  });

  it('rejects an unknown flag', () => {
    expect(() => parseIndirectionArgs(['report', '--nope'])).toThrow(/unknown flag/);
  });

  it('accepts report with --json', () => {
    expect(parseIndirectionArgs(['report', '--json'])).toEqual({ sub: 'report', json: true });
  });
});

describe('renderReport', () => {
  it('names the excess sum, the percentiles and every flagged row', async () => {
    const r = await measureIndirection({ roots: ['.'], cwd: treeDir('chain'), threshold: 2 });
    if (r.kind !== 'measured') throw new Error(r.kind);
    const text = renderReport(r);
    expect(text).toContain('excess sum: 1');
    expect(text).toContain('p50=1');
    expect(text).toContain('max=3');
    expect(text).toContain('a.ts');
    expect(text).toContain('closure=3');
  });

  it('says so plainly when the corpus is empty', async () => {
    const r = await measureIndirection({ roots: ['.'], cwd: treeDir('empty') });
    expect(renderReport(r)).toContain('no source files');
  });

  it('lists unresolved in-scope imports and not bare ones', async () => {
    const r = await measureIndirection({ roots: ['.'], cwd: treeDir('unresolved') });
    if (r.kind !== 'measured') throw new Error(r.kind);
    expect(r.unresolvedInScope).toHaveLength(1);
    const text = renderReport(r);
    expect(text).toContain('./does-not-exist.js');
    expect(text).toContain('understated');
    expect(text).not.toContain('no-such-package-anywhere');
  });

  it('renders the failure kinds, so their branches are reachable from a caller', async () => {
    const r = await measureIndirection({
      roots: ['.'],
      cwd: treeDir('chain'),
      extensions: [{ extension: '.ts', available: false }],
    });
    expect(r.kind).toBe('no-parser');
    expect(renderReport(r)).toContain('@swc/core');
  });
});

describe('runIndirection report', () => {
  it('exits 0 on a measurable tree', async () => {
    expect(await runIndirection(['report'], treeDir('chain'))).toBe(0);
  });

  it('exits 0 on an empty tree', async () => {
    expect(await runIndirection(['report'], treeDir('empty'))).toBe(0);
  });

  it('exits 3 on a usage error', async () => {
    expect(await runIndirection(['nope'], treeDir('chain'))).toBe(3);
  });

  it('exits 0 on an unresolved in-scope import, reporting rather than refusing', async () => {
    expect(await runIndirection(['report'], treeDir('unresolved'))).toBe(0);
  });

  it('--json emits a parseable payload carrying the ratchet number', async () => {
    const { code, out } = await capture(() =>
      runIndirection(['report', '--json'], treeDir('chain')),
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out) as { kind: string; excessSum: number };
    expect(parsed.kind).toBe('measured');
    expect(parsed.excessSum).toBe(0);
  });

  it('emits byte-identical output across two runs on an unchanged tree', async () => {
    const a = await capture(() => runIndirection(['report'], treeDir('chain')));
    const b = await capture(() => runIndirection(['report'], treeDir('chain')));
    expect(a.out).toBe(b.out);
  });
});
