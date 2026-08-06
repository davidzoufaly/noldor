// Shared format contract for the SDD report's environment-dependent parts — the
// review-skip count line and the metric section headings. Owned here (the report
// producer) and consumed by the release-script guard
// (`src/release/sdd-report-diff.ts`) so the literals live in exactly one place —
// a wording change can't silently desync the guard's matcher from the emitter.
import type { MetricsReport } from '../metrics/types.js';

/** Literal prefix of the review-skip count line, sans the trailing number. */
export const REVIEW_SKIP_COUNT_PREFIX = 'Gated commits missing `Noldor-Reviewed` trailer: ';

/** Builds the full review-skip count line `sdd-report.ts` emits. */
export function reviewSkipCountLine(count: number): string {
  return `${REVIEW_SKIP_COUNT_PREFIX}${count}`;
}

/**
 * Metric ids whose rendered `value` block is derived from gitignored, machine-local
 * `.noldor/` state (CR sinks, `drain-state.json`, `agent-events.jsonl`,
 * `escalations.jsonl`) rather than from git. A regen run in a worktree starts from
 * an empty `.noldor/` and so writes different numbers than the main workspace —
 * environment drift, not content drift. The release gate masks these blocks before
 * diffing (`src/release/sdd-report-diff.ts`).
 *
 * Metrics derived purely from git (commits, tags, feature MDs, roadmap history) are
 * deliberately absent: their drift is real and must still abort the release.
 */
export const VOLATILE_METRIC_IDS: readonly string[] = [
  'cr-effectiveness',
  'drain-reliability',
  'tokens-per-feature',
];

/**
 * Prefix of the heading line {@link renderMetricsSection} emits for a metric —
 * the anchor the release-gate mask matches on. Unit-agnostic so the mask survives
 * a unit reword.
 */
export function metricHeadingPrefix(id: string): string {
  return `### ${id} [`;
}

/** Full metric heading line, e.g. `### cycle-time [days]`. */
export function metricHeading(id: string, unit: string): string {
  return `${metricHeadingPrefix(id)}${unit}]`;
}

/** Release-cut metrics snapshot. Null report (compute failure) degrades to a labeled line — never blocks release. */
export function renderMetricsSection(report: MetricsReport | null): string[] {
  if (!report) return ['## Metrics', '', 'metrics unavailable: compute failed', ''];
  const lines: string[] = ['## Metrics', ''];
  for (const m of report.metrics) {
    lines.push(metricHeading(m.id, m.unit));
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(m.value, null, 2));
    lines.push('```');
    lines.push('');
    lines.push(`formula: ${m.formula}`);
    lines.push(`blind spots: ${m.blindSpots.join(' | ')}`);
    lines.push('');
  }
  return lines;
}
