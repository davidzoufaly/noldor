import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyCycleToState,
  loadWatchState,
  saveWatchState,
  type WatchState,
} from '../watch-state.js';
import type { DrainResult } from '../drain-loop.js';

const RAILS = { maxFeaturesPerDay: 10, maxConsecutiveFailures: 3 };

function state(over: Partial<WatchState> = {}): WatchState {
  return {
    dayKey: '2026-06-12',
    shippedToday: 0,
    consecutiveFailures: 0,
    lastCycleAt: '',
    pendingPr: [],
    ...over,
  };
}

function res(over: Partial<DrainResult> = {}): DrainResult {
  return { shipped: 0, skipped: [], exitCode: 0, ...over };
}

describe('applyCycleToState', () => {
  it('increments consecutiveFailures on abort and on 0-ship cycles with new escalations', () => {
    const a = applyCycleToState(state(), res({ exitCode: 1 }), 0, RAILS, '2026-06-12T01:00:00Z');
    expect(a.state.consecutiveFailures).toBe(1);
    const b = applyCycleToState(state(), res(), 2, RAILS, '2026-06-12T01:00:00Z');
    expect(b.state.consecutiveFailures).toBe(1);
  });

  it('resets on a shipping cycle and on a clean zero-failure cycle', () => {
    const shipped = applyCycleToState(
      state({ consecutiveFailures: 2 }),
      res({ shipped: 1 }),
      0,
      RAILS,
      '2026-06-12T01:00:00Z',
    );
    expect(shipped.state.consecutiveFailures).toBe(0);
    const clean = applyCycleToState(
      state({ consecutiveFailures: 2 }),
      res(),
      0,
      RAILS,
      '2026-06-12T01:00:00Z',
    );
    expect(clean.state.consecutiveFailures).toBe(0);
  });

  it('exit-130 is neutral unless it shipped', () => {
    const neutral = applyCycleToState(
      state({ consecutiveFailures: 2 }),
      res({ exitCode: 130 }),
      0,
      RAILS,
      '2026-06-12T01:00:00Z',
    );
    expect(neutral.state.consecutiveFailures).toBe(2);
    const shipped = applyCycleToState(
      state({ consecutiveFailures: 2 }),
      res({ exitCode: 130, shipped: 1 }),
      0,
      RAILS,
      '2026-06-12T01:00:00Z',
    );
    expect(shipped.state.consecutiveFailures).toBe(0);
  });

  it('trips at maxConsecutiveFailures and caps at maxFeaturesPerDay', () => {
    const tripped = applyCycleToState(
      state({ consecutiveFailures: 2 }),
      res({ exitCode: 1 }),
      0,
      RAILS,
      '2026-06-12T01:00:00Z',
    );
    expect(tripped.tripped).toBe(true);
    const capped = applyCycleToState(
      state({ shippedToday: 9 }),
      res({ shipped: 1 }),
      0,
      RAILS,
      '2026-06-12T01:00:00Z',
    );
    expect(capped.capped).toBe(true);
    expect(capped.state.shippedToday).toBe(10);
  });
});

describe('loadWatchState / saveWatchState', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'watch-state-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('defaults on missing file and rolls shippedToday over on a new day', () => {
    const fresh = loadWatchState(dir, '2026-06-12');
    expect(fresh).toEqual({
      dayKey: '2026-06-12',
      shippedToday: 0,
      consecutiveFailures: 0,
      lastCycleAt: '',
      pendingPr: [],
    });
    saveWatchState(dir, { ...fresh, shippedToday: 7, consecutiveFailures: 1 });
    const sameDay = loadWatchState(dir, '2026-06-12');
    expect(sameDay.shippedToday).toBe(7);
    const nextDay = loadWatchState(dir, '2026-06-13');
    expect(nextDay.dayKey).toBe('2026-06-13');
    expect(nextDay.shippedToday).toBe(0);
    expect(nextDay.consecutiveFailures).toBe(1); // only the daily counter rolls
  });

  it('fail-open on corrupt file', () => {
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    writeFileSync(join(dir, '.noldor/watch-state.json'), '!!!', 'utf8');
    expect(loadWatchState(dir, '2026-06-12').shippedToday).toBe(0);
  });
});
