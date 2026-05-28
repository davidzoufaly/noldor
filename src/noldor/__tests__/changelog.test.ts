// @tests: noldor
import { describe, it, expect } from 'vitest';

import { filterCommitsForPage, parseScope } from '../changelog.js';

describe('parseScope', () => {
  it('parses noldor scope (no slug)', () => {
    expect(parseScope('docs(noldor): refactor')).toEqual({
      type: 'docs',
      scope: 'noldor',
      slug: null,
    });
  });

  it('parses noldor:slug scope', () => {
    expect(parseScope('feat(noldor:workflow): add rule')).toEqual({
      type: 'feat',
      scope: 'noldor:workflow',
      slug: 'workflow',
    });
  });

  it('returns non-null for non-noldor commits but slug is null', () => {
    expect(parseScope('feat(engine): add cylinder')).toEqual({
      type: 'feat',
      scope: 'engine',
      slug: null,
    });
  });

  it('returns null scope for unscoped commits', () => {
    expect(parseScope('chore: tidy')).toEqual({ type: 'chore', scope: null, slug: null });
  });
});

describe('filterCommitsForPage', () => {
  it('includes commits with matching slug', () => {
    const commits = [
      {
        hash: 'abc123def456',
        subject: 'docs(noldor:workflow): add rule',
        files: ['docs/noldor/workflow.md'],
      },
    ];
    expect(filterCommitsForPage(commits, 'workflow')).toHaveLength(1);
  });

  it('includes framework-wide commits that touched the page', () => {
    const commits = [
      {
        hash: 'abc123def456',
        subject: 'refactor(noldor): rename sections',
        files: ['docs/noldor/workflow.md', 'docs/noldor/git-and-commits.md'],
      },
    ];
    expect(filterCommitsForPage(commits, 'workflow')).toHaveLength(1);
  });

  it('excludes commits whose scope matches a different page', () => {
    const commits = [
      {
        hash: 'abc123def456',
        subject: 'docs(noldor:lifecycle): update',
        files: ['docs/noldor/workflow.md'],
      },
    ];
    expect(filterCommitsForPage(commits, 'workflow')).toHaveLength(0);
  });

  it('excludes commits without noldor scope even if path matches', () => {
    const commits = [
      {
        hash: 'abc123def456',
        subject: 'docs: misc',
        files: ['docs/noldor/workflow.md'],
      },
    ];
    expect(filterCommitsForPage(commits, 'workflow')).toHaveLength(0);
  });
});
