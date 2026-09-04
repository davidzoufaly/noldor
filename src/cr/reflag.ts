/**
 * Re-flag rules — why a review loop looks like it is oscillating.
 *
 * Shaped after `src/core/split-suggestion.ts`: exported constants, one function
 * per rule, no I/O, no clock. The caller fetches; this module reasons. That is
 * what makes every rule testable from literals with no fixture repo, and it
 * keeps I/O failure handling out of a module whose whole contract is that it
 * cannot fail.
 *
 * ADVISORY WITH TEETH. A signal never suppresses a finding, never edits a sink,
 * and never moves an exit code. It is reported; the operator decides.
 */
import type { FindingLocation } from './findings-schema.js';

/** A blocker reduced to what the rules need. */
export interface RuleBlocker {
  readonly id: string;
  readonly severity: 'high' | 'med' | 'low';
  readonly message: string;
  readonly locations?: readonly FindingLocation[];
}

/** One reason a blocker looks like a re-flag. */
export interface ReflagSignal {
  readonly rule: 'R1' | 'R2' | 'R3';
  readonly blockerId: string;
  readonly message: string;
}

/**
 * A rule reports one of THREE outcomes, not two.
 *
 * `split-suggestion.ts` emits only fired/clear because its input is always
 * available. Here an input can be missing — a file that would not scan, a range
 * that is not a fast-forward, a git call that failed — and a two-arm shape
 * would encode "could not tell" as silence, which is the one reading a detector
 * must never produce.
 */
export type RuleResult =
  | { readonly outcome: 'fired'; readonly signals: readonly ReflagSignal[] }
  | { readonly outcome: 'clear' }
  | { readonly outcome: 'omitted'; readonly reason: string };

const CLEAR: RuleResult = { outcome: 'clear' };

/** Shared by every rule: no signals is `clear`, never an empty `fired`. */
export function fired(signals: readonly ReflagSignal[]): RuleResult {
  return signals.length > 0 ? { outcome: 'fired', signals } : CLEAR;
}

/**
 * R1 — repeat. A blocker whose id appeared in a prior round.
 *
 * `priorRounds` is one id list per prior round. `undefined` means the ledger
 * recorded no ids (every round written before that field existed), which is
 * `omitted` rather than `clear`: the rule genuinely could not run. An EMPTY
 * array is different and IS clear — a first round has no history, and "nothing
 * repeated because nothing came before" is a real answer.
 */
export function ruleR1(
  blockers: readonly RuleBlocker[],
  priorRounds: readonly (readonly string[])[] | undefined,
): RuleResult {
  if (priorRounds === undefined)
    return { outcome: 'omitted', reason: 'no recorded blocker ids in the ledger' };
  const prior = new Set(priorRounds.flat());
  return fired(
    blockers
      .filter((b) => prior.has(b.id))
      .map((b) => ({
        rule: 'R1' as const,
        blockerId: b.id,
        message: `blocker repeats a prior round — the same finding survived a fix: ${b.message}`,
      })),
  );
}

/**
 * R3 — contradiction. A blocker located on a line the series introduced.
 *
 * `introducedByFile` is measured CUMULATIVELY by the caller, from the series'
 * first round's `headSha` to current `HEAD`. A single prior round's range is
 * expressed in that fix's coordinates and every later fix shifts them, so from
 * round 3 on a per-round range both misses and misfires; one cumulative range
 * keeps introduced lines in the same coordinate space as a finding's location.
 *
 * `undefined` means the caller could not produce a trustworthy range — most
 * often because the series is not a fast-forward (a rebase onto a moved
 * `origin/main` puts every upstream-added line inside it). That is `omitted`,
 * never `clear`.
 */
export function ruleR3(
  blockers: readonly RuleBlocker[],
  introducedByFile: ReadonlyMap<string, ReadonlySet<number>> | undefined,
): RuleResult {
  if (introducedByFile === undefined)
    return {
      outcome: 'omitted',
      reason: 'introduced-line range unavailable — the series is not a fast-forward',
    };
  const signals: ReflagSignal[] = [];
  for (const b of blockers) {
    for (const loc of b.locations ?? []) {
      if (loc.line === undefined) continue;
      if (introducedByFile.get(loc.file)?.has(loc.line)) {
        signals.push({
          rule: 'R3',
          blockerId: b.id,
          message: `blocker at ${loc.file}:${loc.line} is about a line this series introduced`,
        });
        break;
      }
    }
  }
  return fired(signals);
}
