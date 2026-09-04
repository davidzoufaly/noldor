// @tests: specs-cr-gate-multi-reviewer
import { describe, expect, it } from 'vitest';

import { ruleR1, ruleR2, ruleR3 } from '../reflag.js';

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

describe('ruleR2', () => {
  const b = {
    id: 'a',
    severity: 'med' as const,
    message: 'simplify this',
    locations: [{ file: 'src/x.ts', line: 12 }],
  };
  const scopes = new Map([['src/x.ts', [{ line: 10, reason: 'why', startLine: 10, endLine: 20 }]]]);

  it('fires for a location inside a marker scope', () => {
    const r = ruleR2([b], scopes, []);
    expect(r.outcome).toBe('fired');
    if (r.outcome === 'fired') expect(r.signals[0]!.message).toContain('src/x.ts:10');
  });

  it('is clear for a location outside every scope', () => {
    expect(
      ruleR2([{ ...b, locations: [{ file: 'src/x.ts', line: 40 }] }], scopes, []).outcome,
    ).toBe('clear');
  });

  it('is clear for a blocker with no locations', () => {
    expect(ruleR2([{ id: 'a', severity: 'low', message: 'x' }], scopes, []).outcome).toBe('clear');
  });

  it('is clear for a location with a file but no line', () => {
    expect(ruleR2([{ ...b, locations: [{ file: 'src/x.ts' }] }], scopes, []).outcome).toBe('clear');
  });

  // "We could not look" must never read the same as "we looked and found nothing".
  it('is omitted when the located file was unscannable', () => {
    const r = ruleR2([b], new Map(), ['src/x.ts']);
    expect(r.outcome).toBe('omitted');
    if (r.outcome === 'omitted') expect(r.reason).toContain('src/x.ts');
  });
});

// CR round 1, reviewer finding 1: a signal and an omission can be true at the
// same time. Reporting only the signal turns the other blocker's "could not
// look" into the silence the three-arm outcome exists to prevent.
describe('ruleR2 reporting a signal beside an omission', () => {
  const inScope = {
    id: 'a',
    severity: 'med' as const,
    message: 'x',
    locations: [{ file: 'src/x.ts', line: 12 }],
  };
  const unreadable = {
    id: 'b',
    severity: 'med' as const,
    message: 'y',
    locations: [{ file: 'src/bad.ts', line: 3 }],
  };
  const scopes = new Map([['src/x.ts', [{ line: 10, reason: 'why', startLine: 10, endLine: 20 }]]]);

  it('names the unscannable file even when another blocker fires', () => {
    const r = ruleR2([inScope, unreadable], scopes, ['src/bad.ts']);
    expect(r.outcome).toBe('fired');
    if (r.outcome === 'fired') {
      expect(r.signals).toHaveLength(1);
      expect(r.omitted).toContain('src/bad.ts');
    }
  });

  it('still reports a pure omission as omitted', () => {
    const r = ruleR2([unreadable], new Map(), ['src/bad.ts']);
    expect(r.outcome).toBe('omitted');
  });

  it('carries no omission when every located file scanned', () => {
    const r = ruleR2([inScope], scopes, []);
    expect(r.outcome).toBe('fired');
    if (r.outcome === 'fired') expect(r.omitted).toBeUndefined();
  });
});

// CR round 1, reviewer finding 2: `extractLocations` emits `endLine` for a
// `path:10-20` bullet, and both rules ignored it. A range counts on ANY
// overlap — a finding about lines 10-20 IS a finding about the cut at 15-18.
describe('range-aware matching', () => {
  const ranged = (file: string) => ({
    id: 'a',
    severity: 'med' as const,
    message: 'x',
    locations: [{ file, line: 10, endLine: 20 }],
  });

  it('R2 fires when a ranged location overlaps a scope it does not start in', () => {
    const scopes = new Map([
      ['src/x.ts', [{ line: 15, reason: 'why', startLine: 15, endLine: 18 }]],
    ]);
    expect(ruleR2([ranged('src/x.ts')], scopes, []).outcome).toBe('fired');
  });

  it('R2 stays clear when the range ends before the scope starts', () => {
    const scopes = new Map([
      ['src/x.ts', [{ line: 30, reason: 'why', startLine: 30, endLine: 40 }]],
    ]);
    expect(ruleR2([ranged('src/x.ts')], scopes, []).outcome).toBe('clear');
  });

  it('R3 fires when a ranged location covers an introduced line', () => {
    const introduced = new Map([['src/x.ts', new Set([15])]]);
    expect(ruleR3([ranged('src/x.ts')], introduced).outcome).toBe('fired');
  });

  it('R3 stays clear when the range covers no introduced line', () => {
    const introduced = new Map([['src/x.ts', new Set([40])]]);
    expect(ruleR3([ranged('src/x.ts')], introduced).outcome).toBe('clear');
  });
});
