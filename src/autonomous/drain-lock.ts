import {
  openSync,
  closeSync,
  writeSync,
  readFileSync,
  renameSync,
  unlinkSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';

const LOCK_REL = '.noldor/drain.lock';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = the process exists but is owned by another user → still alive.
    // ESRCH (and anything else) = no such process → dead.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Acquire the exclusive drain lock at `.noldor/drain.lock` via an atomic `O_EXCL`
 * create. If a lock already exists: held by a live pid → refuse; held by a dead /
 * garbage pid → reclaim TOCTOU-safely by renaming the stale lock **aside** (the
 * loser of a simultaneous reclaim race gets `ENOENT` on its rename), then
 * `O_EXCL`-create a fresh lock.
 *
 * @param cwd - Repo root (the worktree's main workspace).
 * @param now - ISO timestamp recorded in the lock payload (injected; '' in tests).
 */
export function acquireLock(cwd: string, now = ''): { ok: boolean; reason?: string } {
  const lockPath = join(cwd, LOCK_REL);
  mkdirSync(join(cwd, '.noldor'), { recursive: true });
  const payload = JSON.stringify({ pid: process.pid, startedAt: now });
  try {
    const fd = openSync(lockPath, 'wx'); // O_EXCL
    writeSync(fd, payload);
    closeSync(fd);
    return { ok: true };
  } catch {
    let holder: { pid: number } | null = null;
    try {
      holder = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number };
    } catch {
      holder = null;
    }
    if (holder && isAlive(holder.pid)) return { ok: false, reason: 'held by live pid' };
    // Dead / garbage holder → reclaim by renaming ASIDE, then O_EXCL-create fresh.
    const aside = `${lockPath}.reclaim.${process.pid}`;
    try {
      renameSync(lockPath, aside); // loser of a concurrent reclaim throws ENOENT
    } catch {
      return { ok: false, reason: 'lost reclaim race' };
    }
    try {
      unlinkSync(aside);
    } catch {
      /* ignore */
    }
    try {
      const fd = openSync(lockPath, 'wx'); // a third racer could re-create between unlink + here
      writeSync(fd, payload);
      closeSync(fd);
      return { ok: true };
    } catch {
      return { ok: false, reason: 'lost reclaim race' };
    }
  }
}

/** Remove the drain lock. Idempotent — a missing lock is not an error. */
export function releaseLock(cwd: string): void {
  try {
    unlinkSync(join(cwd, LOCK_REL));
  } catch {
    /* already gone */
  }
}
