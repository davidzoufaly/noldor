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
import { z } from 'zod';

import { readJsonState, writeJsonState } from '../core/state-file.js';
import type { CloneOptions, CloneReport } from './detect.js';

/** Baseline location, relative to the repo root. Tracked, not transient. */
export const BASELINE_FILE = '.noldor/clones-baseline.json';

/** A measured count: how many of something the corpus had. Never negative. */
const measured = z.number().int().nonnegative();
/** A detection floor: every knob is a positive count of tokens or lines. */
const floor = z.number().int().positive();

/**
 * Generation of the noise policy the detector applies — which structural
 * matches it declines to count as duplication at all. Generation 1 excludes
 * head-of-file import declarations and drops clone classes whose every span is
 * pure delegation; generation 0 is the policy before either existed.
 *
 * A single generation integer rather than a flag per rule: `sameOptions` stays
 * a scalar comparison, and a future noise rule bumps the number instead of
 * adding another field to a schema every consumer repo carries.
 */
export const CURRENT_NOISE_POLICY = 1;

/**
 * Detection knobs the baseline was recorded under. A baseline is only
 * comparable against a run that used the same knobs — raising `minTokens`
 * shrinks `duplicatedTokens` without anyone removing a clone.
 *
 * `noisePolicy` is optional for the same reason `perFile` is: this schema is
 * `.strict()`, so a required addition fails `safeParse` on every baseline
 * recorded before it, which `readBaseline` reports as `unreadable` rather than
 * `stale` — turning the ratchet OFF in every consumer repo at once. Absent
 * reads as generation 0, so an old baseline instead compares unequal and the
 * run reports `stale` with the re-record hint, which is the intended path.
 */
export const baselineOptionsSchema = z
  .object({
    minTokens: floor,
    minLines: floor,
    gapTokens: floor,
    includeTests: z.boolean(),
    noisePolicy: z.number().int().nonnegative().optional(),
  })
  .strict();
export type BaselineOptions = z.infer<typeof baselineOptionsSchema>;

export const cloneBaselineSchema = z
  .object({
    /** The ratchet number: clone-covered tokens across the whole corpus. */
    duplicatedTokens: measured,
    /**
     * `duplicatedTokens` split by file, so a later rise can name what moved it
     * instead of only how far. Optional because a baseline recorded before
     * attribution existed must keep parsing — a schema bump that turned every
     * such file `unreadable` would take the ratchet down across every consumer
     * repo to gain a reporting nicety.
     */
    perFile: z.record(z.string(), measured).optional(),
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
    perFile: report.perFile,
    duplicationPct: report.duplicationPct,
    totalTokens: report.totalTokens,
    groups: report.groups.length,
    filesScanned: report.filesScanned,
    options: {
      minTokens: opts.minTokens,
      minLines: opts.minLines,
      gapTokens: opts.gapTokens,
      includeTests,
      noisePolicy: CURRENT_NOISE_POLICY,
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
  writeJsonState(path, baseline);
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

/**
 * The `?? 0` equates a legacy baseline's ABSENT value with an explicit
 * `noisePolicy: 0` — that is all it buys. It is not what guards the
 * optionality trap: two `undefined`s already compare equal. The guard is that
 * both write sites stamp {@link CURRENT_NOISE_POLICY}.
 */
const sameOptions = (a: BaselineOptions, b: BaselineOptions): boolean =>
  a.minTokens === b.minTokens &&
  a.minLines === b.minLines &&
  a.gapTokens === b.gapTokens &&
  a.includeTests === b.includeTests &&
  (a.noisePolicy ?? 0) === (b.noisePolicy ?? 0);

const describeOptions = (o: BaselineOptions): string =>
  `min-tokens ${o.minTokens}, min-lines ${o.minLines}, gap-tokens ${o.gapTokens}, ` +
  `include-tests ${o.includeTests}, noise-policy ${o.noisePolicy ?? 0}`;

/** One file whose clone-covered token count grew between two runs. */
export interface RatchetOffender {
  readonly file: string;
  readonly from: number;
  readonly to: number;
  readonly delta: number;
}

/**
 * Files whose clone coverage grew, largest rise first (ties by path, so the
 * list is stable across runs).
 *
 * Empty when `before` is absent: a baseline recorded before attribution
 * existed cannot answer which files moved, and the honest answer is to say so
 * rather than to list every duplicated file in the current run as though each
 * were new.
 *
 * Because the two maps each sum to their run's `duplicatedTokens`, a rise in
 * the total guarantees at least one entry here — the caller never has to
 * handle "it went up but nothing grew".
 */
export function ratchetOffenders(
  before: Readonly<Record<string, number>> | undefined,
  after: Readonly<Record<string, number>>,
): readonly RatchetOffender[] {
  if (before === undefined) return [];
  const risen: RatchetOffender[] = [];
  for (const [file, to] of Object.entries(after)) {
    const from = before[file] ?? 0;
    if (to > from) risen.push({ file, from, to, delta: to - from });
  }
  return risen.sort((a, b) => b.delta - a.delta || a.file.localeCompare(b.file));
}

/**
 * Cap on the named files. A rise is normally a handful of files, but an
 * options change or a large refactor can move dozens, and a wall of them
 * buries the top offenders that actually explain the number.
 */
const OFFENDER_CAP = 10;

const renderOffenders = (offenders: readonly RatchetOffender[]): string => {
  const lines = offenders
    .slice(0, OFFENDER_CAP)
    .map((o) => `    ${o.file} ${o.from} -> ${o.to} (+${o.delta})`);
  const hidden = offenders.length - lines.length;
  if (hidden > 0) lines.push(`    ... and ${hidden} more file(s)`);
  return lines.join('\n');
};

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
  // `noisePolicy` MUST be stamped here. It is optional, so omitting it is not
  // a type error — and `undefined` compares equal to a legacy baseline's
  // absent value, so `sameOptions` would pass and this run would report the
  // new, lower number as green-with-a-hint instead of `stale`. No diagnostic,
  // no visible symptom: the number would simply look like an improvement.
  const now: BaselineOptions = { ...opts, includeTests, noisePolicy: CURRENT_NOISE_POLICY };
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
    const offenders = ratchetOffenders(baseline.perFile, report.perFile);
    // A number with no evidence behind it forces the operator to diff group
    // lists between branches by hand; naming the files is the whole remedy.
    const attribution =
      baseline.perFile === undefined
        ? `\n  baseline predates per-file attribution - re-record with 'noldor clones baseline' ` +
          `so the next rise can name its files`
        : `\n  files that moved the total:\n${renderOffenders(offenders)}`;
    return {
      kind: 'red',
      message:
        `duplicated tokens rose ${baseline.duplicatedTokens} -> ${report.duplicatedTokens} (+${delta}) ` +
        `above the baseline recorded ${baseline.recordedAt}${attribution}`,
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
