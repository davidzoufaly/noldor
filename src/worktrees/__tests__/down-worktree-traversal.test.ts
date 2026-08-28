// @tests: unvalidated-slug-path-traversal-across-cli-entry-points
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
