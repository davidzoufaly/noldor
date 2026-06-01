// @tests: parallel-worktree-workflow

import { describe, expect, it } from 'vitest';

import { evaluate } from '../check-shared-files.js';

describe('check-shared-files / evaluate', () => {
  it('returns reason="main" when repoRoot does not contain .worktrees', () => {
    expect(evaluate(['CLAUDE.md'], '/repo', {})).toEqual({ blocked: [], reason: 'main' });
  });

  it('returns reason="override" when NOLDOR_ALLOW_SHARED=1', () => {
    expect(evaluate(['CLAUDE.md'], '/repo/.worktrees/foo', { NOLDOR_ALLOW_SHARED: '1' })).toEqual({
      blocked: [],
      reason: 'override',
    });
  });

  it('returns reason="ok" when no staged files match block list', () => {
    expect(evaluate(['src/foo.ts', 'docs/x.md'], '/repo/.worktrees/foo', {})).toEqual({
      blocked: [],
      reason: 'ok',
    });
  });

  it('returns reason="block" when CLAUDE.md staged from worktree', () => {
    expect(evaluate(['CLAUDE.md'], '/repo/.worktrees/foo', {})).toEqual({
      blocked: ['CLAUDE.md'],
      reason: 'block',
    });
  });

  it('blocks pnpm-lock.yaml, package.json, engineering rules', () => {
    const result = evaluate(
      ['pnpm-lock.yaml', 'package.json', '.claude/engineering-rules.md'],
      '/repo/.worktrees/foo',
      {},
    );
    expect(result.reason).toBe('block');
    expect(result.blocked.toSorted()).toEqual(
      ['.claude/engineering-rules.md', 'package.json', 'pnpm-lock.yaml'].toSorted(),
    );
  });

  it('blocks .claude/CLAUDE.md (project rules) and root CLAUDE.md', () => {
    const result = evaluate(['.claude/CLAUDE.md', 'CLAUDE.md'], '/repo/.worktrees/foo', {});
    expect(result.reason).toBe('block');
    expect(result.blocked.toSorted()).toEqual(['.claude/CLAUDE.md', 'CLAUDE.md'].toSorted());
  });

  it('blocks .claude/skills/** and .claude/commands/** by glob', () => {
    const result = evaluate(
      ['.claude/skills/foo.md', '.claude/commands/bar.md', '.claude/notes.md'],
      '/repo/.worktrees/foo',
      {},
    );
    expect(result.reason).toBe('block');
    expect(result.blocked.toSorted()).toEqual(
      ['.claude/commands/bar.md', '.claude/skills/foo.md'].toSorted(),
    );
  });
});
