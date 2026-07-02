// @tests: feature-md-links-overhaul
import { classifyCommit, classifyCommits, deriveBumpLevel } from '../release-commits.js';

import type { Commit } from '../release-commits.js';

function commit(subject: string, body = '', sha = 'abc1234', pr?: number): Commit {
  return { body, prNumber: pr, sha, subject };
}

describe(classifyCommit, () => {
  it('categorises feat as feature', () => {
    expect(classifyCommit(commit('feat(engine): add torus'))).toBe('feature');
  });

  it('categorises fix as fix', () => {
    expect(classifyCommit(commit('fix(viewport): grid unit glitch'))).toBe('fix');
  });

  it('categorises everything else as other', () => {
    expect(classifyCommit(commit('refactor(format): split module'))).toBe('other');
    expect(classifyCommit(commit('chore: bump deps'))).toBe('other');
    expect(classifyCommit(commit('docs: tweak'))).toBe('other');
    expect(classifyCommit(commit('perf(engine): speedup'))).toBe('other');
    expect(classifyCommit(commit('test: add cases'))).toBe('other');
    expect(classifyCommit(commit('style: format'))).toBe('other');
    expect(classifyCommit(commit('ci: tweak workflow'))).toBe('other');
    expect(classifyCommit(commit('build: adjust'))).toBe('other');
  });

  it('treats bang feat as feature and bang fix as fix', () => {
    expect(classifyCommit(commit('feat(engine)!: remove old API'))).toBe('feature');
    expect(classifyCommit(commit('fix(format)!: rename field'))).toBe('fix');
  });

  it('ignores non-conventional subjects (routes to other)', () => {
    expect(classifyCommit(commit('random commit message'))).toBe('other');
  });
});

describe(deriveBumpLevel, () => {
  it('returns major for any bang prefix', () => {
    const commits = [commit('feat(engine)!: breaking'), commit('fix: safe')];
    expect(deriveBumpLevel(commits)).toBe('major');
  });

  it('returns major for any BREAKING CHANGE footer', () => {
    const commits = [commit('feat: something', 'BREAKING CHANGE: renamed export Foo to Bar')];
    expect(deriveBumpLevel(commits)).toBe('major');
  });

  it('returns minor for feat without breaking', () => {
    const commits = [commit('feat: new'), commit('fix: bug')];
    expect(deriveBumpLevel(commits)).toBe('minor');
  });

  it('returns patch when only fix/refactor/chore/etc present', () => {
    const commits = [commit('fix: bug'), commit('chore: deps'), commit('refactor(format): split')];
    expect(deriveBumpLevel(commits)).toBe('patch');
  });

  it('returns null for empty commit list', () => {
    expect(deriveBumpLevel([])).toBeNull();
  });
});

describe(classifyCommits, () => {
  it('groups into features / fixes / other buckets', () => {
    const commits = [
      commit('feat(engine): add torus', '', 'aaaa', 1),
      commit('fix(viewport): grid glitch', '', 'bbbb', 2),
      commit('chore: deps', '', 'cccc'),
      commit('refactor(format): split', '', 'dddd', 4),
    ];
    const grouped = classifyCommits(commits);
    expect(grouped.features.map((c) => c.subject)).toStrictEqual(['feat(engine): add torus']);
    expect(grouped.fixes.map((c) => c.subject)).toStrictEqual(['fix(viewport): grid glitch']);
    expect(grouped.other.map((c) => c.subject)).toStrictEqual([
      'chore: deps',
      'refactor(format): split',
    ]);
  });
});
