// @tests: graphify-plan-of-edges-nodes-for-plans-specs
import { describe, expect, it } from 'vitest';

import { parseArgs, renderDigest, renderReport } from '../graph-context-cli.js';
import type { GraphContextResult, PathDigest } from '../graph-context.js';

const CWD = '/repo';

function digest(overrides: Partial<PathDigest> = {}): PathDigest {
  return {
    path: 'src/a.ts',
    inGraph: true,
    community: 7,
    coMembers: ['src/b.ts'],
    owners: [{ slug: 'owner-fd', count: 1 }],
    topDegreeSymbols: [{ label: 'godFn()', degree: 76, rank: 1 }],
    crossCommunityEdges: [{ from: 'a.ts', to: 'c.ts', relation: 'imports_from', toCommunity: 9 }],
    ...overrides,
  };
}

function result(overrides: Partial<GraphContextResult> = {}): GraphContextResult {
  return {
    status: 'fresh',
    detail: 'regenerated in the working tree',
    summaryToon: { path: 'graphify-out/graph.brainstorm-summary.toon', usable: true },
    digests: [digest()],
    ...overrides,
  };
}

describe('parseArgs', () => {
  it('accepts zero paths — a verdict-only call is not an error', () => {
    const r = parseArgs([], CWD);
    expect(r).toEqual({ ok: true, paths: [], json: false });
  });

  it('normalizes an absolute path inside the repo to repo-relative POSIX form', () => {
    const r = parseArgs(['--path', '/repo/src/a.ts'], CWD);
    expect(r).toMatchObject({ ok: true, paths: ['src/a.ts'] });
  });

  it('collapses duplicates however they were spelled', () => {
    const r = parseArgs(['--path', 'src/a.ts', '--path', '/repo/src/a.ts'], CWD);
    expect(r).toMatchObject({ ok: true, paths: ['src/a.ts'] });
  });

  it('rejects a path escaping the repository', () => {
    const r = parseArgs(['--path', '../../etc/passwd'], CWD);
    expect(r).toEqual({ ok: false, error: 'path escapes the repository: ../../etc/passwd' });
  });

  it('rejects the repo root itself, which names no file', () => {
    expect(parseArgs(['--path', '/repo'], CWD).ok).toBe(false);
  });

  it('rejects an unknown argument rather than ignoring it', () => {
    expect(parseArgs(['--bogus'], CWD)).toEqual({ ok: false, error: 'unknown argument: --bogus' });
  });

  it('rejects --path with no value, including a following flag', () => {
    expect(parseArgs(['--path'], CWD)).toEqual({ ok: false, error: '--path needs a value' });
    expect(parseArgs(['--path', '--json'], CWD)).toEqual({
      ok: false,
      error: '--path needs a value',
    });
  });

  it('reads --json in any position', () => {
    expect(parseArgs(['--json', '--path', 'src/a.ts'], CWD)).toMatchObject({ json: true });
    expect(parseArgs(['--path', 'src/a.ts', '--json'], CWD)).toMatchObject({ json: true });
  });
});

describe('renderDigest', () => {
  it('names community, co-members, owners, god nodes and cross-community edges', () => {
    const out = renderDigest(digest());
    expect(out).toContain('community: c7');
    expect(out).toContain('alongside: src/b.ts');
    expect(out).toContain('owner-fd (1 file)');
    expect(out).toContain('godFn() — rank #1, 76 edges');
    expect(out).toContain('c.ts [c9] via imports_from');
  });

  it('pluralizes the owner file count', () => {
    expect(renderDigest(digest({ owners: [{ slug: 'x', count: 2 }] }))).toContain('x (2 files)');
  });

  it('says a path is absent from the graph rather than rendering empty fields', () => {
    const out = renderDigest(digest({ inGraph: false }));
    expect(out).toContain('not in the graph');
    expect(out).not.toContain('community:');
  });

  it('calls out an interior file when there is no god node and no bridge', () => {
    const out = renderDigest(digest({ topDegreeSymbols: [], crossCommunityEdges: [] }));
    expect(out).toContain('an interior file');
  });
});

describe('renderReport', () => {
  it('leads with the verdict and omits the digest when not fresh', () => {
    const out = renderReport(result({ status: 'stale', digests: [], summaryToon: null }));
    expect(out.startsWith('status: stale')).toBe(true);
    expect(out).not.toContain('community');
  });

  it('points at the toon when it is usable', () => {
    expect(renderReport(result())).toContain('read first: graphify-out/graph.brainstorm-summary');
  });

  it('flags an unusable toon without implying the digest is affected', () => {
    const out = renderReport(
      result({ summaryToon: { path: 'graphify-out/x.toon', usable: false } }),
    );
    expect(out).toContain('run pnpm toon');
    expect(out).toContain('digest below is unaffected');
  });

  it('says verdict-only when fresh with no paths', () => {
    expect(renderReport(result({ digests: [] }))).toContain('verdict only');
  });
});
