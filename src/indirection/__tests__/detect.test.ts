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

describe('scan-root robustness', () => {
  it('skips a root that does not exist rather than failing the whole measurement', async () => {
    // DEFAULT_SCAN_ROOTS is ['packages','apps','scripts','src'] and repo-paths
    // documents that "roots that don't exist are ENOENT-skipped by every
    // walker" — a consumer that never sets scanPaths must not have every push
    // hard-blocked because `apps/` is absent.
    const r = await measureIndirection({
      roots: ['.', 'does-not-exist-anywhere'],
      cwd: join(import.meta.dirname, 'trees', 'chain'),
    });
    expect(r.kind).toBe('measured');
    if (r.kind !== 'measured') return;
    expect(r.modules.find((m) => m.source === 'a.ts')?.closure).toBe(3);
  });

  it('tolerates duplicate and overlapping roots without reporting an incomplete graph', async () => {
    // The candidate set dedupes while the raw enumeration does not, so a
    // repeated root must not trip the completeness comparison.
    const r = await measureIndirection({
      roots: ['.', '.'],
      cwd: join(import.meta.dirname, 'trees', 'chain'),
    });
    expect(r.kind).toBe('measured');
    if (r.kind !== 'measured') return;
    expect(r.modules).toHaveLength(4);
  });

  it('reports an unresolvable tsconfig alias instead of silently dropping the edge', async () => {
    // dependency-cruiser reads tsconfig `paths` through the `typescript`
    // package it accepts only at >=2 <6; this repo is on 7, so aliases cannot
    // be resolved and passing tsConfig does not help. Dropping the edge would
    // understate the ratchet, so the run reports it and check refuses.
    const r = await measureIndirection(tree('alias'));
    expect(r.kind).toBe('measured');
    if (r.kind !== 'measured') return;
    expect(r.unresolvedInScope).toHaveLength(1);
    expect(r.unresolvedInScope[0]).toContain('@lib/thing');
  });

  it('still ignores an unresolved bare package when no aliases are declared', async () => {
    const r = await measureIndirection(tree('unresolved'));
    expect(r.kind).toBe('measured');
    if (r.kind !== 'measured') return;
    // the relative one only — the bare specifier stays out of scope
    expect(r.unresolvedInScope).toHaveLength(1);
    expect(r.unresolvedInScope[0]).toContain('./does-not-exist.js');
  });
});

describe('alias namespace, not any-unresolved', () => {
  it('reports an unresolved alias but never an unresolved bare package', async () => {
    // The earlier widening made "any tsconfig declares paths" enough, so an
    // uninstalled optional peer became fatal in every alias-using repo — the
    // exact hazard isInScopeSpecifier's contract rules out.
    const r = await measureIndirection(tree('alias-and-peer'));
    if (r.kind !== 'measured') throw new Error(r.kind);
    expect(r.unresolvedInScope).toHaveLength(1);
    expect(r.unresolvedInScope[0]).toContain('@lib/thing');
    expect(r.unresolvedInScope.join()).not.toContain('some-optional-peer');
  });

  it('reports nothing when the only unresolved import is a bare package', async () => {
    const r = await measureIndirection(tree('peer-only'));
    if (r.kind !== 'measured') throw new Error(r.kind);
    expect(r.unresolvedInScope).toEqual([]);
  });

  it('finds paths declared per package, not only at the base', async () => {
    const r = await measureIndirection(tree('monorepo'));
    if (r.kind !== 'measured') throw new Error(r.kind);
    expect(r.unresolvedInScope).toHaveLength(1);
    expect(r.unresolvedInScope[0]).toContain('@pkg/thing');
  });
});

describe('corpus-rule agreement', () => {
  it('keeps a directory whose name merely contains an excluded segment', async () => {
    // walkCodeFiles excludes on an EXACT directory name, so an unanchored cruise
    // exclude made the two corpus rules disagree and tripped the completeness
    // guard on a healthy repo.
    const r = await measureIndirection(tree('near-miss'));
    expect(r.kind).toBe('measured');
    if (r.kind !== 'measured') return;
    expect(r.modules.map((m) => m.source).sort()).toEqual(['__tests__helpers/h.ts', 'a.ts']);
  });

  it('refuses an absolute scan root instead of silently measuring nothing', async () => {
    // join() and resolve() disagree for an absolute root, which used to yield
    // `empty` — so `baseline` recorded 0 and the gate disabled itself forever.
    const r = await measureIndirection({
      roots: [join(import.meta.dirname, 'trees', 'chain')],
      cwd: join(import.meta.dirname, 'trees', 'chain'),
    });
    expect(r.kind).toBe('unmeasurable');
    if (r.kind !== 'unmeasurable') return;
    expect(r.message).toContain('repo-relative');
  });
});
