// @tests: graphify-plan-of-edges-nodes-for-plans-specs
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GitOutcome, RunGit } from '../../core/branch-added.js';
import { graphContext, GRAPH_JSON, SUMMARY_TOON } from '../graph-context.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'graph-context-'));
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  mkdirSync(join(dir, 'graphify-out'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
  // `scanPaths: []` so `scanRoots()` falls back to DEFAULT_SCAN_ROOTS, of which
  // only `src` exists here — which is also the shape a fresh consumer has.
  writeFileSync(
    join(dir, '.noldor', 'config.json'),
    JSON.stringify({
      consumer: {
        name: 'fixture',
        repoUrl: 'https://example.com/x/y',
        lockstepPackages: ['package.json'],
        scanPaths: [],
        boundaries: [],
        deprecatedPackages: [],
        e2ePrefix: '',
        samplesPath: '',
        packagePrefix: '',
        pnpmStderrPrefix: '',
        appPathPrefix: '',
      },
    }),
    'utf8',
  );
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const OK: GitOutcome = { status: 0, stdout: '', stderr: '' };
const FAIL: GitOutcome = { status: 1, stdout: '', stderr: '' };

/**
 * A git stub answering only what this module asks. `tracked` drives
 * `ls-files --error-unmatch`; `dirty` drives the committed leg's content guard.
 */
function git2(opts: { tracked?: boolean; dirty?: boolean } = {}): RunGit {
  return (args) => {
    if (args[0] === 'ls-files') return opts.tracked === true ? OK : FAIL;
    if (args[0] === 'status') {
      return opts.dirty === true ? { status: 0, stdout: ' M graph.json', stderr: '' } : OK;
    }
    // `evaluateGraphFreshness` shells `git log` itself and is not stubbed here;
    // in a tmpdir with no repo it reports `skipped`, which fails the committed
    // leg — so these tests exercise the working-tree leg deliberately.
    return OK;
  };
}

/** A minimal graphify payload: one file node, one symbol it contains. */
function graph(): unknown {
  return {
    directed: false,
    nodes: [
      {
        id: 'src_a_ts',
        label: 'a.ts',
        source_file: 'src/a.ts',
        source_location: 'L1',
        community: 1,
      },
      {
        id: 'src_b_ts',
        label: 'b.ts',
        source_file: 'src/b.ts',
        source_location: 'L1',
        community: 1,
      },
      {
        id: 'src_c_ts',
        label: 'c.ts',
        source_file: 'src/c.ts',
        source_location: 'L1',
        community: 2,
      },
      // Community 3 deliberately: a symbol clustered AWAY from its own file is
      // the only case where the containment-exclusion rule is load-bearing.
      { id: 'godFn', label: 'godFn()', source_location: 'L4', community: 3 },
    ],
    links: [
      { source: 'src_a_ts', target: 'godFn', relation: 'contains' },
      { source: 'src_a_ts', target: 'src_c_ts', relation: 'imports_from' },
      { source: 'godFn', target: 'src_b_ts', relation: 'calls' },
      { source: 'godFn', target: 'src_c_ts', relation: 'calls' },
    ],
  };
}

/** Write the graph, then make it the newest thing on disk (a regeneration). */
function writeFreshGraph(payload: unknown = graph()): void {
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
  writeFileSync(join(dir, GRAPH_JSON), JSON.stringify(payload), 'utf8');
  const past = new Date(Date.now() - 60_000);
  utimesSync(join(dir, 'src', 'a.ts'), past, past);
}

/**
 * Real git, real commits — the committed leg is `evaluateGraphFreshness` (which
 * shells `git log`) plus a `git status --porcelain` content guard, and neither
 * can be exercised through the `RunGit` fake alone. The suite was green with the
 * whole leg stubbed out before these cases existed.
 */
function git(repo: string, args: string[], at?: string): string {
  const r = spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env:
      at === undefined
        ? process.env
        : { ...process.env, GIT_COMMITTER_DATE: at, GIT_AUTHOR_DATE: at },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/**
 * Commit timestamps are pinned because `evaluateGraphFreshness` compares
 * `git log --format=%ct`, which has ONE-SECOND resolution: three commits made in
 * the same second compare equal, and the gate reads equal as fresh. Relying on
 * wall-clock ordering here makes the test pass or fail on machine speed.
 */
const T_SOURCE = '2026-08-01T00:00:00Z';
const T_GRAPH = '2026-08-02T00:00:00Z';
const T_LATER_SOURCE = '2026-08-03T00:00:00Z';

/** A repo whose committed graph postdates every committed source file. */
function committedRepo(): void {
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'T']);
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'source'], T_SOURCE);
  writeFileSync(join(dir, GRAPH_JSON), JSON.stringify(graph()), 'utf8');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'graph'], T_GRAPH);
}

describe('graphContext committed leg (real git)', () => {
  it('passes when the committed graph postdates the latest source commit', async () => {
    committedRepo();
    // Backdate the graph on disk so the working-tree leg CANNOT pass — the only
    // way to `fresh` here is the committed leg.
    const past = new Date(Date.now() - 600_000);
    utimesSync(join(dir, GRAPH_JSON), past, past);
    const r = await graphContext({ cwd: dir, paths: [] });
    expect(r.status).toBe('fresh');
    expect(r.detail).toContain('committed graph postdates');
  });

  it('refuses when the on-disk graph differs from its committed content', async () => {
    committedRepo();
    const past = new Date(Date.now() - 600_000);
    // Same modification the guard exists to catch: content swapped, mtime old,
    // so neither leg may pass.
    writeFileSync(join(dir, GRAPH_JSON), JSON.stringify({ nodes: [], links: [] }), 'utf8');
    utimesSync(join(dir, GRAPH_JSON), past, past);
    const r = await graphContext({ cwd: dir, paths: [] });
    expect(r.status).toBe('stale');
    expect(r.detail).toContain('differs from its committed content');
  });

  it('refuses an untracked graph, which git diff would have called clean', async () => {
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 't@example.com']);
    git(dir, ['config', 'user.name', 'T']);
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'source'], T_SOURCE);
    // Never added: `git diff --quiet HEAD -- <untracked>` exits 0, which is why
    // the guard uses `status --porcelain` instead.
    writeFileSync(join(dir, GRAPH_JSON), JSON.stringify(graph()), 'utf8');
    const past = new Date(Date.now() - 600_000);
    utimesSync(join(dir, GRAPH_JSON), past, past);
    const r = await graphContext({ cwd: dir, paths: [] });
    expect(r.status).toBe('stale');
  });

  it('is stale when source was committed after the graph', async () => {
    committedRepo();
    writeFileSync(join(dir, 'src', 'b.ts'), 'export const b = 2;\n', 'utf8');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'later source'], T_LATER_SOURCE);
    const past = new Date(Date.now() - 600_000);
    utimesSync(join(dir, GRAPH_JSON), past, past);
    const r = await graphContext({ cwd: dir, paths: [] });
    expect(r.status).toBe('stale');
  });
});

describe('graphContext presence', () => {
  it('skips when the graph is neither on disk nor tracked', async () => {
    const r = await graphContext({ cwd: dir, paths: [], runGit: git2({ tracked: false }) });
    expect(r.status).toBe('skipped');
    expect(r.digests).toEqual([]);
  });

  it('does not skip a tracked graph that is merely absent from disk', async () => {
    const r = await graphContext({ cwd: dir, paths: [], runGit: git2({ tracked: true }) });
    expect(r.status).toBe('stale');
    expect(r.detail).toContain('cannot be read');
  });
});

describe('graphContext parse precedence', () => {
  it('reports stale for unparseable JSON even when a freshness leg would pass', async () => {
    writeFileSync(join(dir, GRAPH_JSON), '{ not json', 'utf8');
    const r = await graphContext({ cwd: dir, paths: [], runGit: git2({ tracked: true }) });
    expect(r.status).toBe('stale');
    expect(r.detail).toContain('does not parse');
  });

  it('reports stale for JSON without nodes/links arrays', async () => {
    writeFileSync(join(dir, GRAPH_JSON), JSON.stringify({ hello: 'world' }), 'utf8');
    const r = await graphContext({ cwd: dir, paths: [], runGit: git2({ tracked: true }) });
    expect(r.status).toBe('stale');
    expect(r.detail).toContain('not a graphify graph');
  });

  it('reports stale for JSON that is valid but not an object', async () => {
    writeFileSync(join(dir, GRAPH_JSON), 'null', 'utf8');
    const r = await graphContext({ cwd: dir, paths: [], runGit: git2({ tracked: true }) });
    expect(r.status).toBe('stale');
    expect(r.detail).toContain('not a JSON object');
  });

  it('drops a link naming a node nobody emitted, so degree cannot be skewed', async () => {
    const payload = graph() as { nodes: unknown[]; links: unknown[] };
    payload.links.push({ source: 'src_a_ts', target: 'ghost', relation: 'calls' });
    writeFreshGraph(payload);
    const r = await graphContext({
      cwd: dir,
      paths: ['src/a.ts'],
      runGit: git2({ tracked: true }),
    });
    expect(r.detail).toContain('1 malformed rows dropped');
  });

  it('does not let a duplicated edge row inflate a degree rank', async () => {
    const payload = graph() as { nodes: unknown[]; links: unknown[] };
    // Same pair + relation three times over.
    payload.links.push({ source: 'godFn', target: 'src_b_ts', relation: 'calls' });
    payload.links.push({ source: 'godFn', target: 'src_b_ts', relation: 'calls' });
    writeFreshGraph(payload);
    const r = await graphContext({
      cwd: dir,
      paths: ['src/a.ts'],
      runGit: git2({ tracked: true }),
    });
    // Unchanged from the un-duplicated fixture: 3 distinct incident pairs.
    expect(r.digests[0]!.topDegreeSymbols).toEqual([{ label: 'godFn()', degree: 3, rank: 1 }]);
  });

  it('drops malformed rows instead of failing the verdict, and counts them', async () => {
    const payload = graph() as { nodes: unknown[]; links: unknown[] };
    payload.nodes.push({ label: 'no id' });
    payload.links.push({ source: 'src_a_ts' });
    writeFreshGraph(payload);
    const r = await graphContext({ cwd: dir, paths: [], runGit: git2({ tracked: true }) });
    expect(r.status).toBe('fresh');
    expect(r.detail).toContain('2 malformed rows dropped');
  });
});

describe('graphContext freshness', () => {
  it('passes on the working-tree leg when the graph outranks every source file', async () => {
    writeFreshGraph();
    const r = await graphContext({ cwd: dir, paths: [], runGit: git2({ tracked: true }) });
    expect(r.status).toBe('fresh');
    expect(r.detail).toContain('regenerated in the working tree');
  });

  it('is stale when a source file is newer than the graph', async () => {
    writeFreshGraph();
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(dir, 'src', 'a.ts'), future, future);
    const r = await graphContext({ cwd: dir, paths: [], runGit: git2({ tracked: true }) });
    expect(r.status).toBe('stale');
    expect(r.detail).toContain('Run /graphify --ast-only');
  });

  it('reports the toon unusable when it is missing, without demoting the verdict', async () => {
    writeFreshGraph();
    const r = await graphContext({ cwd: dir, paths: [], runGit: git2({ tracked: true }) });
    expect(r.status).toBe('fresh');
    expect(r.summaryToon).toEqual({ path: SUMMARY_TOON, usable: false });
  });

  it('reports the toon usable when it is at least as new as the graph', async () => {
    writeFreshGraph();
    writeFileSync(join(dir, SUMMARY_TOON), '# summary\n', 'utf8');
    const r = await graphContext({ cwd: dir, paths: [], runGit: git2({ tracked: true }) });
    expect(r.summaryToon?.usable).toBe(true);
  });
});

describe('graphContext digest', () => {
  it('returns a verdict and no digests for zero paths', async () => {
    writeFreshGraph();
    const r = await graphContext({ cwd: dir, paths: [], runGit: git2({ tracked: true }) });
    expect(r.status).toBe('fresh');
    expect(r.digests).toEqual([]);
  });

  it('marks a path absent from the graph rather than returning an empty digest', async () => {
    writeFreshGraph();
    const r = await graphContext({
      cwd: dir,
      paths: ['src/nope.ts'],
      runGit: git2({ tracked: true }),
    });
    expect(r.digests[0]).toMatchObject({ path: 'src/nope.ts', inGraph: false, community: null });
  });

  it('resolves community, co-members and contained god nodes for a known path', async () => {
    writeFreshGraph();
    const r = await graphContext({
      cwd: dir,
      paths: ['src/a.ts'],
      runGit: git2({ tracked: true }),
    });
    const d = r.digests[0]!;
    expect(d.inGraph).toBe(true);
    expect(d.community).toBe(1);
    // Same community, excluding the file itself.
    expect(d.coMembers).toEqual(['src/b.ts']);
    // `godFn()` has 3 edges, the most of any symbol node here, so it ranks #1.
    expect(d.topDegreeSymbols).toEqual([{ label: 'godFn()', degree: 3, rank: 1 }]);
  });

  it('excludes containment from cross-community edges', async () => {
    writeFreshGraph();
    const r = await graphContext({
      cwd: dir,
      paths: ['src/a.ts'],
      runGit: git2({ tracked: true }),
    });
    const edges = r.digests[0]!.crossCommunityEdges;
    // Two genuine bridges to c.ts: the file's own import, and a call from the
    // symbol the file defines. Both are reported — restricting the walk to the
    // file node omitted the second, which is a real bridge out of this path.
    expect(edges.map((e) => e.relation).toSorted()).toEqual(['calls', 'imports_from']);
    expect(new Set(edges.map((e) => e.to))).toEqual(new Set(['c.ts']));
    // `godFn()` is reached only by `contains`, which is containment rather than
    // a bridge, so it never appears as a destination.
    expect(edges.some((e) => e.to === 'godFn()')).toBe(false);
  });

  it('attributes community owners from FD links.code', async () => {
    writeFreshGraph();
    writeFileSync(
      join(dir, 'docs', 'features', 'owner-fd.md'),
      [
        '---',
        'area: tooling',
        'category: Tooling',
        'deps: []',
        'links:',
        '  code:',
        '    - src/b.ts',
        '  tests: []',
        'name: Owner FD',
        'packages:',
        '  - noldor',
        'phase: done',
        'noldor-tier: specs-only',
        '---',
        '',
        '## Summary',
        '',
        'Owns src/b.ts.',
        '',
      ].join('\n'),
      'utf8',
    );
    const r = await graphContext({
      cwd: dir,
      paths: ['src/a.ts'],
      runGit: git2({ tracked: true }),
    });
    expect(r.digests[0]!.owners).toEqual([{ slug: 'owner-fd', count: 1 }]);
  });
});
