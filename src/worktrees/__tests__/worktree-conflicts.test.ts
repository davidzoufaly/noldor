// @tests: parallel-worktree-workflow

import { describe, expect, it } from 'vitest';

import type { GraphifyGraph } from '../../garden/graph-fd-lookup.js';
import {
  buildCommunityMap,
  communityForFile,
  formatConflicts,
  hasHardConflict,
  scoreConflicts,
} from '../worktree-conflicts.js';

function graph(nodes: Array<{ source_file: string; community: number }>): GraphifyGraph {
  return {
    nodes: nodes.map((n, i) => ({
      id: `n${i}`,
      source_file: n.source_file,
      community: n.community,
    })),
    links: [],
  };
}

describe('buildCommunityMap', () => {
  it('maps each source_file to its community id', () => {
    const map = buildCommunityMap(
      graph([
        { source_file: 'core/a.ts', community: 3 },
        { source_file: 'core/b.ts', community: 3 },
        { source_file: 'dashboard/c.ts', community: 7 },
      ]),
    );
    expect(map.get('core/a.ts')).toBe(3);
    expect(map.get('core/b.ts')).toBe(3);
    expect(map.get('dashboard/c.ts')).toBe(7);
  });

  it('skips nodes lacking source_file or community', () => {
    const map = buildCommunityMap({
      nodes: [
        { id: 'x', community: 1 },
        { id: 'y', source_file: 'z.ts' },
        { id: 'w', source_file: 'ok.ts', community: 5 },
      ],
      links: [],
    });
    expect(map.size).toBe(1);
    expect(map.get('ok.ts')).toBe(5);
  });
});

describe('communityForFile', () => {
  const map = new Map<string, number>([['core/a.ts', 3]]);

  it('strips the src/ prefix from a repo-relative path before lookup', () => {
    expect(communityForFile('src/core/a.ts', map)).toBe(3);
  });

  it('returns null for a file outside the graph (e.g. docs, package.json)', () => {
    expect(communityForFile('docs/roadmap.md', map)).toBeNull();
    expect(communityForFile('package.json', map)).toBeNull();
  });

  it('honours a custom src prefix', () => {
    expect(communityForFile('lib/core/a.ts', map, 'lib/')).toBe(3);
  });
});

describe('scoreConflicts', () => {
  const empty = new Map<string, number>();

  it('reports a direct collision when two trees touch the same file', () => {
    const pairs = scoreConflicts(
      [
        { branch: 'feat/a', touchedFiles: ['src/core/x.ts', 'src/core/y.ts'] },
        { branch: 'feat/b', touchedFiles: ['src/core/x.ts'] },
      ],
      empty,
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.branchA).toBe('feat/a');
    expect(pairs[0]!.branchB).toBe('feat/b');
    expect(pairs[0]!.directFiles).toEqual(['src/core/x.ts']);
    expect(pairs[0]!.sharedCommunities).toEqual([]);
  });

  it('reports a soft community collision when different files share a community', () => {
    const map = new Map<string, number>([
      ['core/x.ts', 9],
      ['core/y.ts', 9],
    ]);
    const pairs = scoreConflicts(
      [
        { branch: 'feat/a', touchedFiles: ['src/core/x.ts'] },
        { branch: 'feat/b', touchedFiles: ['src/core/y.ts'] },
      ],
      map,
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.directFiles).toEqual([]);
    expect(pairs[0]!.sharedCommunities).toHaveLength(1);
    expect(pairs[0]!.sharedCommunities[0]!.community).toBe(9);
    expect(pairs[0]!.sharedCommunities[0]!.filesA).toEqual(['src/core/x.ts']);
    expect(pairs[0]!.sharedCommunities[0]!.filesB).toEqual(['src/core/y.ts']);
  });

  it('does not double-count a direct-collision file as a community conflict', () => {
    const map = new Map<string, number>([['core/x.ts', 9]]);
    const pairs = scoreConflicts(
      [
        { branch: 'feat/a', touchedFiles: ['src/core/x.ts'] },
        { branch: 'feat/b', touchedFiles: ['src/core/x.ts'] },
      ],
      map,
    );
    expect(pairs[0]!.directFiles).toEqual(['src/core/x.ts']);
    expect(pairs[0]!.sharedCommunities).toEqual([]);
  });

  it('omits pairs with neither a direct nor a community collision', () => {
    const map = new Map<string, number>([
      ['core/x.ts', 1],
      ['core/y.ts', 2],
    ]);
    const pairs = scoreConflicts(
      [
        { branch: 'feat/a', touchedFiles: ['src/core/x.ts'] },
        { branch: 'feat/b', touchedFiles: ['src/core/y.ts'] },
      ],
      map,
    );
    expect(pairs).toEqual([]);
  });

  it('scores direct collisions above community collisions and sorts descending', () => {
    const map = new Map<string, number>([
      ['core/p.ts', 4],
      ['core/q.ts', 4],
    ]);
    const pairs = scoreConflicts(
      [
        { branch: 'feat/a', touchedFiles: ['src/core/shared.ts', 'src/core/p.ts'] },
        { branch: 'feat/b', touchedFiles: ['src/core/shared.ts'] }, // direct with a
        { branch: 'feat/c', touchedFiles: ['src/core/q.ts'] }, // community-only with a
      ],
      map,
    );
    // a↔b direct (score 10) must rank before a↔c community-only (score 1).
    expect(pairs[0]!.branchB).toBe('feat/b');
    expect(pairs[0]!.score).toBeGreaterThan(pairs[1]!.score);
    expect(pairs[1]!.branchB).toBe('feat/c');
  });
});

describe('hasHardConflict', () => {
  it('is true when any pair has a direct file collision', () => {
    expect(
      hasHardConflict([
        { branchA: 'a', branchB: 'b', directFiles: ['x'], sharedCommunities: [], score: 10 },
      ]),
    ).toBe(true);
  });

  it('is false when only community collisions exist', () => {
    expect(
      hasHardConflict([
        {
          branchA: 'a',
          branchB: 'b',
          directFiles: [],
          sharedCommunities: [{ community: 1, filesA: ['x'], filesB: ['y'] }],
          score: 1,
        },
      ]),
    ).toBe(false);
  });

  it('is false for an empty report', () => {
    expect(hasHardConflict([])).toBe(false);
  });
});

describe('formatConflicts', () => {
  it('reports no conflicts cleanly', () => {
    const out = formatConflicts([], { graphAvailable: true });
    expect(out).toContain('No conflicts');
  });

  it('renders a direct collision with its files', () => {
    const out = formatConflicts(
      [
        {
          branchA: 'feat/a',
          branchB: 'feat/b',
          directFiles: ['src/core/x.ts'],
          sharedCommunities: [],
          score: 10,
        },
      ],
      { graphAvailable: true },
    );
    expect(out).toContain('feat/a');
    expect(out).toContain('feat/b');
    expect(out).toContain('src/core/x.ts');
  });

  it('notes when the graph was unavailable so community scoring was skipped', () => {
    const out = formatConflicts([], { graphAvailable: false });
    expect(out.toLowerCase()).toContain('community scoring skipped');
  });
});
