// @tests: per-task-dev-environment-bootstrap
import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';

import { pathErrorMessage, type PathError } from '../core/slug-paths.js';
import type { SlugError } from '../core/slug.js';
import { resolveWorktree } from './worktree-paths.js';

const execFileP = promisify(execFile);

/** Why a worktree operation refused its slug before doing anything. */
export type WorktreeRefusal = SlugError | PathError;

/** Human-readable reason for a {@link WorktreeRefusal}, for a CLI's stderr. */
export function refusalMessage(error: WorktreeRefusal): string {
  return error.kind === 'invalid-slug' ? error.message : pathErrorMessage(error);
}

export interface DownOptions {
  slug: string;
  cwd: string;
  remove?: boolean;
  /** Branch to delete with `--remove`; defaults to `feat/<slug>` (mirrors `up`). */
  branch?: string;
}
export interface DownDeps {
  killImpl: (pid: number, signal: NodeJS.Signals | 0) => void;
  gitImpl: (args: string[], cwd: string) => Promise<void>;
}

const defaultDeps: DownDeps = {
  killImpl: (pid, signal) => process.kill(pid, signal),
  gitImpl: async (args, cwd) => {
    await execFileP('git', args, { cwd });
  },
};

/**
 * Reap the long-running dev surfaces booted by `worktrees up`: SIGKILL each
 * recorded process group, tolerating already-dead pids, then delete the pids
 * file. With `remove`, also remove the worktree + delete its branch.
 */
export async function downWorktree(
  opts: DownOptions,
  deps: DownDeps = defaultDeps,
): Promise<{ ok: true; reaped: number } | { ok: false; error: WorktreeRefusal }> {
  // Every side effect below — the pid read, the process-group kills, the git
  // worktree removal — is keyed on the slug, so the parse and both path builds
  // happen before any of them run.
  const resolved = resolveWorktree(opts.cwd, opts.slug);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const pidsFile = resolved.pids;
  let reaped = 0;
  const body = await readFile(pidsFile, 'utf8').catch(() => '');
  for (const line of body.split('\n').filter(Boolean)) {
    const pid = Number(line.split(/\s+/)[1]);
    if (!Number.isFinite(pid)) continue;
    reaped++;
    try {
      // Liveness-check the group leader (signal 0) before the group SIGKILL.
      // A stale pidfile (reboot / PID reuse) would otherwise group-kill an
      // unrelated live process group via the negative pid. If the leader is
      // already gone, skip the group kill entirely.
      deps.killImpl(pid, 0);
    } catch {
      continue; // leader gone — nothing to reap, don't risk a reused group
    }
    try {
      deps.killImpl(-pid, 'SIGKILL'); // negative = process group
    } catch {
      /* already exited */
    }
  }
  await rm(pidsFile, { force: true });

  if (opts.remove) {
    // The branch name is slug-derived but is a git ref, not a path, so no
    // builder covers it — the parse above is what makes it safe.
    const branch = opts.branch ?? `feat/${resolved.slug}`;
    await deps.gitImpl(['worktree', 'remove', '--force', resolved.tree], opts.cwd);
    await deps.gitImpl(['branch', '-D', branch], opts.cwd).catch(() => {});
  }
  return { ok: true, reaped };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('-'));
  if (!slug) {
    process.stderr.write('usage: noldor worktrees down <slug> [--remove] [--branch <name>]\n');
    return 2;
  }
  const branchIdx = argv.indexOf('--branch');
  const branch = branchIdx >= 0 ? argv[branchIdx + 1] : undefined;
  const r = await downWorktree({
    slug,
    cwd: process.cwd(),
    remove: argv.includes('--remove'),
    ...(branch ? { branch } : {}),
  });
  if (!r.ok) {
    process.stderr.write(`${refusalMessage(r.error)}\n`);
    return 1;
  }
  process.stdout.write(`Reaped ${r.reaped} dev surface(s) for ${slug}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
