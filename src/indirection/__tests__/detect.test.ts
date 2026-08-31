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

describe('edge semantics', () => {
  it('counts type-only and literal dynamic edges, skips tests and declarations', async () => {
    const r = await measureIndirection(tree('edges'));
    if (r.kind !== 'measured') throw new Error(r.kind);
    expect(r.modules.map((m) => m.source).sort()).toEqual([
      'dyn.ts',
      'leaf.ts',
      'root.ts',
      'typed.ts',
    ]);
    // typed.ts (import type) + leaf.ts (static) + dyn.ts (literal dynamic import)
    expect(r.modules.find((m) => m.source === 'root.ts')?.closure).toBe(3);
  });
});

describe('cycles', () => {
  it('counts every member of a cycle once, and never the module itself', async () => {
    const r = await measureIndirection(tree('cycle'));
    if (r.kind !== 'measured') throw new Error(r.kind);
    // x -> y -> x: each reaches exactly the other, and `seen.delete(id)` is what
    // keeps a module out of its own closure when the cycle returns to it.
    expect(r.modules.find((m) => m.source === 'x.ts')?.closure).toBe(1);
    expect(r.modules.find((m) => m.source === 'y.ts')?.closure).toBe(1);
    expect(r.modules.find((m) => m.source === 'self.ts')?.closure).toBe(0);
  });
});

describe('deterministic ordering', () => {
  it('breaks a closure tie by path ascending', async () => {
    // The chain fixture cannot prove this — every closure there differs, so
    // reversing or deleting the tiebreak would not change its order.
    const r = await measureIndirection(tree('tie'));
    if (r.kind !== 'measured') throw new Error(r.kind);
    const tied = r.modules.filter((m) => m.closure === 1).map((m) => m.source);
    expect(tied).toEqual(['p.ts', 'q.ts']);
  });
});

describe('failure contract', () => {
  it('returns no-parser — not a throw — when no TypeScript parser is available', async () => {
    const r = await measureIndirection({
      ...tree('chain'),
      extensions: [
        { extension: '.ts', available: false },
        { extension: '.tsx', available: false },
      ],
    });
    expect(r.kind).toBe('no-parser');
    if (r.kind !== 'no-parser') return;
    expect(r.extensions).toContain('.ts');
    expect(r.message).toContain('@swc/core');
  });
});

describe('deep aggregator', () => {
  it('flags an aggregator above the threshold while its 32 leaf members stay at zero', async () => {
    const r = await measureIndirection(tree('deep-registry'));
    if (r.kind !== 'measured') throw new Error(r.kind);
    const agg = r.modules.find((m) => m.source === 'aggregator.ts');
    expect(agg?.closure).toBe(32);
    expect(agg?.excess).toBe(32 - INDIRECTION_CLOSURE_THRESHOLD);
    // Registry immunity is conditional: the 32 leaf members cost nothing, the
    // aggregator does once its own closure passes the threshold.
    expect(r.modules.find((m) => m.source === 'dep1.ts')?.excess).toBe(0);
    // member.ts is NOT a cost-free member — it imports the aggregator, so it
    // inherits the whole closure (32 deps + the aggregator) and is itself deep.
    const mem = r.modules.find((m) => m.source === 'member.ts');
    expect(mem?.closure).toBe(33);
    expect(mem?.excess).toBe(33 - INDIRECTION_CLOSURE_THRESHOLD);
  });
});
