// @fd: memory-intake-lessons-learned-pipeline

import { execFileSync, spawnSync } from 'node:child_process';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

/**
 * Fetch `origin/main` and fast-forward the checked-out `main` to it, parking
 * uncommitted edits with `--autostash` and re-applying them afterwards. The
 * session retro leaves a tracked `ideas.md` modified on `main` after every
 * merge, and a plain `--ff-only` refuses whenever an incoming commit touches it.
 *
 * Throws when `main` has diverged (as plain `--ff-only` does), and when the
 * re-apply conflicts. Git reports that second case with exit 0 and leaves the
 * file half-merged, so it is detected here; the message names the stash SHA
 * because the stash stack is shared by every worktree and session.
 */
export function ffSyncMain(cwd: string): void {
  git(cwd, ['fetch', 'origin', 'main']);
  const merge = spawnSync('git', ['merge', '--ff-only', '--autostash', 'origin/main'], {
    cwd,
    encoding: 'utf8',
  });
  const output = `${merge.stdout}${merge.stderr}`;
  if (merge.status !== 0) {
    throw new Error(`git merge --ff-only origin/main failed: ${output.trim()}`);
  }
  const conflicted = git(cwd, ['diff', '--name-only', '--diff-filter=U']);
  if (conflicted === '') return;
  const short = /Created autostash: ([0-9a-f]+)/.exec(output)?.[1];
  const sha = short === undefined ? '(not reported)' : git(cwd, ['rev-parse', short]);
  throw new Error(
    `local main synced, but re-applying uncommitted edits conflicted in ${conflicted.split('\n').join(', ')}; ` +
      `they are safe in stash ${sha} — resolve the files, or 'git checkout -- <files> && git stash apply ${sha}'`,
  );
}
