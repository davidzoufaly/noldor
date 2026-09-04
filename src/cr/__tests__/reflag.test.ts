// @tests: specs-cr-gate-multi-reviewer
import { describe, expect, it } from 'vitest';

import { ruleR1 } from '../reflag.js';

const blocker = (id: string) => ({ id, severity: 'high' as const, message: 'boom' });

describe('ruleR1', () => {
  it('fires for an id that appeared in a prior round', () => {
    const r = ruleR1([blocker('a'), blocker('b')], [['a', 'z']]);
    expect(r.outcome).toBe('fired');
    if (r.outcome === 'fired') expect(r.signals.map((s) => s.blockerId)).toEqual(['a']);
  });

  // The whole reason a per-blocker id exists: a lone survivor beside an
  // otherwise-changed set has a different SET digest and would never fire.
  it('fires for a lone survivor beside an otherwise-changed set', () => {
    const r = ruleR1([blocker('a'), blocker('new')], [['a', 'gone1', 'gone2']]);
    expect(r.outcome).toBe('fired');
  });

  it('is clear when nothing repeats', () => {
    expect(ruleR1([blocker('x')], [['a', 'b']]).outcome).toBe('clear');
  });

  // An empty array is a real answer — a first round has no history.
  it('is clear on the first round', () => {
    expect(ruleR1([blocker('x')], []).outcome).toBe('clear');
  });

  // undefined is NOT the same as empty: the rule could not run at all.
  it('is omitted when the ledger recorded no ids', () => {
    const r = ruleR1([blocker('x')], undefined);
    expect(r.outcome).toBe('omitted');
    if (r.outcome === 'omitted') expect(r.reason).toMatch(/no recorded blocker ids/i);
  });
});
