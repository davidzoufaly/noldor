// @tests: unvalidated-slug-path-traversal-across-cli-entry-points
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downWorktree } from '../down-worktree.js';

let base: string;
let repo: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'down-traversal-'));
  repo = join(base, 'a', 'b', 'repo');
  mkdirSync(join(repo, '.noldor'), { recursive: true });
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('downWorktree refuses a traversing slug', () => {
  it('never reads the foreign pid file it would otherwise reap', async () => {
    // The read is not directly observable, but its CONSEQUENCE is: every
    // well-formed line in a pid file increments `reaped`. So plant a pid file
    // exactly where the payload resolves and check the count.
    //
    // Where it resolves is COMPUTED, not assumed. `dev-<slug>.pids` puts the
    // slug mid-segment, so the escape depth is not the obvious one, and a
    // hand-guessed path would leave this test passing because it pointed at
    // nothing — the same false green the subprocess layer already hit once.
    const slug = '../../../../foreign';
    const wouldRead = join(repo, '.noldor', `dev-${slug}.pids`);
    expect(relative(repo, wouldRead).startsWith('..')).toBe(true); // outside the repo
    mkdirSync(dirname(wouldRead), { recursive: true });
    writeFileSync(wouldRead, 'web 424242\napi 434343\n');

    const killImpl = vi.fn();
    const gitImpl = vi.fn(async () => {});
    const r = await downWorktree({ slug, cwd: repo, remove: true }, { killImpl, gitImpl });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('invalid-slug');
    // Nothing reaped ⇒ the foreign file was never read.
    expect(killImpl).not.toHaveBeenCalled();
    // And --remove never reached git, so no worktree or branch was destroyed.
    expect(gitImpl).not.toHaveBeenCalled();
  });

  it('reaps normally for a valid slug — the guard is not simply refusing everything', async () => {
    writeFileSync(join(repo, '.noldor', 'dev-real-feature.pids'), 'web 424242\napi 434343\n');
    const killImpl = vi.fn((pid: number, signal: NodeJS.Signals | 0) => {
      if (signal === 0) return; // leader is "alive"
    });
    const gitImpl = vi.fn(async () => {});
    const r = await downWorktree({ slug: 'real-feature', cwd: repo }, { killImpl, gitImpl });

    expect(r).toEqual({ ok: true, reaped: 2 });
    expect(killImpl).toHaveBeenCalled();
  });
});

describe('downWorktree refuses a pid file it cannot read safely', () => {
  it('refuses a symlinked pids file at the path guard, before the read', async () => {
    const outside = join(base, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'foreign.pids'), 'web 424242\n');
    symlinkSync(join(outside, 'foreign.pids'), join(repo, '.noldor', 'dev-real-feature.pids'));

    const killImpl = vi.fn();
    const gitImpl = vi.fn(async () => {});
    const r = await downWorktree(
      { slug: 'real-feature', cwd: repo, remove: true },
      { killImpl, gitImpl },
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    // The path guard sees it first, so the read never runs at all.
    expect(r.error.kind).toBe('unsafe-symlink');
    expect(killImpl).not.toHaveBeenCalled();
    expect(gitImpl).not.toHaveBeenCalled();
  });

  it('refuses an unreadable pids file rather than reaping nothing silently', async () => {
    // Reaches the READ branch: lstat sees a regular file, the open then fails
    // with EACCES. Folding that into "no pids" is fail-safe for the kill but
    // NOT for --remove, which would tear the worktree down while its servers
    // keep running, with "0 reaped" as the only signal.
    const pids = join(repo, '.noldor', 'dev-real-feature.pids');
    writeFileSync(pids, 'web 424242\n');
    chmodSync(pids, 0o000);

    const killImpl = vi.fn();
    const gitImpl = vi.fn(async () => {});
    try {
      const r = await downWorktree(
        { slug: 'real-feature', cwd: repo, remove: true },
        { killImpl, gitImpl },
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.kind).toBe('uninspectable');
      expect(killImpl).not.toHaveBeenCalled();
      expect(gitImpl).not.toHaveBeenCalled();
    } finally {
      chmodSync(pids, 0o644);
    }
  });

  it('still treats a simply-absent pids file as nothing to reap', async () => {
    const gitImpl = vi.fn(async () => {});
    const r = await downWorktree(
      { slug: 'never-booted', cwd: repo, remove: true },
      { killImpl: vi.fn(), gitImpl },
    );
    expect(r).toEqual({ ok: true, reaped: 0 });
    expect(gitImpl).toHaveBeenCalled(); // ENOENT is benign — removal proceeds
  });
});
