// @tests: dynamic-fd-file-pointers-via-frontmatter, outcome-telemetry-and-effectiveness-metrics, sdd-co-tag-detector

import { describe, expect, it } from 'vitest';

import { proposeCandidates, rankCandidates } from '../propose-pointers.js';
import type { GraphifyGraph } from '../../garden/graph-fd-lookup.js';

describe('rankCandidates', () => {
  it('ranks a file appearing in both import and community signal highest', () => {
    const ranked = rankCandidates({
      importHits: ['src/a.ts', 'src/b.ts'],
      communityHits: ['src/a.ts'],
    });
    expect(ranked[0]).toEqual({ file: 'src/a.ts', score: 2, reason: 'import + community' });
    expect(ranked[1]).toEqual({ file: 'src/b.ts', score: 1, reason: 'import' });
  });

  it('returns [] when there is no signal', () => {
    expect(rankCandidates({ importHits: [], communityHits: [] })).toEqual([]);
  });
});

describe('proposeCandidates', () => {
  const L1 = (id: string, source_file: string, community: number) => ({
    id,
    source_file,
    source_location: 'L1',
    community,
  });
  // fd1 owns owned.ts (+ alsoOwned.ts). Community 1 = {owned, alsoOwned, sibling, both}.
  const graph: GraphifyGraph = {
    nodes: [
      L1('n1', 'src/owned.ts', 1),
      L1('n6', 'src/alsoOwned.ts', 1),
      L1('n2', 'src/sibling.ts', 1),
      L1('n5', 'src/both.ts', 1),
      L1('n3', 'src/imp.ts', 7),
      L1('n4', 'src/other.ts', 2),
    ],
    links: [
      { source: 'n1', target: 'n5', relation: 'imports_from' }, // owned imports both.ts
      { source: 'n3', target: 'n1', relation: 'imports_from' }, // imp.ts imports owned
      { source: 'n1', target: 'n6', relation: 'imports_from' }, // owned imports alsoOwned (owned → skip)
      { source: 'n2', target: 'n4', relation: 'calls' }, // non-import edge → ignored
    ],
  };
  const fileToFds = new Map<string, Set<string>>([
    ['src/owned.ts', new Set(['fd1'])],
    ['src/alsoOwned.ts', new Set(['fd1'])],
  ]);

  it('ranks community siblings + import neighbors the FD does not yet own', () => {
    const ranked = proposeCandidates('fd1', graph, fileToFds);
    expect(ranked).toEqual([
      { file: 'src/both.ts', score: 2, reason: 'import + community' },
      { file: 'src/imp.ts', score: 1, reason: 'import' },
      { file: 'src/sibling.ts', score: 1, reason: 'community' },
    ]);
  });

  it('excludes already-owned files and unrelated communities', () => {
    const files = proposeCandidates('fd1', graph, fileToFds).map((c) => c.file);
    expect(files).not.toContain('src/alsoOwned.ts'); // owned
    expect(files).not.toContain('src/owned.ts'); // owned
    expect(files).not.toContain('src/other.ts'); // community 2, no import edge
  });

  it('returns [] when the FD owns nothing in the graph', () => {
    expect(proposeCandidates('unknown-fd', graph, fileToFds)).toEqual([]);
  });
});
