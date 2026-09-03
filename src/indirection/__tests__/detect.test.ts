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

  it('follows a tsconfig alias into the closure rather than reporting it unresolved', async () => {
    // The `typescript` package dependency-cruiser reads `paths` through is
    // capped at >=2 <6 and this repo is on 7, so its own tsconfig route leaves
    // the edge unresolved whether or not tsConfig is passed. The alias is fed
    // to enhanced-resolve instead, which consults no typescript install.
    const r = await measureIndirection(tree('alias'));
    expect(r.kind).toBe('measured');
    if (r.kind !== 'measured') return;
    expect(r.unresolvedInScope).toEqual([]);
    // Resolved is not enough — the point of resolving is that the edge counts.
    expect(r.modules.find((m) => m.source === 'root.ts')?.closure).toBe(1);
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
  it('resolves the alias and still never reports an unresolved bare package', async () => {
    // The earlier widening made "any tsconfig declares paths" enough, so an
    // uninstalled optional peer became fatal in every alias-using repo — the
    // exact hazard isInScopeSpecifier's contract rules out. That contract still
    // holds now that the alias itself resolves: the peer is the only unresolved
    // edge left in this tree, and it stays out of scope.
    const r = await measureIndirection(tree('alias-and-peer'));
    if (r.kind !== 'measured') throw new Error(r.kind);
    expect(r.unresolvedInScope).toEqual([]);
    expect(r.modules.find((m) => m.source === 'root.ts')?.closure).toBe(1);
  });

  it('reports nothing when the only unresolved import is a bare package', async () => {
    const r = await measureIndirection(tree('peer-only'));
    if (r.kind !== 'measured') throw new Error(r.kind);
    expect(r.unresolvedInScope).toEqual([]);
  });

  it('finds paths declared per package, not only at the base', async () => {
    const r = await measureIndirection(tree('monorepo'));
    if (r.kind !== 'measured') throw new Error(r.kind);
    expect(r.unresolvedInScope).toEqual([]);
    // A per-package `paths` block resolves against that package, not the base.
    expect(r.modules.find((m) => m.source === 'packages/pkg/src/root.ts')?.closure).toBe(1);
  });

  it('reports a prefix two packages claim differently rather than picking one', async () => {
    // `enhancedResolveOptions.alias` is one global map with no notion of which
    // package a specifier came from, and its array form is first-hit-wins — so
    // resolving this would attribute package a's import to whichever `thing.ts`
    // sorted first. A wrong edge moves the ratchet for a reason no reader can
    // reconstruct, so the prefix is dropped from the map and stays reported.
    const r = await measureIndirection(tree('alias-conflict'));
    if (r.kind !== 'measured') throw new Error(r.kind);
    expect(r.unresolvedInScope).toHaveLength(1);
    expect(r.unresolvedInScope[0]).toContain('@/thing');
    expect(r.modules.find((m) => m.source === 'packages/a/src/root.ts')?.closure).toBe(0);
  });

  it('resolves paths against a baseUrl inherited through extends, not the local dir', async () => {
    // The common monorepo shape: a root tsconfig.base.json declares
    // `baseUrl: "."` and packages/a extends it and declares `@/* -> src/*`.
    // TypeScript anchors that on the DECLARING config, so `@/thing` is the
    // repo-root `src/thing.ts` — and the tree contains a `packages/a/src/thing.ts`
    // too, so reading baseUrl only from the paths-declaring file would follow it.
    // That wrong hop is visible in the number: the package twin owns a further
    // import, so it would make root.ts's closure 2 instead of 1.
    const r = await measureIndirection(tree('alias-extends-baseurl'));
    if (r.kind !== 'measured') throw new Error(r.kind);
    expect(r.unresolvedInScope).toEqual([]);
    expect(r.modules.find((m) => m.source === 'packages/a/src/root.ts')?.closure).toBe(1);
  });

  it('anchors on the paths-declaring config when no baseUrl exists up the chain', async () => {
    // The shape that motivated this change: a Vite/shadcn app whose
    // tsconfig.app.json extends a root base config and declares `@/* -> ./src/*`,
    // with no `baseUrl` declared anywhere. TypeScript's 4.1+ default anchors that
    // on the file declaring `paths`, so it must land on apps/web/src — not on the
    // repo root, and not fail-safe to unresolved just because `extends` is present.
    const r = await measureIndirection(tree('alias-extends-no-baseurl'));
    if (r.kind !== 'measured') throw new Error(r.kind);
    expect(r.unresolvedInScope).toEqual([]);
    expect(r.modules.find((m) => m.source === 'apps/web/src/root.ts')?.closure).toBe(1);
  });

  it('reports rather than guesses when the extends chain cannot be followed', async () => {
    // A bare package specifier may itself declare the baseUrl that decides where
    // the targets land, and this walk does not resolve one. Guessing the local
    // directory would be the same wrong-edge hazard as above, so the prefix is
    // recorded with no target and its specifier stays reported.
    const r = await measureIndirection(tree('alias-extends-unfollowable'));
    if (r.kind !== 'measured') throw new Error(r.kind);
    expect(r.unresolvedInScope).toHaveLength(1);
    expect(r.unresolvedInScope[0]).toContain('@/thing');
  });

  it('reports an alias whose target directory does not exist', async () => {
    // The map is built from the declaration, not from the filesystem, so a
    // `paths` entry pointing at a directory nobody created still yields an
    // alias — and the edge under it must stay reported rather than vanish.
    const r = await measureIndirection(tree('alias-missing-target'));
    if (r.kind !== 'measured') throw new Error(r.kind);
    expect(r.unresolvedInScope).toHaveLength(1);
    expect(r.unresolvedInScope[0]).toContain('@gone/thing');
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

describe('tsconfig is parsed, not pattern-matched', () => {
  it('finds aliases in a single-line tsconfig', async () => {
    // The lazy regex had no `\n\s*}` to stop at here, so it learned nothing and
    // dropped the alias edge silently.
    const r = await measureIndirection(tree('tsc-oneline'));
    if (r.kind !== 'measured') throw new Error(r.kind);
    expect(r.unresolvedInScope).toEqual([]);
    // The specifier is `@/thing.js` against a `thing.ts` on disk, so this also
    // pins that the alias hop keeps the cruiser's .js -> .ts extension mapping.
    expect(r.modules.find((m) => m.source === 'src/a.ts')?.closure).toBe(1);
  });

  it('does not mistake a sibling compilerOption for an alias prefix', async () => {
    // With a one-line `paths` block the regex ran past it and harvested
    // `strict` as a prefix, so `import from 'strict'` hard-blocked a healthy repo.
    const r = await measureIndirection(tree('tsc-sibling'));
    if (r.kind !== 'measured') throw new Error(r.kind);
    expect(r.unresolvedInScope).toEqual([]);
  });

  it('reads a tsconfig carrying comments and a trailing comma', async () => {
    const r = await measureIndirection(tree('tsc-commented'));
    if (r.kind !== 'measured') throw new Error(r.kind);
    expect(r.unresolvedInScope).toEqual([]);
    // This tsconfig declares no `baseUrl`, so the target resolves against the
    // tsconfig's own directory — TypeScript's own 4.1+ rule.
    expect(r.modules.find((m) => m.source === 'a.ts')?.closure).toBe(1);
  });
});

describe('workspace boundaries', () => {
  it('counts a cross-package edge once without inheriting that package closure', async () => {
    const r = await measureIndirection(tree('workspace'));
    if (r.kind !== 'measured') throw new Error(r.kind);
    const a = r.modules.find((m) => m.source === 'packages/a/index.ts');
    // packages/b/index.ts is one fetch; b's own 7-module chain is not inherited.
    expect(a?.closure).toBe(1);
    const b = r.modules.find((m) => m.source === 'packages/b/index.ts');
    expect(b?.closure).toBe(6);
  });
});

describe('misconfigured scan roots refuse rather than measure nothing', () => {
  it('refuses when no configured root exists', async () => {
    const r = await measureIndirection({
      roots: ['sourse'],
      cwd: join(import.meta.dirname, 'trees', 'chain'),
    });
    expect(r.kind).toBe('unmeasurable');
    if (r.kind !== 'unmeasurable') return;
    expect(r.message).toContain('none of the configured scan root(s) exist');
  });

  it('refuses a parent-escaping relative root', async () => {
    const r = await measureIndirection({
      // `../tie` genuinely leaves the base; `../chain` would resolve back to it.
      roots: ['../tie'],
      cwd: join(import.meta.dirname, 'trees', 'chain'),
    });
    expect(r.kind).toBe('unmeasurable');
    if (r.kind !== 'unmeasurable') return;
    expect(r.message).toContain('repo-relative');
  });

  it('still skips a partial miss, since DEFAULT_SCAN_ROOTS is a union of layouts', async () => {
    const r = await measureIndirection({
      roots: ['.', 'apps', 'packages'],
      cwd: join(import.meta.dirname, 'trees', 'chain'),
    });
    expect(r.kind).toBe('measured');
  });
});
