// @tests: dynamic-fd-file-pointers-via-frontmatter

import { describe, expect, it } from 'vitest';

import { rankCandidates } from '../propose-pointers.js';

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
