// @fd: memory-intake-lessons-learned-pipeline

import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { isEntrypoint } from '../core/cli-entry.js';
import { acquirePidLock, isAlive, readHolderOrAbsent, releasePidLock } from '../core/pid-lock.js';
import { gitCommonDir, IDEAS_LOCK_FILE } from './retro-cli.js';

const LABEL = 'ideas-lock';
const USAGE =
  'usage: noldor triage ideas-lock acquire [--minutes <n>] | release\n' +
  '  acquire holds the ideas.md lock for <n> minutes (default 30, max 120) or until release\n';
const DEFAULT_MINUTES = 30;
const MAX_MINUTES = 120;

/** Injectable context for tests: the directory the command runs in and how long acquire waits. */
export interface IdeasLockContext {
  cwd?: string;
  waitMs?: number;
}

/**
 * A skill or a hand edit cannot hold a pid lock across its edits — every
 * `pnpm noldor` call exits at once, and a lock naming a dead pid is free for
 * the taking. So `acquire` starts a detached sleeper and names it as the holder:
 * the lock lives exactly as long as that process, which lapses on its own when
 * the session forgets to release, and `release` ends it.
 */
async function acquire(lockPath: string, minutes: number, waitMs: number): Promise<number> {
  const ms = minutes * 60_000;
  const sleeper = spawn(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`], {
    detached: true,
    stdio: 'ignore',
  });
  sleeper.unref();
  if (sleeper.pid === undefined) {
    process.stderr.write(`${LABEL}: could not start the lock holder\n`);
    return 1;
  }
  const startedAt = new Date();
  const holdUntil = new Date(startedAt.getTime() + ms).toISOString();
  const self = { pid: sleeper.pid, startedAt: startedAt.toISOString(), holdUntil };
  const lock = await acquirePidLock(lockPath, self, { timeoutMs: waitMs, pollMs: 100 });
  if (lock.kind !== 'acquired') {
    sleeper.kill();
    const why =
      lock.kind === 'timed-out'
        ? `held by pid ${lock.holder?.pid ?? '?'}`
        : lock.kind === 'failed'
          ? lock.reason
          : 'own';
    process.stderr.write(`${LABEL}: could not lock ${lockPath} (${why}); retry shortly\n`);
    return 1;
  }
  process.stdout.write(
    `${LABEL}: held until ${holdUntil} — run \`pnpm noldor triage ideas-lock release\` after the last ideas.md edit\n`,
  );
  return 0;
}

/** Release only a hold `acquire` took: a lock without `holdUntil` is a retro mid-write. */
function release(lockPath: string): number {
  const holder = readHolderOrAbsent(lockPath);
  if (holder === 'absent') {
    process.stdout.write(`${LABEL}: not held\n`);
    return 0;
  }
  if (holder === 'unreadable' || holder.holdUntil === undefined) {
    const who = holder === 'unreadable' ? 'an unreadable holder' : `pid ${holder.pid}`;
    process.stderr.write(`${LABEL}: ${lockPath} is held by ${who}, not by a hold; left in place\n`);
    return 1;
  }
  if (Date.parse(holder.holdUntil) > Date.now() && isAlive(holder.pid)) {
    try {
      process.kill(holder.pid, 'SIGTERM');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
        const reason = err instanceof Error ? err.message : String(err);
        process.stderr.write(`${LABEL}: could not stop pid ${holder.pid}: ${reason}\n`);
        return 1;
      }
    }
  }
  releasePidLock(lockPath, holder);
  process.stdout.write(`${LABEL}: released\n`);
  return 0;
}

function parseMinutes(argv: readonly string[]): number | string {
  if (argv.length === 0) return DEFAULT_MINUTES;
  if (argv.length !== 2 || argv[0] !== '--minutes') return `unexpected argument ${argv.join(' ')}`;
  const minutes = Number(argv[1]);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
    return `--minutes must be a whole number from 1 to ${MAX_MINUTES}`;
  }
  return minutes;
}

/**
 * CLI entrypoint for `noldor triage ideas-lock`. Takes or drops the same
 * cross-worktree lock `noldor triage retro` writes under, so `/noldor-triage`,
 * `/noldor-absorb` and a hand edit of `ideas.md` cannot lose a retro's write
 * (or have theirs lost). Exit 0 done, 2 usage, 1 lock held or I/O.
 */
export async function main(argv: readonly string[], ctx: IdeasLockContext = {}): Promise<number> {
  const [verb, ...rest] = argv;
  const parsed =
    verb === 'acquire'
      ? parseMinutes(rest)
      : verb === 'release'
        ? rest.length === 0
          ? 0
          : 'release takes no arguments'
        : `unknown verb ${verb ?? '(none)'}`;
  if (typeof parsed === 'string') {
    process.stderr.write(`${LABEL}: ${parsed}\n${USAGE}`);
    return 2;
  }
  const common = gitCommonDir(ctx.cwd ?? process.cwd());
  if (!common.success) {
    process.stderr.write(`${LABEL}: not inside a git repository (${common.errors.join('; ')})\n`);
    return 1;
  }
  const lockPath = join(common.data, IDEAS_LOCK_FILE);
  if (verb === 'release') return release(lockPath);
  return acquire(lockPath, parsed, ctx.waitMs ?? 30_000);
}

if (isEntrypoint(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
