// @tests: dynamic-fd-changelog, framework-pr-flow-agent-auto-merge

import { describe, expect, it } from 'vitest';

import { renderPerReleaseBlock } from '../release-fd-changelog.js';

import type { FeatureCommit } from '../release-fd-commits.js';

const repoUrl = 'https://github.com/o/r';

function commit(subject: string, type = 'feat'): FeatureCommit {
  return { sha: 'abc123def456', type, subject, date: '2026-05-15' };
}

const offline = true;

describe('renderPerReleaseBlock', () => {
  it('emits `(in-progress)` suffix when phase is in-progress', async () => {
    const block = await renderPerReleaseBlock({
      version: '0.5.0',
      phase: 'in-progress',
      commits: [commit('feat(pkg:foo): bar (#42)')],
      repoUrl,
      offline,
    });
    expect(block).toMatch(/^### 0\.5\.0 \(in-progress\)/m);
    expect(block).toMatch(/#### PRs/);
    expect(block).toMatch(/#42:/);
  });

  it('omits suffix when phase is done', async () => {
    const block = await renderPerReleaseBlock({
      version: '0.5.0',
      phase: 'done',
      commits: [commit('feat(pkg:foo): bar (#42)')],
      repoUrl,
      offline,
    });
    expect(block).toMatch(/^### 0\.5\.0\b/m);
    expect(block).not.toMatch(/\(in-progress\)/);
  });

  it('omits `#### PRs` when no commits carry PR refs', async () => {
    const block = await renderPerReleaseBlock({
      version: '0.5.0',
      phase: 'done',
      commits: [commit('feat(pkg:foo): plain')],
      repoUrl,
      offline,
    });
    expect(block).not.toMatch(/#### PRs/);
    expect(block).toMatch(/#### Summary/);
  });

  it('filters noise types from BOTH Summary and PRs section', async () => {
    const block = await renderPerReleaseBlock({
      version: '0.5.0',
      phase: 'done',
      commits: [
        commit('chore(pkg:foo): tidy (#99)', 'chore'),
        commit('feat(pkg:foo): bar (#42)', 'feat'),
      ],
      repoUrl,
      offline,
    });
    expect(block).toMatch(/#42:/);
    expect(block).not.toMatch(/#99:/);
  });

  it('returns null when all commits are noise', async () => {
    const block = await renderPerReleaseBlock({
      version: '0.5.0',
      phase: 'done',
      commits: [commit('chore(pkg:foo): tidy', 'chore')],
      repoUrl,
      offline,
    });
    expect(block).toBeNull();
  });
});
