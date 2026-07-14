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

/**
 * Liveness probe: true iff `pid` names a live process. `process.kill(pid, 0)`
 * sends no signal — it only checks deliverability. EPERM = the process exists but
 * is owned by another user → still alive; ESRCH (and anything else) = no such
 * process → dead. Exported so the startup reconciliation pass
 * ({@link ../drain-reconcile}) can reuse the exact same probe the lock reclaim
 * uses, rather than forking a second definition.
 */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * The pid recorded in `.noldor/drain.lock` iff that process is currently alive,
 * else `null` (no lock, unreadable/garbage payload, or a dead holder). The
 * liveness probe matches {@link acquireLock}'s own reclaim test, so a `null`
 * here means `acquireLock` would succeed (the lock is free or reclaimable). Used
 * by the `--detach` launcher to refuse starting a second daemon and surface the
 * live pid instead of spawning a child that just loses the lock race.
 *
 * @param cwd - Repo root (the worktree's main workspace).
 */
export function liveLockPid(cwd: string): number | null {
  let holder: { pid: number } | null;
  try {
    holder = JSON.parse(readFileSync(join(cwd, LOCK_REL), 'utf8')) as { pid: number };
  } catch {
    return null; // no lock or unreadable payload
  }
  if (holder && typeof holder.pid === 'number' && isAlive(holder.pid)) return holder.pid;
  return null;
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

/**
 * Remove the drain lock — but only when this process actually owns it. Reads the
 * on-disk `{ pid, startedAt }` payload and unlinks **only if** `pid` matches this
 * process (and `startedAt` matches `token.startedAt` when a token is supplied,
 * closing the PID-reuse window). A foreign, missing, or unparseable lock is a
 * no-op — idempotent as before, minus the fail-open delete-by-path.
 *
 * The ownership check is what makes the top-level crash handlers safe: a `main()`
 * that throws BEFORE {@link acquireLock} still reaches its `.catch → releaseLock`,
 * but the on-disk lock then belongs to a *different* live supervisor (different
 * pid), so the release no-ops instead of freeing a mutex this process never held.
 * The old unconditional `unlinkSync` silently freed that live owner's lock → two
 * concurrent supervisors draining one repo.
 *
 * @param cwd - Repo root (the worktree's main workspace).
 * @param token - Acquire-time identity (`{ startedAt }`) matched in addition to
 *   pid; omit at sites that cannot see it (the module-scope crash handler), where
 *   the pid check alone still prevents a foreign delete.
 */
export function releaseLock(cwd: string, token?: { startedAt: string }): void {
  const lockPath = join(cwd, LOCK_REL);
  let holder: { pid?: number; startedAt?: string } | null;
  try {
    holder = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: number; startedAt?: string };
  } catch {
    return; // no lock, or unreadable payload — nothing this process owns to remove
  }
  if (!holder || holder.pid !== process.pid) return; // foreign owner — never touch
  if (token && holder.startedAt !== token.startedAt) return; // pid reused — not our lock
  try {
    unlinkSync(lockPath);
  } catch {
    /* already gone */
  }
}
