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
}
export interface DownDeps {
  killImpl: (pid: number, signal: NodeJS.Signals) => void;
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
      deps.killImpl(-pid, 'SIGKILL'); // negative = process group
    } catch {
      /* already exited */
    }
  }
  await rm(pidsFile, { force: true });

  if (opts.remove) {
    await deps.gitImpl(['worktree', 'remove', '--force', join('.worktrees', opts.slug)], opts.cwd);
    await deps.gitImpl(['branch', '-D', `feat/${opts.slug}`], opts.cwd).catch(() => {});
  }
  return { reaped };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('-'));
  if (!slug) {
    process.stderr.write('usage: noldor worktrees down <slug> [--remove]\n');
    return 2;
  }
  const r = await downWorktree({ slug, cwd: process.cwd(), remove: argv.includes('--remove') });
  process.stdout.write(`Reaped ${r.reaped} dev surface(s) for ${slug}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
