// @tests: acceptance-verify-lane, outcome-telemetry-and-effectiveness-metrics, specs-cr-gate-multi-reviewer
import { describe, expect, it } from 'vitest';
import { collectCrEffectiveness } from '../collect/cr-effectiveness';
import { collectOverridePressure } from '../collect/override-pressure';
import { emptyFacts, feature, commit } from './fixtures';
import type { LaneFindings } from '../../cr/findings-schema';

const LF: LaneFindings = {
  lane: 'subagent',
  artifact: 'docs/x.md',
  kind: 'code',
  slug: 'a',
  blockers: [{ file: 'x', severity: 'high', message: 'm' }],
  suggestions: [{ file: 'x', severity: 'low', message: 's' }],
  summary: 'sum',
  startedAt: '2026-01-10T00:00:00.000Z',
} as LaneFindings;

describe('collectCrEffectiveness', () => {
  it('counts per-lane findings and 14-day corrective commits', () => {
    const facts = emptyFacts({
      features: [feature('a', { introduced: '1.0.0' })],
      releases: [{ version: '1.0.0', date: '2026-01-11T00:00:00+00:00' }],
      laneFindings: [LF],
      commits: [
        commit({
          subject: 'fix: broken thing',
          date: '2026-01-15T00:00:00+00:00',
          trailers: { 'Noldor-FD': 'a' },
        }),
        commit({
          subject: 'fix: too late',
          date: '2026-02-15T00:00:00+00:00',
          trailers: { 'Noldor-FD': 'a' },
        }),
      ],
    });
    const v = collectCrEffectiveness(facts).value as {
      perLane: Record<string, { blockers: number; suggestions: number }>;
      correctiveBySlug: Record<string, number>;
    };
    expect(v.perLane.subagent).toEqual({ blockers: 1, suggestions: 1 });
    expect(v.correctiveBySlug.a).toBe(1);
  });
});

describe('collectOverridePressure', () => {
  it('buckets override trailers by the release window containing the commit', () => {
    const facts = emptyFacts({
      releases: [{ version: '1.0.0', date: '2026-01-11T00:00:00+00:00' }],
      commits: [
        commit({
          date: '2026-01-10T00:00:00+00:00',
          trailers: { 'Noldor-Override-Gate': 'reason' },
        }),
      ],
    });
    const v = collectOverridePressure(facts).value as Record<string, Record<string, number>>;
    expect(v['1.0.0']['Noldor-Override-Gate']).toBe(1);
  });
});
