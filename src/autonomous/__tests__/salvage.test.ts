// @tests: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox, parallel-drain-roadmapmd-conflict-auto-resolution
import { describe, expect, it } from 'vitest';
import { detectStale, repair, type GitRunner } from '../salvage.js';

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

describe('detectStale', () => {
  it('flags a local branch whose base is behind origin/main', () => {
    const run = runner({
      'git rev-parse --verify fast/x': { ok: true, stdout: 'abc\n' },
      'git merge-base --is-ancestor origin/main fast/x': { ok: false, stdout: '' },
      'gh pr list': { ok: true, stdout: '[]' },
      'git ls-remote --heads origin fast/x': { ok: true, stdout: '' },
    });
    expect(detectStale(run, 'fast/x')).toEqual(['local-branch-behind-main']);
  });

  it('flags a closed-unmerged PR', () => {
    const run = runner({
      'git rev-parse --verify fast/x': { ok: false, stdout: '' },
      'gh pr list': { ok: true, stdout: '[{"mergedAt":null}]' },
      'git ls-remote --heads origin fast/x': { ok: true, stdout: '' },
    });
    expect(detectStale(run, 'fast/x')).toEqual(['closed-unmerged-pr']);
  });

  it('ignores a closed PR that was merged', () => {
    const run = runner({
      'git rev-parse --verify fast/x': { ok: false, stdout: '' },
      'gh pr list': { ok: true, stdout: '[{"mergedAt":"2026-06-11T00:00:00Z"}]' },
      'git ls-remote --heads origin fast/x': { ok: true, stdout: '' },
    });
    expect(detectStale(run, 'fast/x')).toEqual([]);
  });

  it('flags an orphan remote branch', () => {
    const run = runner({
      'git rev-parse --verify fast/x': { ok: false, stdout: '' },
      'gh pr list': { ok: true, stdout: '[]' },
      'git ls-remote --heads origin fast/x': { ok: true, stdout: 'def refs/heads/fast/x\n' },
    });
    expect(detectStale(run, 'fast/x')).toEqual(['orphan-remote-branch']);
  });

  it('reports a current-base local branch with no PR as clean (child force-recreate owns it)', () => {
    const run = runner({
      'git rev-parse --verify fast/x': { ok: true, stdout: 'abc\n' },
      'git merge-base --is-ancestor origin/main fast/x': { ok: true, stdout: '' },
      'gh pr list': { ok: true, stdout: '[]' },
      'git ls-remote --heads origin fast/x': { ok: true, stdout: '' },
    });
    expect(detectStale(run, 'fast/x')).toEqual([]);
  });

  it('throws when gh output is not parseable JSON (fail-closed)', () => {
    const run = runner({
      'git rev-parse --verify fast/x': { ok: false, stdout: '' },
      'gh pr list': { ok: true, stdout: 'not json' },
    });
    expect(() => detectStale(run, 'fast/x')).toThrow();
  });

  it('throws when gh itself fails (fail-closed: never guess salvage state)', () => {
    const run = runner({
      'git rev-parse --verify fast/x': { ok: false, stdout: '' },
      'gh pr list': { ok: false, stdout: '' },
    });
    expect(() => detectStale(run, 'fast/x')).toThrow('gh pr list failed');
  });

  it('throws when ls-remote fails (fail-closed)', () => {
    const run = runner({
      'git rev-parse --verify fast/x': { ok: false, stdout: '' },
      'gh pr list': { ok: true, stdout: '[]' },
      'git ls-remote --heads origin fast/x': { ok: false, stdout: '' },
    });
    expect(() => detectStale(run, 'fast/x')).toThrow('ls-remote failed');
  });
});

describe('repair', () => {
  it('removes worktree, local branch, and remote branch (best-effort each)', () => {
    const calls: string[] = [];
    const run: GitRunner = (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      return { ok: false, stdout: '' }; // every step failing must not throw
    };
    repair(run, 'foo');
    expect(calls).toEqual([
      'git worktree remove --force .worktrees/foo',
      'git branch -D fast/foo',
      'git push origin --delete fast/foo',
    ]);
  });
});
