// @tests: dynamic-fd-changelog, framework-pr-flow-agent-auto-merge

import { describe, expect, it } from 'vitest';

import { PR_SUBJECT_RE, renderPrBullets } from '../release-pr-bullets.js';

import type { FeatureCommit } from '../release-fd-commits.js';

const repoUrl = 'https://github.com/o/r';

function commit(subject: string, sha = 'abc123def456', date = '2026-05-15'): FeatureCommit {
  return { sha, type: 'feat', subject, date };
}

describe('renderPrBullets', () => {
  it('extracts PR number from subject suffix', () => {
    const out = renderPrBullets([commit('feat(scope:foo): add bar (#42)')], repoUrl);
    expect(out).toEqual([
      '- #42: feat(scope:foo): add bar ([link](https://github.com/o/r/pull/42))',
    ]);
  });

  it('dedupes by PR number (same PR appears in two commits)', () => {
    const out = renderPrBullets(
      [commit('feat(scope:foo): add bar (#42)'), commit('feat(scope:foo): tweak bar (#42)')],
      repoUrl,
    );
    expect(out).toHaveLength(1);
  });

  it('preserves input order (newest-first from git log)', () => {
    const out = renderPrBullets(
      [commit('feat(scope:foo): newer (#99)'), commit('feat(scope:foo): older (#50)')],
      repoUrl,
    );
    expect(out[0]).toMatch(/#99/);
    expect(out[1]).toMatch(/#50/);
  });

  it('skips commits without PR suffix', () => {
    const out = renderPrBullets(
      [commit('feat(scope:foo): with PR (#42)'), commit('feat(scope:foo): no PR ref')],
      repoUrl,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/#42/);
  });

  it('returns empty array when no commits have PR refs', () => {
    const out = renderPrBullets([commit('feat(scope:foo): plain')], repoUrl);
    expect(out).toEqual([]);
  });
});

describe('PR_SUBJECT_RE', () => {
  it('matches a trailing (#42) suffix', () => {
    const match = 'feat(scope:foo): add bar (#42)'.match(PR_SUBJECT_RE);
    expect(match?.[1]).toBe('42');
  });

  it('returns null when no PR suffix', () => {
    expect('feat(scope:foo): plain'.match(PR_SUBJECT_RE)).toBeNull();
  });
});
