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
});
