import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWriteFileSync } from '../core/atomic-write.js';
import { readJsonState } from '../core/state-file.js';
import type { DrainResult } from './drain-loop.js';

export interface WatchState {
  dayKey: string;
  shippedToday: number;
  consecutiveFailures: number;
  lastCycleAt: string;
  /** pr-open-unmerged grace carry-over (spec Unit 3). */
  pendingPr: string[];
  /** run-aborted streak dedup memory (spec Unit 3). */
  lastRunAbortError?: string;
}

export interface WatchRails {
  maxFeaturesPerDay: number;
  maxConsecutiveFailures: number;
}

const STATE_REL = '.noldor/watch-state.json';

/** Load watch state, defaulting on missing/corrupt file; roll the daily counter on a new dayKey. */
export function loadWatchState(cwd: string, todayKey: string): WatchState {
  let s: WatchState = {
    dayKey: todayKey,
    shippedToday: 0,
    consecutiveFailures: 0,
    lastCycleAt: '',
    pendingPr: [],
  };
  let raw: Partial<WatchState> | undefined;
  try {
    raw = readJsonState<Partial<WatchState>>(join(cwd, STATE_REL));
  } catch (err) {
    // Corrupt (present but unparseable/unreadable) → fail CLOSED. Silently
    // resetting the rails to zero here was the fail-open bug: it uncaps the
    // daily spawn count and wipes the consecutive-failure trip streak. Surface
    // loudly and re-throw so the watch daemon aborts the cycle rather than
    // resuming amnesiac. A MISSING file returns undefined (a legitimate fresh
    // start) and keeps the defaults below.
    process.stderr.write(
      `watch-state corrupt at ${join(cwd, STATE_REL)}: ${String(err)} — refusing to reset rails (fail-closed)\n`,
    );
    throw err;
  }
  if (raw !== undefined) {
    s = {
      dayKey: raw.dayKey ?? todayKey,
      shippedToday: raw.shippedToday ?? 0,
      consecutiveFailures: raw.consecutiveFailures ?? 0,
      lastCycleAt: raw.lastCycleAt ?? '',
      pendingPr: raw.pendingPr ?? [],
      ...(raw.lastRunAbortError !== undefined ? { lastRunAbortError: raw.lastRunAbortError } : {}),
    };
  }
  if (s.dayKey !== todayKey) {
    s = { ...s, dayKey: todayKey, shippedToday: 0 };
  }
  return s;
}

/** Best-effort write, mirroring drain-state.ts. */
export function saveWatchState(cwd: string, state: WatchState): void {
  try {
    mkdirSync(join(cwd, '.noldor'), { recursive: true });
    atomicWriteFileSync(join(cwd, STATE_REL), `${JSON.stringify(state, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`watch-state write failed (non-fatal): ${String(err)}\n`);
  }
}

/**
 * Pure rails arithmetic for one finished cycle (spec Unit 5 trip rule, in order):
 * exit 130 → unchanged unless it shipped (then reset); exit 1 or 0-ships-with-new-escalations
 * → increment; otherwise reset. Daily counter always accumulates.
 */
export function applyCycleToState(
  state: WatchState,
  result: DrainResult,
  newEscalations: number,
  rails: WatchRails,
  now: string,
): { state: WatchState; tripped: boolean; capped: boolean } {
  let consecutiveFailures = state.consecutiveFailures;
  if (result.exitCode === 130) {
    if (result.shipped > 0) consecutiveFailures = 0;
  } else if (result.exitCode === 1 || (result.shipped === 0 && newEscalations > 0)) {
    consecutiveFailures += 1;
  } else {
    consecutiveFailures = 0;
  }
  const shippedToday = state.shippedToday + result.shipped;
  const next: WatchState = { ...state, consecutiveFailures, shippedToday, lastCycleAt: now };
  return {
    state: next,
    tripped: consecutiveFailures >= rails.maxConsecutiveFailures,
    capped: shippedToday >= rails.maxFeaturesPerDay,
  };
}
