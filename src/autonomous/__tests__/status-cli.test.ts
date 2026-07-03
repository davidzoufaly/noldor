// @tests: autonomous-queue-drain-runner
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readState, type DrainState } from '../drain-state.js';
import { collectStatus, formatStatus } from '../status-cli.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'status-cli-'));
  mkdirSync(join(dir, '.noldor'), { recursive: true });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const DEAD_PID = 2147483646; // pid that cannot exist (same sentinel as drain-lock.test)

function state(overrides: Partial<DrainState> = {}): DrainState {
  return {
    pid: DEAD_PID,
    startedAt: '2026-07-03T00:00:00Z',
    phase: 'spawning',
    inFlight: [{ slug: 'alpha', phase: 'building' }],
    merging: null,
    currentSlug: 'alpha',
    shipped: 2,
    skip: ['beta'],
    retries: { alpha: 1 },
    ...overrides,
  };
}

function writeStateFile(s: DrainState): void {
  writeFileSync(join(dir, '.noldor/drain-state.json'), JSON.stringify(s), 'utf8');
}

describe('readState', () => {
  it('returns the parsed heartbeat when present', () => {
    writeStateFile(state());
    expect(readState(dir)?.shipped).toBe(2);
  });

  it('returns null when the file is missing', () => {
    expect(readState(dir)).toBeNull();
  });

  it('returns null on garbage payload', () => {
    writeFileSync(join(dir, '.noldor/drain-state.json'), '{ nope', 'utf8');
    expect(readState(dir)).toBeNull();
  });
});

describe('collectStatus', () => {
  it('reports running with the lock pid when the lock holder is alive', () => {
    writeFileSync(
      join(dir, '.noldor/drain.lock'),
      JSON.stringify({ pid: process.pid, startedAt: 't' }),
      'utf8',
    );
    writeStateFile(state({ pid: process.pid }));
    const s = collectStatus(dir);
    expect(s.running).toBe(true);
    expect(s.lockPid).toBe(process.pid);
    expect(s.stateIsLive).toBe(true);
  });

  it('reports not running when the lock holder is dead', () => {
    writeFileSync(
      join(dir, '.noldor/drain.lock'),
      JSON.stringify({ pid: DEAD_PID, startedAt: 't' }),
      'utf8',
    );
    writeStateFile(state());
    const s = collectStatus(dir);
    expect(s.running).toBe(false);
    expect(s.lockPid).toBeNull();
    expect(s.stateIsLive).toBe(false);
    expect(s.state?.shipped).toBe(2);
  });

  it('reports not running with no state when neither file exists', () => {
    const s = collectStatus(dir);
    expect(s).toEqual({ running: false, lockPid: null, state: null, stateIsLive: false });
  });

  it('marks state stale when it belongs to a different pid than the live lock', () => {
    writeFileSync(
      join(dir, '.noldor/drain.lock'),
      JSON.stringify({ pid: process.pid, startedAt: 't' }),
      'utf8',
    );
    writeStateFile(state({ pid: DEAD_PID }));
    const s = collectStatus(dir);
    expect(s.running).toBe(true);
    expect(s.stateIsLive).toBe(false);
  });
});

describe('formatStatus', () => {
  it('formats a live runner with in-flight, merging, shipped, skip, retries', () => {
    const out = formatStatus({
      running: true,
      lockPid: 123,
      stateIsLive: true,
      state: state({
        pid: 123,
        phase: 'awaiting-merge',
        inFlight: [
          { slug: 'alpha', phase: 'building' },
          { slug: 'beta', phase: 'awaiting-merge' },
        ],
        merging: 'beta',
        shipped: 4,
        skip: ['gamma'],
        retries: { alpha: 2 },
      }),
    });
    expect(out).toContain('runner: live (pid 123)');
    expect(out).toContain('phase: awaiting-merge');
    expect(out).toContain('in-flight: alpha (building), beta (awaiting-merge)');
    expect(out).toContain('merging: beta');
    expect(out).toContain('shipped: 4');
    expect(out).toContain('skip: gamma');
    expect(out).toContain('retries: alpha=2');
  });

  it('labels dead-run state as last-run and empty collections as none', () => {
    const out = formatStatus({
      running: false,
      lockPid: null,
      stateIsLive: false,
      state: state({ inFlight: [], merging: null, skip: [], retries: {}, shipped: 0 }),
    });
    expect(out).toContain('runner: not running');
    expect(out).toContain(`last run: 2026-07-03T00:00:00Z (pid ${DEAD_PID}, dead)`);
    expect(out).toContain('in-flight: none');
    expect(out).toContain('skip: none');
    expect(out).not.toContain('retries:');
  });

  it('reports absence of any state', () => {
    const out = formatStatus({ running: false, lockPid: null, state: null, stateIsLive: false });
    expect(out).toContain('runner: not running');
    expect(out).toContain('no drain state');
  });
});
