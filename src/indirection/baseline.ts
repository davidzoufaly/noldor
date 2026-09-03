/**
 * Whole-corpus indirection ratchet. `.noldor/indirection-baseline.json` records
 * the excess sum a repo already carries; `indirection check` then reds only when
 * that number GROWS.
 *
 * A knob mismatch is `stale` — reported, never red — following
 * `src/clones/baseline.ts`. `scanRoots` and `includeTests` are consumer-owned,
 * so reding on a mismatch would hard-block every push in a repo that merely
 * edited `scanPaths`, and no framework migration can ship for a knob the
 * framework does not own.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import { atomicWriteFileSync } from '../core/atomic-write.js';
import { readJsonState } from '../core/state-file.js';
import type { MeasuredIndirection } from './detect.js';

/** Baseline location, relative to the repo root. Tracked, not transient. */
export const BASELINE_FILE = '.noldor/indirection-baseline.json';

/**
 * Bumped whenever the closure traversal changes. `options` alone cannot catch a
 * change in how the number is COMPUTED — a fix to alias handling moves every
 * closure without moving a knob — and silently comparing across that boundary is
 * worse than reporting stale.
 */
export const ALGORITHM_VERSION = 1;

const count = z.number().int().nonnegative();

export const baselineOptionsSchema = z
  .object({
    threshold: z.number().int().positive(),
    scanRoots: z.array(z.string().min(1)),
    includeTests: z.boolean(),
  })
  .strict();
export type BaselineOptions = z.infer<typeof baselineOptionsSchema>;

export const indirectionBaselineSchema = z
  .object({
    /** The ratchet number: total closure above the threshold. */
    excessSum: count,
    /** Recorded for the human reading the file; never compared. */
    flaggedModules: count,
    modulesScanned: count,
    /** null when the corpus was empty — nearest-rank is undefined on no data. */
    percentiles: z
      .object({ p50: count, p75: count, p90: count, p99: count, max: count })
      .strict()
      .nullable(),
    options: baselineOptionsSchema,
    algorithmVersion: z.number().int().positive(),
    recordedAt: z.string().min(1),
  })
  .strict();
export type IndirectionBaseline = z.infer<typeof indirectionBaselineSchema>;

/**
 * An empty corpus is recordable: leaving it unrecorded would let the first
 * commit that adds source files pass unratcheted, since `check` treats an absent
 * baseline as green.
 */
export function buildEmptyBaseline(
  options: BaselineOptions,
  recordedAt: string,
): IndirectionBaseline {
  return {
    excessSum: 0,
    flaggedModules: 0,
    modulesScanned: 0,
    percentiles: null,
    options,
    algorithmVersion: ALGORITHM_VERSION,
    recordedAt,
  };
}

export function buildBaseline(
  result: MeasuredIndirection,
  options: BaselineOptions,
  recordedAt: string,
): IndirectionBaseline {
  return {
    excessSum: result.excessSum,
    flaggedModules: result.flagged.length,
    modulesScanned: result.modules.length,
    percentiles: result.percentiles,
    options,
    algorithmVersion: ALGORITHM_VERSION,
    recordedAt,
  };
}

export type BaselineRead =
  | { readonly kind: 'ok'; readonly baseline: IndirectionBaseline }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly message: string };

export function readBaseline(path: string): BaselineRead {
  let raw: unknown;
  try {
    raw = readJsonState(path);
  } catch (e) {
    // readJsonState throws StateFileCorruptError on unparseable content; the
    // file is an external boundary, so convert rather than propagate.
    return { kind: 'unreadable', message: e instanceof Error ? e.message : String(e) };
  }
  if (raw === undefined) return { kind: 'absent' };
  const parsed = indirectionBaselineSchema.safeParse(raw);
  return parsed.success
    ? { kind: 'ok', baseline: parsed.data }
    : { kind: 'unreadable', message: parsed.error.message };
}

export function writeBaseline(path: string, baseline: IndirectionBaseline): void {
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
}

/**
 * The four failure shapes are kept apart because each leaves the consumer's
 * NEXT `indirection check` in a different state, and a caller's warning is only
 * useful if it names the right one:
 *
 * - `unreadable` — the file is there and unparseable. `check` reports
 *   `could-not-look` and exits 3; the next push hard-fails until it is
 *   re-recorded or deleted.
 * - `recorder-refused` — recording ran and declined (always exit 3 today), and
 *   every cause it declines for is evaluated before the subcommand split: usage,
 *   unresolvable scan roots, no parser, unresolved in-scope imports. So `check`
 *   hits the same branch and also exits 3, for the same reason.
 * - `recorder-threw` — nothing was written, so the baseline stays absent and
 *   `check` takes the fail-open branch: green, ratchet inert.
 */
export type SeedOutcome =
  | { readonly kind: 'already-recorded' }
  | { readonly kind: 'recorded' }
  | { readonly kind: 'unreadable'; readonly message: string }
  | { readonly kind: 'recorder-refused'; readonly code: number }
  | { readonly kind: 'recorder-threw'; readonly message: string };

/**
 * Record a baseline on a repo that has never recorded one — the seam that arms
 * the ratchet on a consumer install.
 *
 * `indirection check` reports green on an absent baseline deliberately (a repo
 * mid-adoption must not be hard-blocked by a file no command has written yet),
 * and nothing else in the flow ever closes that branch. So a consumer whose
 * pre-push block runs `check` gets a green verdict on every push forever,
 * against a ceiling that does not exist — the guard is installed and inert.
 *
 * The recorder is a parameter rather than an import for two reasons:
 * `indirection-cli` imports this module, so importing it back would close a
 * cycle; and recording means running dependency-cruiser over the whole corpus,
 * which is the boundary a caller defers (nothing is loaded when the baseline is
 * already present) and a test fakes.
 *
 * Never overwrites. A present-but-unreadable baseline is left alone for `check`
 * to report as exit 3: replacing it here would silently re-record the ceiling a
 * red was about to be measured against.
 *
 * Never throws either, which is the load-bearing half of the contract: callers
 * arm the ratchet as one step of a longer command, and a repo whose baseline
 * could not be written must still finish that command.
 */
export async function seedBaselineIfAbsent(
  cwd: string,
  record: (cwd: string) => Promise<number>,
): Promise<SeedOutcome> {
  const prior = readBaseline(join(cwd, BASELINE_FILE));
  if (prior.kind === 'ok') return { kind: 'already-recorded' };
  if (prior.kind === 'unreadable') return { kind: 'unreadable', message: prior.message };
  let code: number;
  try {
    code = await record(cwd);
  } catch (e) {
    // The recorder is a filesystem boundary as well as a parser one: recording
    // ends in `writeBaseline`, which does `mkdirSync` + an atomic rename, so
    // EACCES or ENOSPC on `.noldor/` throws instead of returning an exit code.
    // Converting it here is what keeps the no-throw guarantee above true — for
    // `init` a propagated throw aborts the scaffold part-way, before the
    // framework anchor is stamped, and the consumer is then told it has a
    // version skew it does not have.
    return { kind: 'recorder-threw', message: e instanceof Error ? e.message : String(e) };
  }
  return code === 0 ? { kind: 'recorded' } : { kind: 'recorder-refused', code };
}

export type RatchetVerdict =
  | { readonly kind: 'red'; readonly message: string }
  | { readonly kind: 'green'; readonly message: string }
  | { readonly kind: 'stale'; readonly message: string };

function describeOptions(o: BaselineOptions): string {
  return `threshold=${o.threshold} roots=${o.scanRoots.join(',')} includeTests=${o.includeTests}`;
}

function sameOptions(a: BaselineOptions, b: BaselineOptions): boolean {
  return (
    a.threshold === b.threshold &&
    a.includeTests === b.includeTests &&
    a.scanRoots.length === b.scanRoots.length &&
    a.scanRoots.every((r, i) => r === b.scanRoots[i])
  );
}

export function compareToBaseline(
  result: MeasuredIndirection,
  baseline: IndirectionBaseline,
  options: BaselineOptions,
): RatchetVerdict {
  if (baseline.algorithmVersion !== ALGORITHM_VERSION) {
    return {
      kind: 'stale',
      message:
        `baseline recorded under algorithm version ${baseline.algorithmVersion}, this run is ` +
        `${ALGORITHM_VERSION} - not comparable, skipped\n` +
        `  re-record with 'noldor indirection baseline'`,
    };
  }
  if (!sameOptions(baseline.options, options)) {
    return {
      kind: 'stale',
      message:
        `baseline recorded under different options (${describeOptions(baseline.options)}) ` +
        `than this run (${describeOptions(options)}) - not comparable, skipped\n` +
        `  re-record with 'noldor indirection baseline'`,
    };
  }
  const delta = result.excessSum - baseline.excessSum;
  if (delta > 0) {
    return {
      kind: 'red',
      message:
        `indirection excess rose ${baseline.excessSum} -> ${result.excessSum} (+${delta}) ` +
        `above the baseline recorded ${baseline.recordedAt}`,
    };
  }
  return {
    kind: 'green',
    message:
      delta === 0
        ? `indirection excess unchanged at ${result.excessSum}`
        : `indirection excess fell ${baseline.excessSum} -> ${result.excessSum} (${delta})`,
  };
}
