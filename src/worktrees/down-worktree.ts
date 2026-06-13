// @tests: per-task-dev-environment-bootstrap
import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

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
): Promise<{ reaped: number }> {
  const pidsFile = join(opts.cwd, '.noldor', `dev-${opts.slug}.pids`);
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
    const branch = opts.branch ?? `feat/${opts.slug}`;
    await deps.gitImpl(['worktree', 'remove', '--force', join('.worktrees', opts.slug)], opts.cwd);
    await deps.gitImpl(['branch', '-D', branch], opts.cwd).catch(() => {});
  }
  return { reaped };
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
  process.stdout.write(`Reaped ${r.reaped} dev surface(s) for ${slug}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
