// @tests: de-superpowers-vendor-spec-plan-and-worktree-flows
import { describe, expect, it } from 'vitest';

import { tally } from '../tally.js';

describe('tally', () => {
  it('counts occurrences per distinct value', () => {
    expect([...tally(['a', 'b', 'a'])]).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });

  it('preserves first-seen order', () => {
    expect([...tally(['z', 'a', 'z'])].map(([k]) => k)).toEqual(['z', 'a']);
  });

  it('returns an empty map for no values', () => {
    expect(tally([]).size).toBe(0);
  });
});
