import { describe, expect, it } from 'vitest';
import { classifyMergeView } from '../drain-io.js';

describe('classifyMergeView', () => {
  it('merged when mergedAt is set', () => {
    expect(
      classifyMergeView({
        mergedAt: '2026-06-10T00:00:00Z',
        mergeStateStatus: 'CLEAN',
        state: 'OPEN',
      }),
    ).toBe('merged');
  });

  it('merged when state is MERGED even if mergedAt is null', () => {
    expect(
      classifyMergeView({ mergedAt: null, mergeStateStatus: 'UNKNOWN', state: 'MERGED' }),
    ).toBe('merged');
  });

  it('merge-conflict on DIRTY / CONFLICTING', () => {
    expect(classifyMergeView({ mergedAt: null, mergeStateStatus: 'DIRTY', state: 'OPEN' })).toBe(
      'merge-conflict',
    );
    expect(
      classifyMergeView({ mergedAt: null, mergeStateStatus: 'CONFLICTING', state: 'OPEN' }),
    ).toBe('merge-conflict');
  });

  it('pending while checks run (BLOCKED / UNSTABLE / BEHIND / CLEAN) — never a conflict', () => {
    for (const s of ['BLOCKED', 'UNSTABLE', 'BEHIND', 'CLEAN']) {
      expect(classifyMergeView({ mergedAt: null, mergeStateStatus: s, state: 'OPEN' })).toBe(
        'pending',
      );
    }
  });
});
