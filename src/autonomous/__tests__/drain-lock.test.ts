// @tests: acceptance-verify-lane, autonomous-queue-drain-runner, consumer-contract-ci-and-headless-gate-e2e-harness, drain-startup-reconciliation-of-a-prior-dead-run
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock, releaseLock } from '../drain-lock.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drain-lock-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('drain lock', () => {
  it('acquires when no lock exists', () => {
    expect(acquireLock(dir).ok).toBe(true);
    expect(existsSync(join(dir, '.noldor/drain.lock'))).toBe(true);
  });

  it('refuses when held by a live pid', () => {
    acquireLock(dir);
    expect(acquireLock(dir).ok).toBe(false); // current process is alive → contention
  });

  it('reclaims a lock whose holder pid is dead', () => {
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    writeFileSync(
      join(dir, '.noldor/drain.lock'),
      JSON.stringify({ pid: 2147483646, startedAt: 't' }), // pid that cannot exist
    );
    expect(acquireLock(dir).ok).toBe(true);
  });

  it('releaseLock removes the lock', () => {
    acquireLock(dir);
    releaseLock(dir);
    expect(existsSync(join(dir, '.noldor/drain.lock'))).toBe(false);
  });

  it('releaseLock leaves a foreign-owned lock intact (the pre-acquire crash-handler case)', () => {
    // A different live supervisor's lock: a non-owner releaseLock must not free it.
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    writeFileSync(
      join(dir, '.noldor/drain.lock'),
      JSON.stringify({ pid: 2147483646, startedAt: 'other' }), // pid !== process.pid
    );
    releaseLock(dir);
    expect(existsSync(join(dir, '.noldor/drain.lock'))).toBe(true);
  });

  it('releaseLock with a mismatched startedAt token is a no-op (PID reuse guard)', () => {
    acquireLock(dir, 'T1'); // writes { pid: process.pid, startedAt: 'T1' }
    releaseLock(dir, { startedAt: 'T2' }); // same pid, different run → not ours
    expect(existsSync(join(dir, '.noldor/drain.lock'))).toBe(true);
    releaseLock(dir, { startedAt: 'T1' }); // matching token → removed
    expect(existsSync(join(dir, '.noldor/drain.lock'))).toBe(false);
  });
});
