// Shared format contract for the SDD report's review-skip count line. Owned
// here (the report producer) and consumed by the release-script guard
// (`src/release/sdd-report-diff.ts`) so the literal lives in exactly one place —
// a wording change can't silently desync the guard's matcher from the emitter.
import type { MetricsReport } from '../metrics/types.js';

/** Literal prefix of the review-skip count line, sans the trailing number. */
export const REVIEW_SKIP_COUNT_PREFIX = 'Gated commits missing `Noldor-Reviewed` trailer: ';

/** Builds the full review-skip count line `sdd-report.ts` emits. */
export function reviewSkipCountLine(count: number): string {
  return `${REVIEW_SKIP_COUNT_PREFIX}${count}`;
}

/** Release-cut metrics snapshot. Null report (compute failure) degrades to a labeled line — never blocks release. */
export function renderMetricsSection(report: MetricsReport | null): string[] {
  if (!report) return ['## Metrics', '', 'metrics unavailable: compute failed', ''];
  const lines: string[] = ['## Metrics', ''];
  for (const m of report.metrics) {
    lines.push(`### ${m.id} [${m.unit}]`);
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
