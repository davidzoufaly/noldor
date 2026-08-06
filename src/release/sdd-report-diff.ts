// Detects whether two `docs/sdd-report.md` revisions differ only in parts that
// are environment-dependent rather than content-bearing: the non-deterministic
// review-skip count line, and the metric value blocks sourced from gitignored
// machine-local `.noldor/` state. The release script (`index.ts`) uses this to
// skip its dirty-report abort when the regen's sole changes are those.

import {
  metricHeadingPrefix,
  REVIEW_SKIP_COUNT_PREFIX,
  VOLATILE_METRIC_IDS,
} from '../garden/sdd-report-format.js';

/** Escapes regex metacharacters so a literal string can anchor a RegExp. */
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Matches the review-skip count line emitted by `sdd-report.ts`, anchored to the
 * shared {@link REVIEW_SKIP_COUNT_PREFIX} so the matcher cannot desync from the
 * emitter.
 */
const COUNT_LINE_RE = new RegExp(`^${escapeRegExp(REVIEW_SKIP_COUNT_PREFIX)}\\d+$`, 'm');

/** Stable placeholder both sides collapse to before comparison. */
const MASK = `${REVIEW_SKIP_COUNT_PREFIX}<count>`;

/** Stable placeholder replacing a volatile metric's JSON body. */
const VOLATILE_MASK = '<volatile: sourced from local .noldor state>';

/**
 * Matches the fenced JSON body under one volatile metric's heading — heading line,
 * blank line, opening fence (captured), body (replaced), closing fence (captured).
 * Anchored to {@link metricHeadingPrefix} so a heading reword moves both sides.
 */
const volatileBodyRe = (id: string): RegExp =>
  new RegExp(
    `(^${escapeRegExp(metricHeadingPrefix(id))}[^\\n]*\\n\\n\`\`\`json\\n)[\\s\\S]*?(\\n\`\`\`$)`,
    'm',
  );

/**
 * Collapses every {@link VOLATILE_METRIC_IDS} value block to {@link VOLATILE_MASK}.
 * Only the JSON body is masked — the `formula:` and `blind spots:` lines stay under
 * comparison, so a metric's *definition* changing still trips the gate.
 */
function maskVolatileMetrics(report: string): string {
  let out = report;
  for (const id of VOLATILE_METRIC_IDS) {
    out = out.replace(volatileBodyRe(id), `$1${VOLATILE_MASK}$2`);
  }
  return out;
}

/** Applies both masks, in the order the report emits them. */
const maskEnvironmental = (report: string): string =>
  maskVolatileMetrics(report.replace(COUNT_LINE_RE, MASK));

/**
 * Returns `true` when `head` and `working` are identical, or differ *only* in
 * environment-dependent sections — the review-skip count line and the metric value
 * blocks read from gitignored local `.noldor/` state; `false` on any other delta.
 *
 * Masking is anchored to the literals `sdd-report.ts` writes. If a format ever
 * changes, the mask no-ops on the side missing the pattern, the masked strings
 * won't match, and this returns `false` — failing safe toward the release script's
 * existing abort behavior.
 */
export function onlyVolatileSectionsChanged(head: string, working: string): boolean {
  return maskEnvironmental(head) === maskEnvironmental(working);
}
