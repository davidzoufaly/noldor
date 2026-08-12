// Text rendering for the preflight report.
//
// Ordered blocking → warn → ok → skipped so the actionable part is read first,
// and closed with a counts line plus an explicit "not run" line: the aggregate
// deliberately skips the consumer's expensive scripts, and a green report that
// stayed silent about that would read as broader coverage than it has.
import type { PreflightRow, PreflightStatus } from './preflight-types.js';

/** Consumer scripts the aggregate does NOT run — stated, not implied. */
export const NOT_RUN_BY_PREFLIGHT: readonly string[] = [
  'typecheck',
  'test',
  'test:smoke',
  'test:e2e',
  'build',
  'docs:build',
];

const ORDER: readonly PreflightStatus[] = ['blocking', 'warn', 'ok', 'skipped'];

/** Column width for the id, so details line up without a table library. */
function idWidth(rows: readonly PreflightRow[]): number {
  return rows.reduce((w, r) => Math.max(w, r.id.length), 0);
}

/**
 * Render the report. Rows are grouped by severity in {@link ORDER}, preserving
 * the probe order within each group, so the output is deterministic and
 * diffable across runs.
 */
export function renderPreflight(rows: readonly PreflightRow[]): string {
  const counts = new Map<PreflightStatus, number>(ORDER.map((s) => [s, 0]));
  for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);

  const width = idWidth(rows);
  const lines: string[] = [];
  const blocking = counts.get('blocking') ?? 0;
  lines.push(
    `preflight: ${blocking} blocking, ${counts.get('warn') ?? 0} warn, ` +
      `${counts.get('ok') ?? 0} ok, ${counts.get('skipped') ?? 0} skipped`,
  );
  lines.push('');

  for (const status of ORDER) {
    for (const r of rows.filter((row) => row.status === status)) {
      const label = status === 'blocking' ? 'FAIL' : status.toUpperCase();
      lines.push(`${label.padEnd(8)}${r.id.padEnd(width + 2)}${r.detail}`);
      if (r.fix !== undefined && (status === 'blocking' || status === 'warn')) {
        lines.push(`${' '.repeat(8)}${' '.repeat(width + 2)}fix: ${r.fix}`);
      }
    }
  }

  lines.push('');
  lines.push(`not run (not covered by preflight): ${NOT_RUN_BY_PREFLIGHT.join(' ')}`);
  return lines.join('\n');
}
