import { describe, expect, it } from 'vitest';
import { decideNext } from '../drain-loop.js';
import type { SuggestedEntry } from '../../core/next-priority.js';

function entry(over: Partial<SuggestedEntry> = {}): SuggestedEntry {
  return {
    name: 'X',
    slug: 'x',
    suggestedPath: 'fast-track',
    description: 'small thing',
    ...over,
  } as SuggestedEntry;
}
const caps = { shipped: 0, maxFeatures: 20, spawns: 0, maxSpawns: 40 };

describe('decideNext', () => {
  it('spawns an in-scope fast-track entry', () => {
    expect(decideNext({ entry: entry(), ...caps }).action).toBe('spawn');
  });
  it('skips a non-fast-track entry (M/L/XL)', () => {
    expect(decideNext({ entry: entry({ suggestedPath: 'full-attach' }), ...caps }).action).toBe(
      'skip-out-of-scope',
    );
  });
  it('skips a Touches-bearing entry', () => {
    expect(
      decideNext({ entry: entry({ description: 'do it\nTouches: a.ts' }), ...caps }).action,
    ).toBe('skip-out-of-scope');
  });
  it('skips a multi-scope entry', () => {
    expect(decideNext({ entry: entry({ description: '- a\n- b' }), ...caps }).action).toBe(
      'skip-out-of-scope',
    );
  });
  it('done when shipped >= maxFeatures', () => {
    expect(decideNext({ entry: entry(), ...caps, shipped: 20 }).action).toBe('done');
  });
  it('done when spawns >= maxSpawns', () => {
    expect(decideNext({ entry: entry(), ...caps, spawns: 40 }).action).toBe('done');
  });
});
