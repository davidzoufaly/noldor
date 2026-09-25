// @fd: test-suites-read-live-repo-state-shifting-full-suite-failures
// One full vitest run at a time across every worktree of this repo. Each run
// sizes its worker pool from the core count, so two or three concurrent full
// suites oversubscribe the machine and the heaviest tests cross the 10s
// `testTimeout` — the shifting full-suite flake. Wired as a `globalSetup` in
// `vitest.config.ts`; `NOLDOR_SUITE_LOCK=0` turns it off, which the
// reproduction recipe in the feature doc relies on.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { linkSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { isAlive } from '../autonomous/drain-lock.js';

/** The lock's file name inside the repository's git common dir. */
export const SUITE_LOCK_FILE = 'noldor-suite.lock';

/**
 * The lock file's payload. Only `pid` is required on read: a worktree on another
 * branch may run a different version of this module, and liveness is decided by
 * the pid alone, so a missing display field must never make a live lock look
 * reclaimable.
 */
export interface SuiteLockHolder {
  pid: number;
  startedAt?: string;
  worktree?: string;
}

/**
 * What a wait is queued behind. `claim` names another suite's reclaim claim on a dead
 * holder's lock — `holder` is then that dead holder, when its payload was readable. A
 * live reclaim holds its claim for microseconds, so one still there across a long wait
 * was stranded by a suite that died mid-reclaim.
 */
export interface HeldBy {
  holder?: SuiteLockHolder;
  claim?: string;
}

/** One attempt at the lock. `held` with neither field means a concurrent reclaim won; ask again. */
export type TryAcquireResult =
  | { kind: 'acquired' }
  | { kind: 'own' }
  | ({ kind: 'held' } & HeldBy)
  | { kind: 'failed'; reason: string };

type SeenHolder = SuiteLockHolder | 'absent' | 'unreadable';

/**
 * Take the lock at `lockPath` once, without waiting.
 *
 * The payload is written to a staged file and hard-linked into place, so the lock
 * appears with its content in one step: `link` fails with `EEXIST` while a lock
 * exists. The drain lock's `openSync(path, 'wx')`-then-write leaves a window in
 * which a reader sees an empty file and reclaims a live lock — which simultaneous
 * suite starts would hit. `own` means the payload already names this process
 * (vitest runs global setup once per project). Any file-system error comes back as
 * `failed`, which the caller turns into an unlocked run.
 */
export function tryAcquire(lockPath: string, self: SuiteLockHolder): TryAcquireResult {
  try {
    using staged = removedOnDispose(`${lockPath}.${self.pid}.${randomUUID()}.tmp`);
    writeFileSync(staged.path, JSON.stringify(self), { flag: 'wx' });
    return publish(lockPath, staged.path, self);
  } catch (err) {
    return { kind: 'failed', reason: errorText(err) };
  }
}

function publish(lockPath: string, staged: string, self: SuiteLockHolder): TryAcquireResult {
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
 * and another suite can take it while a live lock sits aside. Instead the lock is
 * hard-linked to a claim named after its inode — a name only one suite can hold at a
 * time, and a link that keeps the inode from being reused — and its holder is judged
 * again through the claim. A dead holder cannot release and no other suite can claim
 * that inode, so once the lock is confirmed still in place it stays there until the
 * rename swaps ours in, and the path is never free.
 */
function replaceDead(
  lockPath: string,
  staged: string,
  dead: SuiteLockHolder | undefined,
): TryAcquireResult {
  const lost = { kind: 'held' } as const;
  const ino = inodeOf(lockPath);
  if (ino === undefined) return lost;
  const claimPath = `${lockPath}.reclaim.${ino}`;
  // noldor:cut a claim is never broken, so a suite killed between the claim and the
  // rename strands it and later suites wait out the 15-minute bound, naming the claim
  // — upgrade to a kernel-released lock (flock through a helper process) if that is
  // ever seen.
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

/** Remove the lock only while its payload is still `self` — never another suite's lock. */
export function releaseSuiteLock(lockPath: string, self: SuiteLockHolder): void {
  try {
    if (sameHolder(readHolder(lockPath), self)) rmSync(lockPath, { force: true });
  } catch (err) {
    warn(`could not release ${lockPath}: ${errorText(err)}`);
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
export async function acquireSuiteLock(
  lockPath: string,
  self: SuiteLockHolder,
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
 * Why this run does not queue, or `null` when it takes the lock. Only a full,
 * non-watch run waits: a filtered run — file filters, `-t <name>`, `--changed`,
 * `--related` — is the everyday dev loop and must never sit behind a ~50s suite, and
 * watch mode would hold the lock for as long as it stays open. A `--shard` run still
 * queues: its worker pool is sized to every core, the very oversubscription the lock
 * exists to stop.
 */
export function suiteLockSkipReason(run: {
  env: string | undefined;
  watch: boolean;
  filters: readonly string[] | undefined;
  testNamePattern?: RegExp | string;
  changed?: boolean | string;
  related?: readonly string[];
}): 'disabled' | 'watch' | 'filtered' | null {
  if (run.env === '0') return 'disabled';
  if (run.watch) return 'watch';
  if (run.filters !== undefined && run.filters.length > 0) return 'filtered';
  if (run.testNamePattern !== undefined && String(run.testNamePattern) !== '') return 'filtered';
  if (run.changed !== undefined && run.changed !== false) return 'filtered';
  if (run.related !== undefined && run.related.length > 0) return 'filtered';
  return null;
}

/**
 * The part of vitest's `TestProject` this setup reads. `filenamePattern` is internal
 * in vitest 3.2.4 (set in `Vitest.start()` before global setup runs, `undefined`
 * without filters), so it is typed here rather than imported, and
 * `suite-lock.test.ts` pins its value against the installed vitest.
 */
interface GlobalSetupProject {
  config: {
    root: string;
    watch: boolean;
    testNamePattern?: RegExp | string;
    changed?: boolean | string;
    related?: string[];
  };
  vitest: { filenamePattern?: string[] };
}

/**
 * vitest `globalSetup`: queue this run behind any other full suite of the repo,
 * then hand vitest the release as its teardown. Never fails or hangs a run — a
 * wait past 15 minutes, or a lock that cannot be taken, prints why and runs
 * unqueued.
 */
export default async function setup(project: GlobalSetupProject): Promise<() => void> {
  const skip = suiteLockSkipReason({
    env: process.env.NOLDOR_SUITE_LOCK,
    watch: project.config.watch,
    filters: project.vitest.filenamePattern,
    testNamePattern: project.config.testNamePattern,
    changed: project.config.changed,
    related: project.config.related,
  });
  if (skip !== null) return noop;
  const location = resolveLockPath(project.config.root);
  if ('error' in location) {
    warn(`cannot locate the git common dir (${location.error}) — this run is not queued`);
    return noop;
  }
  const lockPath = location.path;
  const self = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    worktree: project.config.root,
  };
  const startedMs = Date.now();
  const outcome = await acquireSuiteLock(lockPath, self, {
    timeoutMs: 15 * 60_000,
    pollMs: 1000,
    onWait: ({ holder, claim }) =>
      warn(
        claim === undefined
          ? `waiting for the full suite in ${holder?.worktree ?? 'another checkout'} (pid ${holder?.pid}` +
              `${holder?.startedAt === undefined ? '' : `, running since ${holder.startedAt}`})`
          : `waiting on the reclaim claim ${claim}${deadHolderText(holder)} — ` +
              `if it is still there in a minute, the suite reclaiming it died; delete it and ${lockPath}`,
      ),
  });
  switch (outcome.kind) {
    case 'acquired': {
      if (outcome.waited) warn(`acquired after ${((Date.now() - startedMs) / 1000).toFixed(1)}s`);
      const release = (): void => releaseSuiteLock(lockPath, self);
      process.once('exit', release);
      return () => {
        process.removeListener('exit', release);
        release();
      };
    }
    case 'own':
      return noop;
    case 'timed-out':
      warn(
        outcome.claim !== undefined
          ? `the reclaim claim ${outcome.claim}${deadHolderText(outcome.holder)} blocked the lock for ` +
              `15 minutes — the suite reclaiming it died; running anyway; delete ${outcome.claim} and ${lockPath}`
          : outcome.holder !== undefined
            ? `still held by pid ${outcome.holder.pid} after 15 minutes — running anyway; ` +
              `if that process is not a test run, delete ${lockPath}`
            : `still held after 15 minutes — running anyway; if no test run is active, delete ${lockPath}`,
      );
      return noop;
    case 'failed':
      warn(`could not take ${lockPath} (${outcome.reason}) — this run is not queued`);
      return noop;
  }
}

function resolveLockPath(root: string): { path: string } | { error: string } {
  try {
    const commonDir = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 },
    ).trim();
    return { path: join(commonDir, SUITE_LOCK_FILE) };
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    return { error: stderr === undefined || stderr === '' ? errorText(err) : stderr };
  }
}

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

// No zod here: vitest loads this file as a globalSetup through vite-node, which
// could not resolve `zod` from it when the setup ran for a project rooted outside
// this repo — and the one field that matters is a positive integer.
function parseHolder(raw: string): SuiteLockHolder | undefined {
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

function deadHolderText(holder: SuiteLockHolder | undefined): string {
  return holder === undefined ? '' : ` on the lock of exited pid ${holder.pid}`;
}

function sameHeldBy(a: HeldBy, b: HeldBy): boolean {
  const holderMatches =
    a.holder === undefined ? b.holder === undefined : sameHolder(b.holder ?? 'absent', a.holder);
  return holderMatches && a.claim === b.claim;
}

function sameHolder(seen: SeenHolder, expected: SuiteLockHolder): boolean {
  return (
    typeof seen === 'object' && seen.pid === expected.pid && seen.startedAt === expected.startedAt
  );
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

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function warn(message: string): void {
  process.stderr.write(`suite lock: ${message}\n`);
}

function noop(): void {}
