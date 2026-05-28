// @tests: parallel-worktree-workflow

import { describe, expect, it } from 'vitest';

import { resolveMainWorktreePath } from '../launch-worktrees.js';

describe(resolveMainWorktreePath, () => {
  it('selects the real main tree from porcelain output even when cwd is a feature tree', () => {
    const porcelain = [
      'worktree /repo',
      'HEAD aaaaaaa',
      'branch refs/heads/main',
      '',
      'worktree /repo/.worktrees/foo',
      'HEAD bbbbbbb',
      'branch refs/heads/feat/foo',
      '',
    ].join('\n');

    expect(resolveMainWorktreePath(porcelain)).toBe('/repo');
  });
});
