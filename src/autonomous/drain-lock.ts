// The drain lock: one autonomous supervisor per repo, held at `.noldor/drain.lock`
// through the shared pid lock primitive (`src/core/pid-lock.ts`).
import { mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { isAlive, readHolderOrAbsent, tryAcquire } from '../core/pid-lock.js';

const LOCK_REL = '.noldor/drain.lock';

/**
 * The pid recorded in `.noldor/drain.lock` iff that process is currently alive,
 * else `null` (no lock, unreadable/garbage payload, or a dead holder). The
 * liveness probe matches {@link acquireLock}'s own reclaim test, so a `null`
 * here means `acquireLock` would succeed (the lock is free or reclaimable) unless
 * another supervisor holds the reclaim claim on it. Used
 * by the `--detach` launcher to refuse starting a second daemon and surface the
 * live pid instead of spawning a child that just loses the lock race.
 *
 * @param cwd - Repo root (the worktree's main workspace).
 */
export function liveLockPid(cwd: string): number | null {
  const holder = readHolderOrAbsent(join(cwd, LOCK_REL));
  return typeof holder === 'object' && isAlive(holder.pid) ? holder.pid : null;
}

/**
 * Acquire the exclusive drain lock at `.noldor/drain.lock` through
 * {@link tryAcquire}: the lock appears with its payload in one step, and a dead
 * holder's lock is replaced without the path ever being free. Refuses while a
 * live process holds it — this one included — and while another supervisor holds
 * the reclaim claim on a dead holder's lock. That refusal names the claim: one
 * left by a supervisor that died mid-reclaim blocks every later start until it is
 * deleted.
 *
 * @param cwd - Repo root (the worktree's main workspace).
 * @param now - ISO timestamp recorded in the lock payload (injected; '' in tests).
 */
export function acquireLock(cwd: string, now = ''): { ok: boolean; reason?: string } {
  const lockPath = join(cwd, LOCK_REL);
  mkdirSync(join(cwd, '.noldor'), { recursive: true });
  const attempt = tryAcquire(lockPath, { pid: process.pid, startedAt: now });
  if (attempt.kind === 'acquired') return { ok: true };
  if (attempt.kind === 'failed')
    return { ok: false, reason: `could not take ${lockPath}: ${attempt.reason}` };
  if (attempt.kind === 'held' && attempt.claim !== undefined)
    return {
      ok: false,
      reason:
        `another supervisor is reclaiming the lock (claim ${attempt.claim}) — ` +
        'if the claim is still there in a minute, that supervisor died: delete it and retry',
    };
  if (attempt.kind === 'held' && attempt.holder === undefined)
    return { ok: false, reason: 'lost reclaim race' };
  return { ok: false, reason: 'held by live pid' };
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
  // Swallows read errors too: this runs in crash handlers, which must not throw.
  const holder = readHolderOrAbsent(lockPath);
  if (typeof holder !== 'object') return; // no lock, or unreadable payload — nothing this process owns to remove
  if (holder.pid !== process.pid) return; // foreign owner — never touch
  if (token && holder.startedAt !== token.startedAt) return; // pid reused — not our lock
  try {
    unlinkSync(lockPath);
  } catch {
    /* already gone */
  }
}
