// @tests: abstraction-cost-ratchet
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { INDIRECTION_CLOSURE_THRESHOLD, measureIndirection } from '../detect.js';

/** Roots are relative to `cwd` — cruise joins them onto `baseDir`. */
const tree = (name: string): { roots: string[]; cwd: string } => ({
  roots: ['.'],
  cwd: join(import.meta.dirname, 'trees', name),
});

describe('measureIndirection', () => {
  it('counts the transitive in-repo closure, excluding the module itself', async () => {
    const r = await measureIndirection(tree('chain'));
    expect(r.kind).toBe('measured');
    if (r.kind !== 'measured') return;
    const closures = new Map(r.modules.map((m) => [m.source, m.closure]));
    expect(closures.get('a.ts')).toBe(3);
    expect(closures.get('b.ts')).toBe(2);
    expect(closures.get('c.ts')).toBe(1);
    expect(closures.get('d.ts')).toBe(0);
    expect(r.excessSum).toBe(0);
  });

  it('keeps a shallow registry aggregator under the threshold, so members cost nothing', async () => {
    const r = await measureIndirection(tree('shallow-registry'));
    expect(r.kind).toBe('measured');
    if (r.kind !== 'measured') return;
    expect(r.modules.find((m) => m.source === 'registry.ts')?.closure).toBe(3);
    expect(r.excessSum).toBe(0);
    expect(r.flagged).toEqual([]);
  });

  it('reports an empty scan root as empty', async () => {
    expect((await measureIndirection(tree('empty'))).kind).toBe('empty');
  });

  it('reports a tests-only tree as empty rather than unmeasurable', async () => {
    // A legitimately excluded corpus is not a broken parse. Counting tests in
    // the pre-scan would call this tree non-empty, and the cruise — which
    // excludes them — would then report it unmeasurable.
    expect((await measureIndirection(tree('tests-only'))).kind).toBe('empty');
  });

  it('retains the threshold it measured against', async () => {
    const r = await measureIndirection({ ...tree('chain'), threshold: 2 });
    expect(r.kind).toBe('measured');
    if (r.kind !== 'measured') return;
    expect(r.threshold).toBe(2);
    expect(r.modules.find((m) => m.source === 'a.ts')?.excess).toBe(1);
    expect(r.modules.find((m) => m.source === 'b.ts')?.excess).toBe(0);
    expect(r.excessSum).toBe(1);
  });

  it('boundary: a closure exactly at the threshold is not flagged, one above is', async () => {
    const at = await measureIndirection({ ...tree('chain'), threshold: 3 });
    const above = await measureIndirection({ ...tree('chain'), threshold: 2 });
    expect(at.kind === 'measured' && at.flagged.length).toBe(0);
    expect(above.kind === 'measured' && above.flagged.length).toBe(1);
  });

  it('orders modules by closure descending, path ascending as tiebreak', async () => {
    const r = await measureIndirection(tree('chain'));
    if (r.kind !== 'measured') throw new Error(r.kind);
    expect(r.modules.map((m) => m.source)).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts']);
  });

  it('computes nearest-rank percentiles over the closure vector', async () => {
    const r = await measureIndirection(tree('chain'));
    if (r.kind !== 'measured') throw new Error(r.kind);
    // closures ascending: [0, 1, 2, 3]
    expect(r.percentiles).toEqual({ p50: 1, p75: 2, p90: 3, p99: 3, max: 3 });
  });

  it('exposes the threshold constant the gate ships with', () => {
    expect(INDIRECTION_CLOSURE_THRESHOLD).toBe(30);
  });
});
