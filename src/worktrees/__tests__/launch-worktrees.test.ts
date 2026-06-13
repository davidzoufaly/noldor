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

import { buildLaunchCommand } from '../launch-worktrees.js';
describe('buildLaunchCommand', () => {
  it('cds into the tree and runs the resolved agent with the rendered prompt', () => {
    const cmd = buildLaunchCommand(
      { path: '/repo/.worktrees/foo', branch: 'feat/foo', isMain: false },
      'read {{slug}} on {{branch}}',
      'claude --dangerously-skip-permissions', // resolved from agents.default (default)
    );
    expect(cmd).toContain("cd '/repo/.worktrees/foo'");
    expect(cmd).toContain('claude --dangerously-skip-permissions');
    expect(cmd).toContain('read foo on feat/foo');
  });
  it('omits the prompt arg when template empty', () => {
    const cmd = buildLaunchCommand(
      { path: '/repo/.worktrees/foo', branch: 'feat/foo', isMain: false },
      '',
      'claude --dangerously-skip-permissions',
    );
    expect(cmd).toBe("cd '/repo/.worktrees/foo' && claude --dangerously-skip-permissions");
  });
  it('runs a non-claude agent when agents.default resolves to one', () => {
    const cmd = buildLaunchCommand(
      { path: '/repo/.worktrees/foo', branch: 'feat/foo', isMain: false },
      '',
      'opencode', // resolved interactive invocation for agents.default = opencode
    );
    expect(cmd).toBe("cd '/repo/.worktrees/foo' && opencode");
  });
});
