// @tests: autonomous-queue-drain-runner
import { describe, expect, it } from 'vitest';
import { classifyDrainBranch, worktreeFor } from '../drain-branch-state.js';
import type { GitRunner } from '../salvage.js';

/** Scripted runner: maps "cmd arg arg" prefixes to results. Unmatched → ok:true, ''. */
function runner(script: Record<string, { ok: boolean; stdout: string }>): GitRunner {
  return (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    for (const [prefix, res] of Object.entries(script)) {
      if (key.startsWith(prefix)) return res;
    }
    return { ok: true, stdout: '' };
  };
}

const WORKTREE_LIST = [
  'worktree /repo',
  'HEAD aaa',
  'branch refs/heads/main',
  '',
  'worktree /repo/.worktrees/x',
  'HEAD bbb',
  'branch refs/heads/fast/x',
  '',
].join('\n');

describe('classifyDrainBranch', () => {
  it('delivers unpushed commits on a clean branch instead of recreating it', () => {
    const s = classifyDrainBranch(
      runner({
        'git fetch origin': { ok: true, stdout: '' },
        'git rev-list --count origin/main..fast/x': { ok: true, stdout: '7\n' },
        'git worktree list': { ok: true, stdout: WORKTREE_LIST },
        'git -C /repo/.worktrees/x status': { ok: true, stdout: '' },
      }),
      'x',
    );
    expect(s.verdict).toBe('finish');
    expect(s.reason).toContain('do NOT force-recreate');
  });

  it('delivers a pushed-but-no-PR branch with no local checkout', () => {
    const s = classifyDrainBranch(
      runner({
        'git fetch origin': { ok: true, stdout: '' },
        'git rev-list --count origin/main..fast/x': { ok: false, stdout: '' },
        'git rev-list --count origin/main..origin/fast/x': { ok: true, stdout: '3\n' },
        'git worktree list': { ok: true, stdout: '' },
      }),
      'x',
    );
    expect(s.verdict).toBe('finish');
    expect(s.dirtyWorktree).toBeNull();
  });

  it('authorizes a rebuild when nothing is ahead of origin/main', () => {
    const s = classifyDrainBranch(
      runner({
        'git fetch origin': { ok: true, stdout: '' },
        'git rev-list --count origin/main..fast/x': { ok: true, stdout: '0\n' },
        'git rev-list --count origin/main..origin/fast/x': { ok: true, stdout: '0\n' },
      }),
      'x',
    );
    expect(s.verdict).toBe('rebuild');
    expect(s.hasWork).toBe(false);
  });

  it('rebuilds a dirty checkout but names the range to inspect first', () => {
    const s = classifyDrainBranch(
      runner({
        'git fetch origin': { ok: true, stdout: '' },
        'git rev-list --count origin/main..fast/x': { ok: true, stdout: '2\n' },
        'git worktree list': { ok: true, stdout: WORKTREE_LIST },
        'git -C /repo/.worktrees/x status': { ok: true, stdout: ' M src/a.ts\n' },
      }),
      'x',
    );
    expect(s.verdict).toBe('rebuild');
    expect(s.dirtyWorktree).toBe('/repo/.worktrees/x');
    expect(s.reason).toContain('git log origin/main..fast/x');
  });

  it('refuses to authorize a deletion when origin is unreachable (fail-closed)', () => {
    const s = classifyDrainBranch(
      runner({
        'git fetch origin': { ok: false, stdout: '' },
        'git rev-list --count': { ok: true, stdout: '0\n' },
      }),
      'x',
    );
    expect(s.verdict).toBe('unknown');
    expect(s.remoteFetched).toBe(false);
  });

  it('still delivers local commits when origin is unreachable', () => {
    const s = classifyDrainBranch(
      runner({
        'git fetch origin': { ok: false, stdout: '' },
        'git rev-list --count origin/main..fast/x': { ok: true, stdout: '4\n' },
        'git worktree list': { ok: true, stdout: WORKTREE_LIST },
        'git -C /repo/.worktrees/x status': { ok: true, stdout: '' },
      }),
      'x',
    );
    expect(s.verdict).toBe('finish');
  });
});

describe('worktreeFor', () => {
  it('resolves the checkout holding the branch', () => {
    expect(
      worktreeFor(runner({ 'git worktree list': { ok: true, stdout: WORKTREE_LIST } }), 'fast/x'),
    ).toBe('/repo/.worktrees/x');
  });

  it('returns null when the branch is checked out nowhere', () => {
    expect(
      worktreeFor(
        runner({ 'git worktree list': { ok: true, stdout: WORKTREE_LIST } }),
        'fast/other',
      ),
    ).toBeNull();
  });
});
