/**
 * Whole-corpus duplication ratchet. `.noldor/clones-baseline.json` records how
 * much duplication a repo already carries; `clones check` then reds only when
 * that number *grows*. This is the no-tuning sibling of `clones.thresholdPct`:
 * a threshold has to be guessed (and an unset one is permanently green),
 * whereas a baseline is recorded from the corpus itself and can only be
 * ratcheted down.
 *
 * The ratchet compares `duplicatedTokens` (absolute), not `duplicationPct`.
 * The percentage moves for reasons that have nothing to do with duplication —
 * deleting a large clean file raises it, adding clean code lowers it — so a
 * ratchet on the ratio would red on innocent changes and silently accumulate
 * slack on others. Absolute duplicated tokens move only when clone coverage
 * moves, which is the thing being ratcheted. The ratio dimension is already
 * covered by `thresholdPct`.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { z } from 'zod';

import { atomicWriteFileSync } from '../core/atomic-write.js';
import { readJsonState } from '../core/state-file.js';
import type { CloneOptions, CloneReport } from './detect.js';

/** Baseline location, relative to the repo root. Tracked, not transient. */
export const BASELINE_FILE = '.noldor/clones-baseline.json';

/** A measured count: how many of something the corpus had. Never negative. */
const measured = z.number().int().nonnegative();
/** A detection floor: every knob is a positive count of tokens or lines. */
const floor = z.number().int().positive();

/**
 * Detection knobs the baseline was recorded under. A baseline is only
 * comparable against a run that used the same knobs — raising `minTokens`
 * shrinks `duplicatedTokens` without anyone removing a clone.
 */
export const baselineOptionsSchema = z
  .object({ minTokens: floor, minLines: floor, gapTokens: floor, includeTests: z.boolean() })
  .strict();
export type BaselineOptions = z.infer<typeof baselineOptionsSchema>;

export const cloneBaselineSchema = z
  .object({
    /** The ratchet number: clone-covered tokens across the whole corpus. */
    duplicatedTokens: measured,
    /** Recorded for the human reading the file; never compared. */
    duplicationPct: z.number().nonnegative(),
    totalTokens: measured,
    groups: measured,
    filesScanned: measured,
    options: baselineOptionsSchema,
    recordedAt: z.string().min(1),
  })
  .strict();
export type CloneBaseline = z.infer<typeof cloneBaselineSchema>;

/** Snapshot `report` as a baseline. `recordedAt` is injected — no clock here. */
export function buildBaseline(
  report: CloneReport,
  opts: CloneOptions,
  includeTests: boolean,
  recordedAt: string,
): CloneBaseline {
  return {
    duplicatedTokens: report.duplicatedTokens,
    duplicationPct: report.duplicationPct,
    totalTokens: report.totalTokens,
    groups: report.groups.length,
    filesScanned: report.filesScanned,
    options: {
      minTokens: opts.minTokens,
      minLines: opts.minLines,
      gapTokens: opts.gapTokens,
      includeTests,
    },
    recordedAt,
  };
}

/**
 * Outcome of looking for a baseline. `absent` is the adopt-me state (no file
 * yet); `unreadable` is a file that exists but cannot be trusted — kept
 * distinct so the caller can say "could not look" instead of "clean".
 */
export type BaselineRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'ok'; readonly baseline: CloneBaseline }
  | { readonly kind: 'unreadable'; readonly reason: string };

export function readBaseline(path: string): BaselineRead {
  // `readJsonState` owns the absent-vs-corrupt split (its throw covers both an
  // unreadable file and unparseable JSON); only schema validity is left here.
  let json: unknown;
  try {
    json = readJsonState<unknown>(path);
  } catch (err) {
    return { kind: 'unreadable', reason: err instanceof Error ? err.message : String(err) };
  }
  if (json === undefined) return { kind: 'absent' };
  const parsed = cloneBaselineSchema.safeParse(json);
  if (!parsed.success) return { kind: 'unreadable', reason: 'not a valid clones baseline' };
  return { kind: 'ok', baseline: parsed.data };
}

/** Write `baseline` atomically, creating its parent directory if needed. */
export function writeBaseline(path: string, baseline: CloneBaseline): void {
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
}

/**
 * Ratchet verdict. `stale` means the baseline was recorded under different
 * detection knobs, so the two numbers are not comparable — reported, never
 * red, because the mismatch is a config change rather than new duplication.
 */
export type RatchetVerdict =
  | { readonly kind: 'red'; readonly message: string }
  | { readonly kind: 'green'; readonly message: string }
  | { readonly kind: 'stale'; readonly message: string };

const sameOptions = (a: BaselineOptions, b: BaselineOptions): boolean =>
  a.minTokens === b.minTokens &&
  a.minLines === b.minLines &&
  a.gapTokens === b.gapTokens &&
  a.includeTests === b.includeTests;

const describeOptions = (o: BaselineOptions): string =>
  `min-tokens ${o.minTokens}, min-lines ${o.minLines}, gap-tokens ${o.gapTokens}, include-tests ${o.includeTests}`;

/**
 * Compare `report` against `baseline`. Red on any increase in duplicated
 * tokens; green on equal; green with a re-record hint on a decrease, since
 * nothing else lowers the recorded number and an un-ratcheted baseline quietly
 * grants slack for the next change.
 */
export function compareToBaseline(
  report: CloneReport,
  baseline: CloneBaseline,
  opts: CloneOptions,
  includeTests: boolean,
): RatchetVerdict {
  const now: BaselineOptions = { ...opts, includeTests };
  if (!sameOptions(baseline.options, now)) {
    return {
      kind: 'stale',
      message:
        `baseline recorded under different options (${describeOptions(baseline.options)}) ` +
        `than this run (${describeOptions(now)}) - not comparable, skipped\n` +
        `  re-record with 'noldor clones baseline' to ratchet against the current options`,
    };
  }
  const delta = report.duplicatedTokens - baseline.duplicatedTokens;
  if (delta > 0) {
    return {
      kind: 'red',
      message:
        `duplicated tokens rose ${baseline.duplicatedTokens} -> ${report.duplicatedTokens} (+${delta}) ` +
        `above the baseline recorded ${baseline.recordedAt}`,
    };
  }
  if (delta < 0) {
    return {
      kind: 'green',
      message:
        `duplicated tokens fell ${baseline.duplicatedTokens} -> ${report.duplicatedTokens} (${delta}) - green\n` +
        `  lock the improvement in with 'noldor clones baseline'`,
    };
  }
  return {
    kind: 'green',
    message: `duplicated tokens at baseline ${report.duplicatedTokens} - green`,
  };
}
