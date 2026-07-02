// @tests: outcome-telemetry-and-effectiveness-metrics, release-script-sddreport-skip-if-only-count-line-changed
import { describe, expect, it } from 'vitest';
import { renderMetricsSection } from '../sdd-report-format';
import type { MetricsReport } from '../../metrics/types';

describe('renderMetricsSection', () => {
  it('renders headline lines with formulas', () => {
    const report: MetricsReport = {
      generatedAt: '2026-06-12T00:00:00.000Z',
      head: 'abc',
      factsWarnings: [],
      metrics: [
        {
          id: 'cycle-time',
          unit: 'days',
          value: { medianDays: 4 },
          formula: 'f',
          blindSpots: ['b'],
          samples: [],
        },
      ],
    };
    const lines = renderMetricsSection(report);
    expect(lines[0]).toBe('## Metrics');
    expect(lines.join('\n')).toContain('cycle-time');
    expect(lines.join('\n')).toContain('formula: f');
  });
  it('degrades to a labeled unavailable line on null', () => {
    expect(renderMetricsSection(null)).toEqual([
      '## Metrics',
      '',
      'metrics unavailable: compute failed',
      '',
    ]);
  });
});
