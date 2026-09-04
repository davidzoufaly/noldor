// @tests: specs-cr-gate-multi-reviewer
import { describe, expect, it } from 'vitest';

import { ruleR1, ruleR3 } from '../reflag.js';

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

describe('ruleR3', () => {
  const b = {
    id: 'a',
    severity: 'high' as const,
    message: 'wrong',
    locations: [{ file: 'src/x.ts', line: 12 }],
  };

  it('fires for a location on an introduced line', () => {
    const r = ruleR3([b], new Map([['src/x.ts', new Set([11, 12, 13])]]));
    expect(r.outcome).toBe('fired');
    if (r.outcome === 'fired') expect(r.signals[0]!.message).toContain('src/x.ts:12');
  });

  it('is clear for a location on an untouched line', () => {
    expect(ruleR3([b], new Map([['src/x.ts', new Set([40])]])).outcome).toBe('clear');
  });

  it('is clear for a file the range never touched', () => {
    expect(ruleR3([b], new Map()).outcome).toBe('clear');
  });

  // The caller withholds the map when the range is not a fast-forward.
  it('is omitted when the introduced-line map is unavailable', () => {
    const r = ruleR3([b], undefined);
    expect(r.outcome).toBe('omitted');
    if (r.outcome === 'omitted') expect(r.reason).toMatch(/fast-forward|unavailable/i);
  });
});
