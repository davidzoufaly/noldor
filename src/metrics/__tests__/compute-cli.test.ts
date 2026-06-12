// @tests: outcome-telemetry-and-effectiveness-metrics
import { describe, expect, it } from 'vitest';
import { formatReport, parseArgs } from '../compute-cli';
import type { MetricsReport } from '../types';

const REPORT: MetricsReport = {
  generatedAt: '2026-06-12T00:00:00.000Z',
  head: 'abc',
  factsWarnings: ['w1'],
  metrics: [
    {
      id: 'cycle-time',
      unit: 'days',
      value: { medianDays: 3 },
      formula: 'f',
      blindSpots: ['b'],
      samples: [],
    },
  ],
};

describe('parseArgs', () => {
  it('reads --json and --metric', () => {
    expect(parseArgs(['--json', 'out.json', '--metric', 'cycle-time'])).toEqual({
      jsonPath: 'out.json',
      metric: 'cycle-time',
    });
    expect(parseArgs([])).toEqual({ jsonPath: undefined, metric: undefined });
  });
});

describe('formatReport', () => {
  it('renders one block per metric with formula + blind spots', () => {
    const text = formatReport(REPORT, undefined);
    expect(text).toContain('cycle-time');
    expect(text).toContain('formula: f');
    expect(text).toContain('blind spots: b');
    expect(text).toContain('warnings: w1');
  });
  it('filters to a single metric', () => {
    expect(formatReport(REPORT, 'nope')).toContain('no metric with id');
  });
});
