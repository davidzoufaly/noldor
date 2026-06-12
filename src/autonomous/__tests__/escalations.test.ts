import { describe, expect, it } from 'vitest';
import { mapCycle, parkKey, type ParkMap } from '../escalations.js';
import type { DrainResult } from '../drain-loop.js';

const NOW = '2026-06-12T10:00:00.000Z';

function result(over: Partial<DrainResult> = {}): DrainResult {
  return { shipped: 0, skipped: [], exitCode: 0, ...over };
}

function input(over: Partial<Parameters<typeof mapCycle>[0]> = {}): Parameters<typeof mapCycle>[0] {
  return {
    result: result(),
    mode: 'watch',
    source: 'roadmap',
    parked: {} as ParkMap,
    pendingPr: [],
    queueUniverse: [],
    now: NOW,
    ...over,
  };
}

describe('mapCycle', () => {
  it('parks retries-exhausted immediately with an escalation row', () => {
    const v = mapCycle(
      input({
        result: result({ skipped: ['a'], skipReasons: { a: 'retries-exhausted' } }),
        queueUniverse: ['a'],
      }),
    );
    expect(v.toPark).toEqual([{ slug: 'a', reason: 'retries-exhausted' }]);
    expect(v.escalations).toHaveLength(1);
    expect(v.escalations[0]).toMatchObject({
      ts: NOW,
      slug: 'a',
      source: 'roadmap',
      reason: 'retries-exhausted',
    });
  });

  it('maps both coordinator outcome strings to their reasons', () => {
    const v = mapCycle(
      input({
        result: result({
          skipped: ['a', 'b'],
          skipReasons: {
            a: 'merge-conflict — PR left open for human resolution',
            b: 'merge-timeout — PR left open for human resolution',
          },
        }),
        queueUniverse: ['a', 'b'],
      }),
    );
    expect(v.toPark).toEqual([
      { slug: 'a', reason: 'merge-conflict' },
      { slug: 'b', reason: 'merge-timeout' },
    ]);
  });

  it('gives pr-open-unmerged a one-cycle grace in watch mode', () => {
    const first = mapCycle(
      input({
        result: result({ skipped: ['a'], skipReasons: { a: 'pr-open-unmerged' } }),
        queueUniverse: ['a'],
      }),
    );
    expect(first.toPark).toEqual([]);
    expect(first.escalations).toEqual([]);
    expect(first.nextPendingPr).toEqual(['a']);

    const second = mapCycle(
      input({
        result: result({ skipped: ['a'], skipReasons: { a: 'pr-open-unmerged' } }),
        pendingPr: ['a'],
        queueUniverse: ['a'],
      }),
    );
    expect(second.toPark).toEqual([{ slug: 'a', reason: 'pr-open-unmerged' }]);
    expect(second.nextPendingPr).toEqual([]);
  });

  it('drops a pendingPr slug that stops reporting (self-clean)', () => {
    const v = mapCycle(input({ pendingPr: ['gone'], queueUniverse: ['gone'] }));
    expect(v.nextPendingPr).toEqual([]);
  });

  it('never parks pr-open-unmerged in run mode', () => {
    const v = mapCycle(
      input({
        mode: 'run',
        result: result({ skipped: ['a'], skipReasons: { a: 'pr-open-unmerged' } }),
        queueUniverse: ['a'],
      }),
    );
    expect(v.toPark).toEqual([]);
    expect(v.escalations).toEqual([]);
    expect(v.nextPendingPr).toEqual([]);
  });

  it('emits run-aborted without parking; dedupes identical error streaks in watch mode', () => {
    const aborted = result({ exitCode: 1, error: 'ff-only rejected' });
    const first = mapCycle(input({ result: aborted }));
    expect(first.escalations).toHaveLength(1);
    expect(first.escalations[0]!.reason).toBe('run-aborted');
    expect(first.toPark).toEqual([]);
    expect(first.nextRunAbortError).toBe('ff-only rejected');

    const second = mapCycle(input({ result: aborted, prevRunAbortError: 'ff-only rejected' }));
    expect(second.escalations).toEqual([]);

    const runMode = mapCycle(
      input({ mode: 'run', result: aborted, prevRunAbortError: 'ff-only rejected' }),
    );
    expect(runMode.escalations).toHaveLength(1); // one-shot run always appends
  });

  it('never re-escalates an already-parked composite key, but a different source does', () => {
    const parked: ParkMap = { [parkKey('roadmap', 'a')]: { reason: 'retries-exhausted', ts: 't' } };
    const sameSource = mapCycle(
      input({
        parked,
        result: result({ skipped: ['a'], skipReasons: { a: 'retries-exhausted' } }),
        queueUniverse: ['a'],
      }),
    );
    expect(sameSource.toPark).toEqual([]);
    expect(sameSource.escalations).toEqual([]);

    const otherSource = mapCycle(
      input({
        source: 'plans',
        parked,
        result: result({ skipped: ['a'], skipReasons: { a: 'retries-exhausted' } }),
        queueUniverse: ['a'],
      }),
    );
    expect(otherSource.toPark).toEqual([{ slug: 'a', reason: 'retries-exhausted' }]);
  });

  it('auto-resolves parked entries absent from the matching source universe only', () => {
    const parked: ParkMap = {
      [parkKey('roadmap', 'merged')]: { reason: 'retries-exhausted', ts: 't' },
      [parkKey('roadmap', 'alive')]: { reason: 'merge-conflict', ts: 't' },
      [parkKey('plans', 'other')]: { reason: 'retries-exhausted', ts: 't' },
    };
    const v = mapCycle(input({ parked, queueUniverse: ['alive'] }));
    expect(v.toUnpark).toEqual([parkKey('roadmap', 'merged')]);
  });

  it('ignores ineligible-skip reasons entirely', () => {
    const v = mapCycle(
      input({
        result: result({
          skipped: ['a'],
          skipReasons: { a: 'not a fast-track XS/S entry (roadmap source ships fast-track only)' },
        }),
        queueUniverse: ['a'],
      }),
    );
    expect(v.toPark).toEqual([]);
    expect(v.escalations).toEqual([]);
  });
});
