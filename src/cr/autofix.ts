import { AUTOFIX_ROUND_CAP, fingerprintBlockers } from './autofix-ledger.js';
import type { AutofixLedger } from './autofix-ledger.js';
import type { Finding, Lane } from './findings-schema.js';

/** A blocker as `aggregate()` surfaces it — carries the lane that filed it. */
export type LaneBlocker = Finding & { lane: Lane };

export type AutofixVerdict = 'auto-fix' | 'decline';

/**
 * Why `decide` declined. Two values only for the verdict, with the reason
 * carried separately — `prompt`-vs-`abort` is already `autonomous.onFailure`'s
 * job, and duplicating that policy here would put the same decision in two
 * places.
 */
export type DeclineReason =
  | 'knob-off'
  | 'round-cap'
  | 'no-progress'
  | 'no-mechanical'
  | 'no-base-sha';

export interface DecideInput {
  readonly blockers: readonly LaneBlocker[];
  readonly onBlockers: 'auto-fix' | 'prompt';
  readonly ledger: AutofixLedger | null;
  /** Current `HEAD`, or `''` when git could not be reached. */
  readonly headSha: string;
}

export interface DecideResult {
  readonly verdict: AutofixVerdict;
  readonly reason: DeclineReason | null;
  readonly mechanical: readonly LaneBlocker[];
  readonly design: readonly LaneBlocker[];
  /** Authoritative `--base-sha` for the re-round. Empty only alongside `no-base-sha`. */
  readonly baseSha: string;
  readonly fingerprint: string;
  /** 1-based number this round WOULD take. */
  readonly round: number;
}

/**
 * An untagged blocker is `design`.
 *
 * The fail-safe read lives here rather than in the sink, so the sink keeps
 * recording what the reviewer actually said. Its consequence is that legacy
 * sinks, the non-classifying lanes (codex / manual / verifier), and a reviewer
 * that ignored the tagging instruction all degrade to today's behaviour instead
 * of to a silent auto-fix.
 */
function isMechanical(b: LaneBlocker): boolean {
  return b.class === 'mechanical';
}

/**
 * Resolve the `--base-sha` the re-round would use: the prior round's `headSha`
 * when non-empty, else current `HEAD`. Empty means neither is available.
 *
 * The middle rung matters because `record` degrades a failed `git rev-parse` to
 * `headSha: ''` rather than refusing to record the round; without the fallback,
 * round 2 would emit an empty `base-sha:` and the gate would invoke
 * `orchestrate --base-sha` with an empty argument.
 */
function resolveBaseSha(ledger: AutofixLedger | null, headSha: string): string {
  const priorHead = ledger?.rounds.at(-1)?.headSha ?? '';
  return priorHead !== '' ? priorHead : headSha;
}

/**
 * Decide whether the gate may auto-fix this round. Pure — no IO, no clock.
 *
 * Rules are evaluated in order and the first match wins. `mechanical` and
 * `design` are always populated so the caller can surface the split regardless
 * of the verdict: on a MIXED round the verdict is `auto-fix` with a non-empty
 * `design` list, and the controller applies the mechanical subset and then
 * prompts on the remainder WITHOUT re-rounding. Re-rounding then would buy a
 * review pass guaranteed to re-report the known design blocker, and under
 * `onFailure: 'abort'` it aborts anyway.
 */
export function decide(input: DecideInput): DecideResult {
  const mechanical = input.blockers.filter(isMechanical);
  const design = input.blockers.filter((b) => !isMechanical(b));
  const fingerprint = fingerprintBlockers(input.blockers);
  const baseSha = resolveBaseSha(input.ledger, input.headSha);
  const priorRounds = input.ledger?.rounds ?? [];
  const round = priorRounds.length + 1;

  const base = { mechanical, design, baseSha, fingerprint, round } as const;
  const decline = (reason: DeclineReason): DecideResult => ({
    ...base,
    verdict: 'decline',
    reason,
  });

  if (input.onBlockers !== 'auto-fix') return decline('knob-off');
  if (priorRounds.length >= AUTOFIX_ROUND_CAP) return decline('round-cap');
  // The same blocker set coming back means the previous fix did not take.
  // Checked before `no-mechanical` so a repeat round reports why it is futile
  // rather than merely reporting nothing left to fix.
  if (priorRounds.at(-1)?.fingerprint === fingerprint) return decline('no-progress');
  if (mechanical.length === 0) return decline('no-mechanical');
  if (baseSha === '') return decline('no-base-sha');

  return { ...base, verdict: 'auto-fix', reason: null };
}
