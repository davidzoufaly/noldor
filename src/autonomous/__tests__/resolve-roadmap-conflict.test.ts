// @tests: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox, parallel-drain-roadmapmd-conflict-auto-resolution
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { resolveRoadmapConflict, type GitRunner } from '../salvage.js';

/**
 * Scripted+recording runner: maps a full "cmd arg arg" key to a result (longest
 * matching prefix wins so `rebase origin/main` and `rebase --continue` stay
 * distinct), records every invoked key for ordering assertions. Unmatched → ok.
 */
function runner(script: Record<string, { ok: boolean; stdout: string }>): {
  run: GitRunner;
  calls: string[];
} {
  const calls: string[] = [];
  const run: GitRunner = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    calls.push(key);
    let best: { ok: boolean; stdout: string } | undefined;
    let bestLen = -1;
    for (const [prefix, res] of Object.entries(script)) {
      if (key.startsWith(prefix) && prefix.length > bestLen) {
        best = res;
        bestLen = prefix.length;
      }
    }
    return best ?? { ok: true, stdout: '' };
  };
  return { run, calls };
}

const CWD = '/repo';
const WT = '.worktrees/.merge-x';

describe('resolveRoadmapConflict', () => {
  it('(a) clean rebase → resolved, never touches removeBlock', () => {
    const { run, calls } = runner({
      'git worktree add --force .worktrees/.merge-x origin/fast/x': { ok: true, stdout: '' },
      'git -C .worktrees/.merge-x rebase origin/main': { ok: true, stdout: '' },
      'git -C .worktrees/.merge-x push --force-with-lease origin HEAD:fast/x': {
        ok: true,
        stdout: '',
      },
    });
    const removeBlockFn = vi.fn();
    const writeFile = vi.fn();
    const out = resolveRoadmapConflict(
      run,
      'x',
      'fast/x',
      CWD,
      removeBlockFn,
      'docs/roadmap.md',
      3,
      writeFile,
    );
    expect(out).toBe('resolved');
    expect(removeBlockFn).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(calls).toContain('git worktree remove --force .worktrees/.merge-x');
  });

  it('(b) roadmap-only conflict → re-applies removeBlock against fresh base → resolved', () => {
    const { run } = runner({
      'git worktree add --force .worktrees/.merge-x origin/fast/x': { ok: true, stdout: '' },
      'git -C .worktrees/.merge-x rebase origin/main': { ok: false, stdout: '' },
      'git -C .worktrees/.merge-x diff --name-only --diff-filter=U': {
        ok: true,
        stdout: 'docs/roadmap.md\n',
      },
      'git -C .worktrees/.merge-x show origin/main:docs/roadmap.md': {
        ok: true,
        stdout: 'BASE_RAW',
      },
      'git -C .worktrees/.merge-x rebase --continue': { ok: true, stdout: '' },
      'git -C .worktrees/.merge-x push --force-with-lease origin HEAD:fast/x': {
        ok: true,
        stdout: '',
      },
    });
    const removeBlockFn = vi.fn(() => ({ newRaw: 'NEW_RAW', removedBlock: '' }));
    const writeFile = vi.fn();
    const out = resolveRoadmapConflict(
      run,
      'x',
      'fast/x',
      CWD,
      removeBlockFn,
      'docs/roadmap.md',
      3,
      writeFile,
    );
    expect(out).toBe('resolved');
    expect(removeBlockFn).toHaveBeenCalledWith('BASE_RAW', 'x');
    expect(writeFile).toHaveBeenCalledWith(join(CWD, WT, 'docs/roadmap.md'), 'NEW_RAW');
  });

  it('(c) conflict includes a non-roadmap path → unresolvable + rebase --abort', () => {
    const { run, calls } = runner({
      'git worktree add --force .worktrees/.merge-x origin/fast/x': { ok: true, stdout: '' },
      'git -C .worktrees/.merge-x rebase origin/main': { ok: false, stdout: '' },
      'git -C .worktrees/.merge-x diff --name-only --diff-filter=U': {
        ok: true,
        stdout: 'docs/roadmap.md\nsrc/foo.ts\n',
      },
    });
    const out = resolveRoadmapConflict(
      run,
      'x',
      'fast/x',
      CWD,
      vi.fn(),
      'docs/roadmap.md',
      3,
      vi.fn(),
    );
    expect(out).toBe('unresolvable');
    expect(calls).toContain('git -C .worktrees/.merge-x rebase --abort');
    expect(calls).toContain('git worktree remove --force .worktrees/.merge-x');
  });

  it('(d) removeBlock throws (block absent in base) → unresolvable + abort', () => {
    const { run, calls } = runner({
      'git worktree add --force .worktrees/.merge-x origin/fast/x': { ok: true, stdout: '' },
      'git -C .worktrees/.merge-x rebase origin/main': { ok: false, stdout: '' },
      'git -C .worktrees/.merge-x diff --name-only --diff-filter=U': {
        ok: true,
        stdout: 'docs/roadmap.md\n',
      },
      'git -C .worktrees/.merge-x show origin/main:docs/roadmap.md': {
        ok: true,
        stdout: 'BASE_RAW',
      },
    });
    const removeBlockFn = vi.fn(() => {
      throw new Error('write-blocks: no block for slug');
    });
    const out = resolveRoadmapConflict(
      run,
      'x',
      'fast/x',
      CWD,
      removeBlockFn,
      'docs/roadmap.md',
      3,
      vi.fn(),
    );
    expect(out).toBe('unresolvable');
    expect(calls).toContain('git -C .worktrees/.merge-x rebase --abort');
  });

  it('(e) force-push fails → unresolvable', () => {
    const { run } = runner({
      'git worktree add --force .worktrees/.merge-x origin/fast/x': { ok: true, stdout: '' },
      'git -C .worktrees/.merge-x rebase origin/main': { ok: true, stdout: '' },
      'git -C .worktrees/.merge-x push --force-with-lease origin HEAD:fast/x': {
        ok: false,
        stdout: '',
      },
    });
    const out = resolveRoadmapConflict(
      run,
      'x',
      'fast/x',
      CWD,
      vi.fn(),
      'docs/roadmap.md',
      3,
      vi.fn(),
    );
    expect(out).toBe('unresolvable');
  });

  it('worktree add failure → unresolvable, no rebase attempted', () => {
    const { run, calls } = runner({
      'git worktree add --force .worktrees/.merge-x origin/fast/x': { ok: false, stdout: '' },
    });
    const out = resolveRoadmapConflict(
      run,
      'x',
      'fast/x',
      CWD,
      vi.fn(),
      'docs/roadmap.md',
      3,
      vi.fn(),
    );
    expect(out).toBe('unresolvable');
    expect(calls.some((c) => c.includes('rebase'))).toBe(false);
  });
});
