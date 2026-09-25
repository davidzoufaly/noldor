// @fd: test-suites-read-live-repo-state-shifting-full-suite-failures
// One full vitest run at a time across every worktree of this repo. Each run
// sizes its worker pool from the core count, so two or three concurrent full
// suites oversubscribe the machine and the heaviest tests cross the 10s
// `testTimeout` — the shifting full-suite flake. Wired as a `globalSetup` in
// `vitest.config.ts`; `NOLDOR_SUITE_LOCK=0` turns it off, which the
// reproduction recipe in the feature doc relies on.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  readHolder,
  tryAcquire,
  type HeldBy,
  type LockHolder,
  type SeenHolder,
} from '../autonomous/drain-lock.js';

export { tryAcquire };

/** The lock's file name inside the repository's git common dir. */
export const SUITE_LOCK_FILE = 'noldor-suite.lock';

/** Remove the lock only while its payload is still `self` — never another suite's lock. */
export function releaseSuiteLock(lockPath: string, self: LockHolder): void {
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
    case 'own': // vitest runs global setup once per project
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

function deadHolderText(holder: LockHolder | undefined): string {
  return holder === undefined ? '' : ` on the lock of exited pid ${holder.pid}`;
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

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function warn(message: string): void {
  process.stderr.write(`suite lock: ${message}\n`);
}

function noop(): void {}
