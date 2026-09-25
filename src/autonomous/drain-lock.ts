// The drain lock, and the pid lock primitive it shares with the suite lock
// (`src/testing/suite-lock.ts`). Node builtins only: vitest loads the suite lock,
// and so this module, as a globalSetup through vite-node, which could not resolve
// a package import from it when the setup ran for a project rooted outside this repo.
import { randomUUID } from 'node:crypto';
import {
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
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
 * here means `acquireLock` would succeed (the lock is free or reclaimable) unless
 * another supervisor holds the reclaim claim on it. Used
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
 * A lock file's payload. Only `pid` is required on read: the process that wrote
 * it may run a different version of this module, and liveness is decided by the
 * pid alone, so a missing display field must never make a live lock look
 * reclaimable. The drain lock writes `pid` and `startedAt`; the suite lock adds
 * the `worktree` it runs in.
 */
export interface LockHolder {
  pid: number;
  startedAt?: string;
  worktree?: string;
}

/**
 * What an attempt is held off by. `claim` names another process's reclaim claim
 * on a dead holder's lock — `holder` is then that dead holder, when its payload
 * was readable. A live reclaim holds its claim for microseconds, so one still
 * there a minute later was stranded by a process that died mid-reclaim.
 */
export interface HeldBy {
  holder?: LockHolder;
  claim?: string;
}

/** One attempt at the lock. `held` with neither field means a concurrent reclaim won; ask again. */
export type TryAcquireResult =
  | { kind: 'acquired' }
  | { kind: 'own' }
  | ({ kind: 'held' } & HeldBy)
  | { kind: 'failed'; reason: string };

/** A lock file's holder as read from disk, or why there is none. */
export type SeenHolder = LockHolder | 'absent' | 'unreadable';

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

/**
 * Take the lock at `lockPath` once, without waiting.
 *
 * The payload is written to a staged file and hard-linked into place, so the lock
 * appears with its content in one step: `link` fails with `EEXIST` while a lock
 * exists. Creating it with `openSync(path, 'wx')` and writing the payload after
 * leaves a window in which a reader sees an empty file and reclaims a live lock —
 * which simultaneous starts hit. `own` means the payload already names this
 * process. Any file-system error comes back as `failed`.
 */
export function tryAcquire(lockPath: string, self: LockHolder): TryAcquireResult {
  try {
    using staged = removedOnDispose(`${lockPath}.${self.pid}.${randomUUID()}.tmp`);
    writeFileSync(staged.path, JSON.stringify(self), { flag: 'wx' });
    return publish(lockPath, staged.path, self);
  } catch (err) {
    return { kind: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}

function publish(lockPath: string, staged: string, self: LockHolder): TryAcquireResult {
  if (linkIfAbsent(staged, lockPath)) return { kind: 'acquired' };
  const seen = readHolder(lockPath);
  if (seen === 'absent')
    return linkIfAbsent(staged, lockPath) ? { kind: 'acquired' } : { kind: 'held' };
  if (seen !== 'unreadable') {
    if (seen.pid === self.pid) return { kind: 'own' };
    if (isAlive(seen.pid)) return { kind: 'held', holder: seen };
  }
  return replaceDead(lockPath, staged, seen === 'unreadable' ? undefined : seen);
}

/**
 * Replace a dead holder's lock with the staged one. Moving the dead lock aside and
 * checking what moved does not work: until a wrong move is undone the path is free,
 * and another process can take it while a live lock sits aside. Instead the lock is
 * hard-linked to a claim named after its inode — a name only one process can hold at
 * a time, and a link that keeps the inode from being reused — and its holder is
 * judged again through the claim. A dead holder cannot release and no other process
 * can claim that inode, so once the lock is confirmed still in place it stays there
 * until the rename swaps ours in, and the path is never free.
 */
function replaceDead(
  lockPath: string,
  staged: string,
  dead: LockHolder | undefined,
): TryAcquireResult {
  const lost = { kind: 'held' } as const;
  const ino = inodeOf(lockPath);
  if (ino === undefined) return lost;
  const claimPath = `${lockPath}.reclaim.${ino}`;
  // noldor:cut a claim is never broken, so a process killed between the claim and the
  // rename strands it: later suites wait out their 15-minute bound and later drains
  // refuse to start, each naming the claim — upgrade to a kernel-released lock (flock
  // through a helper process) if that is ever seen.
  try {
    linkSync(lockPath, claimPath);
  } catch (err) {
    if (errno(err) === 'EEXIST')
      return { kind: 'held', claim: claimPath, ...(dead === undefined ? {} : { holder: dead }) };
    if (errno(err) === 'ENOENT') return lost;
    throw err;
  }
  using claim = removedOnDispose(claimPath);
  if (inodeOf(claim.path) !== ino) return lost;
  const holder = readHolder(claim.path);
  if (typeof holder === 'object' && isAlive(holder.pid)) return lost;
  if (inodeOf(lockPath) !== ino) return lost;
  renameSync(staged, lockPath);
  return { kind: 'acquired' };
}

/** The holder named by the lock file at `path`; a read error other than `ENOENT` throws. */
export function readHolder(path: string): SeenHolder {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if (errno(err) === 'ENOENT') return 'absent';
    throw err;
  }
  return parseHolder(raw) ?? 'unreadable';
}

function parseHolder(raw: string): LockHolder | undefined {
  const value = parseJson(raw);
  if (typeof value !== 'object' || value === null) return undefined;
  const { pid, startedAt, worktree } = value as Record<string, unknown>;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return undefined;
  return {
    pid,
    ...(typeof startedAt === 'string' ? { startedAt } : {}),
    ...(typeof worktree === 'string' ? { worktree } : {}),
  };
}

function inodeOf(path: string): bigint | undefined {
  return statSync(path, { bigint: true, throwIfNoEntry: false })?.ino;
}

function removedOnDispose(path: string): { path: string } & Disposable {
  return { path, [Symbol.dispose]: () => rmSync(path, { force: true }) };
}

function linkIfAbsent(from: string, to: string): boolean {
  try {
    linkSync(from, to);
    return true;
  } catch (err) {
    if (errno(err) === 'EEXIST') return false;
    throw err;
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function errno(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException).code;
}
