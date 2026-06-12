// @tests: outcome-telemetry-and-effectiveness-metrics
import { describe, expect, it } from 'vitest';
import { COLLECTORS } from '../compute';
import { emptyFacts } from './fixtures';

describe('honesty rail', () => {
  it('every collector emits non-empty formula and blindSpots, even on empty facts', () => {
    for (const collect of COLLECTORS) {
      const r = collect(emptyFacts());
      expect(r.id.length, r.id).toBeGreaterThan(0);
      expect(r.formula.length, r.id).toBeGreaterThan(0);
      expect(r.blindSpots.length, r.id).toBeGreaterThan(0);
    }
  });
  it('registers all six v1 metrics', () => {
    const ids = COLLECTORS.map((c) => c(emptyFacts()).id).sort();
    expect(ids).toEqual([
      'cr-effectiveness',
      'cycle-time',
      'drain-reliability',
      'override-pressure',
      'routing-accuracy',
      'tokens-per-feature',
    ]);
  });
});
