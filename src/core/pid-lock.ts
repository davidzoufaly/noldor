// @fd: test-suites-read-live-repo-state-shifting-full-suite-failures
// The pid lock primitive every lock in the repo shares: the drain lock
// (`src/autonomous/drain-lock.ts`), the full-suite lock (`src/testing/suite-lock.ts`)
// and the `ideas.md` lock of `noldor triage retro` and `noldor triage ideas-lock`. Node builtins only: vitest loads
// the suite lock, and so this module, as a globalSetup through vite-node, which could
// not resolve a package import from it when the setup ran for a project rooted
// outside this repo.
import { randomUUID } from 'node:crypto';
import { linkSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Liveness probe: true iff `pid` names a live process. `process.kill(pid, 0)`
 * sends no signal — it only checks deliverability. EPERM = the process exists but
 * is owned by another user → still alive; ESRCH (and anything else) = no such
 * process → dead. Exported so the startup reconciliation pass
 * (`src/autonomous/drain-reconcile.ts`) can reuse the exact same probe the lock reclaim
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
 * A lock file's payload. Only `pid` is required on read: the process that wrote
 * it may run a different version of this module, and liveness is decided by the
 * pid alone, so a missing display field must never make a live lock look
 * reclaimable. The drain lock writes `pid` and `startedAt`; the suite lock adds
 * the `worktree` it runs in; an `ideas.md` hold adds the ISO time it lapses.
 */
export interface LockHolder {
  pid: number;
  startedAt?: string;
  worktree?: string;
  holdUntil?: string;
}

/**
 * What an attempt is held off by. `claim` names another process's reclaim claim
 * on a dead holder's lock — `holder` is then that dead holder, when its payload
 * was readable. A live reclaim holds its claim for microseconds, so one still
 * there a minute later was stranded by a process that died mid-reclaim.
 */
interface HeldBy {
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

/** Remove the lock only while its payload is still `self` — never another process's lock. */
export function releasePidLock(lockPath: string, self: LockHolder): void {
  try {
    if (sameHolder(readHolder(lockPath), self)) rmSync(lockPath, { force: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    process.stderr.write(`pid lock: could not release ${lockPath}: ${reason}\n`);
  }
}

/** How a bounded wait for the lock ended. */
export type AcquireOutcome =
  | { kind: 'acquired'; waited: boolean }
  | { kind: 'own' }
  | ({ kind: 'timed-out' } & HeldBy)
  | { kind: 'failed'; reason: string };

export interface AcquireOptions {
  timeoutMs: number;
  pollMs: number;
  signal?: AbortSignal;
  /** Called each time this wait starts queuing behind a different holder or claim. */
  onWait?: (by: HeldBy) => void;
}

/** Poll {@link tryAcquire} until the lock is ours, the deadline passes, or `signal` aborts. */
export async function acquirePidLock(
  lockPath: string,
  self: LockHolder,
  opts: AcquireOptions,
): Promise<AcquireOutcome> {
  const deadline = AbortSignal.any([
    AbortSignal.timeout(opts.timeoutMs),
    ...(opts.signal === undefined ? [] : [opts.signal]),
  ]);
  let announced: HeldBy = {};
  let waited = false;
  while (true) {
    const attempt = tryAcquire(lockPath, self);
    if (attempt.kind === 'acquired') return { kind: 'acquired', waited };
    if (attempt.kind !== 'held') return attempt;
    const { kind: _held, ...by } = attempt;
    if ((by.holder !== undefined || by.claim !== undefined) && !sameHeldBy(by, announced)) {
      announced = by;
      opts.onWait?.(by);
    }
    waited = true;
    try {
      await sleep(opts.pollMs, undefined, { signal: deadline });
    } catch (err) {
      if (!deadline.aborted) throw err;
      return { kind: 'timed-out', ...announced };
    }
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
function readHolder(path: string): SeenHolder {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if (errno(err) === 'ENOENT') return 'absent';
    throw err;
  }
  return parseHolder(raw) ?? 'unreadable';
}

/** {@link readHolder}, with any read error read as `absent`. */
export function readHolderOrAbsent(path: string): SeenHolder {
  try {
    return readHolder(path);
  } catch {
    return 'absent';
  }
}

function parseHolder(raw: string): LockHolder | undefined {
  const value = parseJson(raw);
  if (typeof value !== 'object' || value === null) return undefined;
  const { pid, startedAt, worktree, holdUntil } = value as Record<string, unknown>;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return undefined;
  return {
    pid,
    ...(typeof startedAt === 'string' ? { startedAt } : {}),
    ...(typeof worktree === 'string' ? { worktree } : {}),
    ...(typeof holdUntil === 'string' ? { holdUntil } : {}),
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

function sameHeldBy(a: HeldBy, b: HeldBy): boolean {
  const holderMatches =
    a.holder === undefined ? b.holder === undefined : sameHolder(b.holder ?? 'absent', a.holder);
  return holderMatches && a.claim === b.claim;
}

function sameHolder(seen: SeenHolder, expected: LockHolder): boolean {
  return (
    typeof seen === 'object' && seen.pid === expected.pid && seen.startedAt === expected.startedAt
  );
}
