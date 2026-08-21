// src/release/__tests__/sdd-report-diff.test.ts
// @tests: outcome-telemetry-and-effectiveness-metrics, release-script-sddreport-skip-if-only-count-line-changed

import { describe, expect, it } from 'vitest';

import {
  renderMetricsSection,
  reviewSkipCountLine,
  VOLATILE_METRIC_IDS,
} from '../../garden/sdd-report-format.js';
import { COLLECTORS } from '../../metrics/compute.js';
import type { MetricResult } from '../../metrics/types.js';
import { emptyFacts } from '../../metrics/__tests__/fixtures.js';
import { onlyVolatileSectionsChanged } from '../sdd-report-diff.js';

// Build the count line via the shared format helper the real report uses, so a
// wording change at the source desyncs this test too — catching the drift the
// guard would otherwise hide (it would fail safe to always-abort, killing the
// feature silently).
const report = (count: number, gaps: string[] = ['- `x` — missing tests']): string =>
  [
    '# SDD report',
    '',
    '### Review-skip count (last 30 days)',
    '',
    reviewSkipCountLine(count),
    '',
    '## Gap details',
    '',
    ...gaps,
    '',
  ].join('\n');

const metric = (
  id: string,
  unit: string,
  value: unknown,
  formula = `how ${id} is derived`,
): MetricResult => ({
  id,
  unit,
  value,
  formula,
  blindSpots: [`${id} blind spot`],
  samples: [],
});

/**
 * Renders a metrics section through the real emitter, so heading/fence shape here
 * always matches what `sdd-report.ts` writes.
 */
const metricsSection = (metrics: MetricResult[]): string =>
  renderMetricsSection({
    generatedAt: '2026-01-01T00:00:00.000Z',
    head: 'deadbeef',
    factsWarnings: [],
    metrics,
  }).join('\n');

/** A full report: deterministic (git-derived) metric + volatile (local-state) metric. */
const fullReport = (opts: {
  count?: number;
  cycleMedian?: number;
  blockers?: number;
  crFormula?: string;
}): string =>
  [
    report(opts.count ?? 8),
    metricsSection([
      metric('cycle-time', 'days', { medianDays: opts.cycleMedian ?? 20.6 }),
      metric(
        'cr-effectiveness',
        'findings / corrective commits',
        { perLane: { reviewer: { blockers: opts.blockers ?? 7, suggestions: 32 } } },
        opts.crFormula,
      ),
      metric('drain-reliability', 'runs / events', {
        lastRun: { shipped: opts.blockers ?? 3, skipped: 0 },
      }),
    ]),
  ].join('\n');

describe('onlyVolatileSectionsChanged', () => {
  it('returns true for identical content', () => {
    expect(onlyVolatileSectionsChanged(report(8), report(8))).toBe(true);
  });

  it('returns true when only the count number differs', () => {
    expect(onlyVolatileSectionsChanged(report(8), report(9))).toBe(true);
  });

  it('returns false when a gap line is added', () => {
    const head = report(8, ['- `x` — missing tests']);
    const working = report(8, ['- `x` — missing tests', '- `y` — missing spec']);
    expect(onlyVolatileSectionsChanged(head, working)).toBe(false);
  });

  it('returns false when both the count and a gap change', () => {
    const head = report(8, ['- `x` — missing tests']);
    const working = report(9, ['- `x` — missing tests', '- `y` — missing spec']);
    expect(onlyVolatileSectionsChanged(head, working)).toBe(false);
  });

  it('returns false when the count line is absent / format-shifted on one side', () => {
    const head = report(8);
    const working = head.replace(reviewSkipCountLine(8), 'Gated commits without review: 8');
    expect(onlyVolatileSectionsChanged(head, working)).toBe(false);
  });

  it('stays coupled to the real emitted line via the shared format helper', () => {
    // Lines built straight from reviewSkipCountLine — if the prefix ever
    // changes, both the matcher (derived from the same constant) and these
    // fixtures move together, so this asserts the count-only delta is still
    // recognized regardless of the literal wording.
    const head = `# r\n\n${reviewSkipCountLine(8)}\n`;
    const working = `# r\n\n${reviewSkipCountLine(9)}\n`;
    expect(onlyVolatileSectionsChanged(head, working)).toBe(true);
  });

  it('tolerates a volatile metric whose value block differs', () => {
    // The worktree-vs-main-workspace case: same git content, different local
    // `.noldor/` state, so only the local-state metric bodies move.
    expect(
      onlyVolatileSectionsChanged(fullReport({ blockers: 7 }), fullReport({ blockers: 0 })),
    ).toBe(true);
  });

  it('tolerates the count line and volatile metric bodies changing together', () => {
    const head = fullReport({ count: 8, blockers: 7 });
    const working = fullReport({ count: 103, blockers: 0 });
    expect(onlyVolatileSectionsChanged(head, working)).toBe(true);
  });

  it('returns false when a git-derived metric value changes', () => {
    const head = fullReport({ cycleMedian: 20.6 });
    const working = fullReport({ cycleMedian: 25.8 });
    expect(onlyVolatileSectionsChanged(head, working)).toBe(false);
  });

  it('returns false when a volatile metric formula changes', () => {
    // Only the JSON body is masked — the metric's *definition* is content.
    const head = fullReport({ crFormula: 'per-lane blockers + suggestions' });
    const working = fullReport({ crFormula: 'per-lane blockers only' });
    expect(onlyVolatileSectionsChanged(head, working)).toBe(false);
  });

  it('returns false when a volatile metric section is dropped on one side', () => {
    const head = metricsSection([
      metric('cr-effectiveness', 'findings', { perLane: {} }),
      metric('cycle-time', 'days', { medianDays: 1 }),
    ]);
    const working = metricsSection([metric('cycle-time', 'days', { medianDays: 1 })]);
    expect(onlyVolatileSectionsChanged(head, working)).toBe(false);
  });

  it('masks every declared volatile id, and only those', () => {
    const value = (n: number): Record<string, number> => ({ n });
    for (const id of VOLATILE_METRIC_IDS) {
      const head = metricsSection([metric(id, 'unit', value(1))]);
      const working = metricsSection([metric(id, 'unit', value(2))]);
      expect(onlyVolatileSectionsChanged(head, working), `${id} should be masked`).toBe(true);
    }
    const head = metricsSection([metric('cycle-time', 'days', value(1))]);
    const working = metricsSection([metric('cycle-time', 'days', value(2))]);
    expect(onlyVolatileSectionsChanged(head, working)).toBe(false);
  });

  it('declares only ids that real collectors emit', () => {
    // Desync guard: a renamed/removed collector would leave a mask matching
    // nothing, silently reverting to always-abort for that metric.
    const emitted = new Set(COLLECTORS.map((c) => c(emptyFacts()).id));
    for (const id of VOLATILE_METRIC_IDS) expect(emitted).toContain(id);
  });
});
