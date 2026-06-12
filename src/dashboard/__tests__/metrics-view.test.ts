// @tests: outcome-telemetry-and-effectiveness-metrics
import { describe, expect, it } from 'vitest';
import { renderMetrics } from '../views';
import type { MetricsReport } from '../../metrics/types';

const REPORT: MetricsReport = {
  generatedAt: '2026-06-12T00:00:00.000Z',
  head: 'abc1234',
  factsWarnings: [],
  metrics: [
    {
      id: 'cycle-time',
      unit: 'days',
      value: {
        medianDays: 4,
        p90Days: 9,
        medianByPath: { 'full-new': 5 },
        excluded: { noIntake: 1, noTag: 0 },
      },
      formula: 'days(intake → release)',
      blindSpots: ['epoch-limited'],
      samples: [],
    },
  ],
};

describe('renderMetrics', () => {
  it('renders headline card, formula and blind spots', () => {
    const html = renderMetrics(REPORT);
    expect(html).toContain('cycle-time');
    expect(html).toContain('days(intake → release)');
    expect(html).toContain('epoch-limited');
  });
  it('renders the degraded state on null report', () => {
    expect(renderMetrics(null)).toContain('metrics unavailable');
  });
});
