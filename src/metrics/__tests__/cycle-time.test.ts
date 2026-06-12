// @tests: outcome-telemetry-and-effectiveness-metrics
import { describe, expect, it } from 'vitest';
import { collectCycleTime } from '../collect/cycle-time';
import { emptyFacts, feature, commit } from './fixtures';

describe('collectCycleTime', () => {
  it('computes days from intake to release-tag date, segmented by path', () => {
    const facts = emptyFacts({
      features: [feature('a', { introduced: '1.0.0', since: '2026-01-01' })],
      releases: [{ version: '1.0.0', date: '2026-01-11T00:00:00+00:00' }],
      commits: [commit({ trailers: { 'Noldor-FD': 'a', 'Noldor-Path': 'full-new' } })],
    });
    const r = collectCycleTime(facts);
    const v = r.value as {
      medianDays: number;
      excluded: { noIntake: number; noTag: number };
    };
    const rows = r.samples as { slug: string; days: number; path: string }[];
    expect(v.medianDays).toBe(10);
    expect(rows[0]).toMatchObject({ slug: 'a', days: 10, path: 'full-new' });
    expect(r.formula.length).toBeGreaterThan(0);
    expect(r.blindSpots.length).toBeGreaterThan(0);
  });

  it('falls back to intake[] recovery and tallies unrecoverable FDs', () => {
    const facts = emptyFacts({
      features: [
        feature('b', { introduced: '1.0.0' }),
        feature('c', { introduced: '1.0.0' }),
        feature('d', { introduced: '9.9.9' }),
      ],
      intake: [{ slug: 'b', since: '2026-01-06' }],
      releases: [{ version: '1.0.0', date: '2026-01-11T00:00:00+00:00' }],
    });
    const r = collectCycleTime(facts);
    const v = r.value as { excluded: { noIntake: number; noTag: number } };
    expect(r.samples).toHaveLength(1);
    expect(v.excluded).toEqual({ noIntake: 1, noTag: 1 });
  });
});
