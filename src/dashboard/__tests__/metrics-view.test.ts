// @tests: dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics, project-tracking-dashboard
import { describe, expect, it } from 'vitest';
import { renderMetrics } from '../views';
import type { MetricResult, MetricsReport } from '../../metrics/types';

function report(metrics: MetricResult[]): MetricsReport {
  return {
    generatedAt: '2026-06-12T00:00:00.000Z',
    head: 'abc1234',
    factsWarnings: [],
    metrics,
  };
}

const CYCLE_TIME: MetricResult = {
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
  samples: [
    { slug: 'feat-a', days: 4, path: 'full-new', provenance: 'autonomous' },
    { slug: 'feat-b', days: 9, path: 'full-new', provenance: 'operator' },
  ],
};

const REPORT = report([CYCLE_TIME]);

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

  it('renders the headline counter-strip from cycle-time and drain-reliability', () => {
    const html = renderMetrics(
      report([
        CYCLE_TIME,
        {
          id: 'drain-reliability',
          unit: 'runs / events',
          value: { lastRun: { shipped: 3, skipped: 1, retried: 2 }, history: null },
          formula: 'f',
          blindSpots: ['b'],
          samples: [],
        },
      ]),
    );
    expect(html).toContain('median cycle (d)');
    expect(html).toContain('>4<');
    expect(html).toContain('>9<');
    // 1 autonomous of 2 samples
    expect(html).toContain('50%');
    expect(html).toContain('drain shipped (last run)');
    expect(html).toContain('>3<');
  });

  it('headline falls back to — on zero samples instead of a fake 0', () => {
    const zeroSamples: MetricResult = { ...CYCLE_TIME, samples: [] };
    const html = renderMetrics(report([zeroSamples]));
    // percentile([]) yields 0 in the collector; zero samples must render — not 0
    expect(html).toContain('—');
    expect(html).not.toContain('>0<');
  });

  it('groups metrics under Delivery/Quality/Autonomy and renders bespoke bodies', () => {
    const html = renderMetrics(
      report([
        CYCLE_TIME,
        {
          id: 'routing-accuracy',
          unit: 'entries',
          value: {
            table: { 'fast-track': { 'fast-track': 3, 'full-new': 1 } },
            matches: 3,
            total: 4,
            excluded: 2,
            window: 10,
          },
          formula: 'f',
          blindSpots: ['b'],
          samples: [],
        },
        {
          id: 'cr-effectiveness',
          unit: 'findings / corrective commits',
          value: {
            perLane: { subagent: { blockers: 2, suggestions: 5 } },
            correctiveBySlug: { 'feat-a': 1 },
            windowDays: 14,
          },
          formula: 'f',
          blindSpots: ['b'],
          samples: [],
        },
        {
          id: 'override-pressure',
          unit: 'override commits',
          value: { '0.5.0': { 'Noldor-Override-Audit': 2 } },
          formula: 'f',
          blindSpots: ['b'],
          samples: [],
        },
        {
          id: 'tokens-per-feature',
          unit: 'raw tokens (NEVER cost)',
          value: { 'feat-a': 1200, 'feat-b': null },
          formula: 'f',
          blindSpots: ['b'],
          samples: [],
        },
      ]),
    );
    expect(html).toContain('<h2>Delivery</h2>');
    expect(html).toContain('<h2>Quality</h2>');
    expect(html).toContain('<h2>Autonomy</h2>');
    // cycle-time: bar table by path
    expect(html).toContain('Median days by path');
    expect(html).toContain('full-new');
    // routing-accuracy: confusion matrix headline
    expect(html).toContain('3/4');
    expect(html).toContain('Suggested vs actual');
    // cr-effectiveness: lane table + corrective bars
    expect(html).toContain('Findings per lane');
    expect(html).toContain('subagent');
    expect(html).toContain('Corrective commits within 14d of release');
    // override-pressure: window table
    expect(html).toContain('Noldor-Override-Audit');
    expect(html).toContain('0.5.0');
    // tokens-per-feature: bars + null list
    expect(html).toContain('Tokens by feature');
    expect(html).toContain('no usage data (null ≠ zero): feat-b');
    // no raw JSON dumps for known shapes
    expect(html).not.toContain('<pre>');
  });

  it('renders labeled empty-states instead of {} dumps', () => {
    const html = renderMetrics(
      report([
        {
          id: 'routing-accuracy',
          unit: 'entries',
          value: { table: {}, matches: 0, total: 0, excluded: 10, window: 10 },
          formula: 'f',
          blindSpots: ['b'],
          samples: [],
        },
        {
          id: 'cr-effectiveness',
          unit: 'findings / corrective commits',
          value: { perLane: {}, correctiveBySlug: {}, windowDays: 14 },
          formula: 'f',
          blindSpots: ['b'],
          samples: [],
        },
        {
          id: 'drain-reliability',
          unit: 'runs / events',
          value: { lastRun: null, history: null },
          formula: 'f',
          blindSpots: ['b'],
          samples: [],
        },
        {
          id: 'override-pressure',
          unit: 'override commits',
          value: {},
          formula: 'f',
          blindSpots: ['b'],
          samples: [],
        },
        {
          id: 'tokens-per-feature',
          unit: 'raw tokens (NEVER cost)',
          value: {},
          formula: 'f',
          blindSpots: ['b'],
          samples: [],
        },
      ]),
    );
    expect(html).toContain('no data yet');
    expect(html).toContain('no drain-state.json');
    expect(html).not.toContain('{}');
  });

  it('renders drain-reliability history counters and per-slug escalations', () => {
    const html = renderMetrics(
      report([
        {
          id: 'drain-reliability',
          unit: 'runs / events',
          value: {
            lastRun: { shipped: 2, skipped: 0, retried: 1 },
            history: {
              salvaged: 1,
              escalatedTotal: 3,
              escalatedBySlug: { 'feat-x': 3 },
              meanDurationMs: 65000,
            },
          },
          formula: 'f',
          blindSpots: ['b'],
          samples: [],
        },
      ]),
    );
    expect(html).toContain('shipped (last run)');
    expect(html).toContain('Escalations by slug');
    expect(html).toContain('feat-x');
  });

  it('falls back to generic JSON for unknown metric ids under Other', () => {
    const html = renderMetrics(
      report([
        {
          id: 'brand-new-metric',
          unit: 'things',
          value: { some: 'shape' },
          formula: 'f',
          blindSpots: ['b'],
          samples: [],
        },
      ]),
    );
    expect(html).toContain('<h2>Other</h2>');
    expect(html).toContain('<pre>');
    expect(html).toContain('brand-new-metric');
  });

  it('falls back to generic JSON on value-shape drift without breaking the page', () => {
    const html = renderMetrics(
      report([
        {
          id: 'cycle-time',
          unit: 'days',
          value: 'not-an-object',
          formula: 'f',
          blindSpots: ['b'],
          samples: [],
        },
      ]),
    );
    expect(html).toContain('<pre>');
    expect(html).toContain('not-an-object');
  });

  it('escapes repo-derived strings in all new markup', () => {
    const evil = '<script>alert(1)</script>';
    const html = renderMetrics(
      report([
        {
          ...CYCLE_TIME,
          value: {
            medianDays: 4,
            p90Days: 9,
            medianByPath: { [evil]: 5 },
            excluded: { noIntake: 0, noTag: 0 },
          },
          samples: [{ slug: evil, days: 4, path: evil, provenance: 'operator' }],
        },
        {
          id: 'cr-effectiveness',
          unit: 'findings / corrective commits',
          value: {
            perLane: { [evil]: { blockers: 1, suggestions: 0 } },
            correctiveBySlug: {},
            windowDays: 14,
          },
          formula: 'f',
          blindSpots: ['b'],
          samples: [],
        },
      ]),
    );
    expect(html).not.toContain(evil);
    expect(html).toContain('&lt;script&gt;');
  });
});
