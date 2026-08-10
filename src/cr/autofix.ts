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
  | 'lanes-in-flight'
  | 'prior-deferred'
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
  /**
   * `aggregate().unresolved` — lanes with a sink but no `finishedAt`. Non-empty
   * means the blocker set is still provisional, so the round must not run.
   */
  readonly unresolved: readonly Lane[];
}

/**
 * What the controller must do next, as a value rather than something inferred
 * from the printed `design:` count. `apply-then-stop` is the MIXED round: the
 * mechanical subset is auto-fixable but a design blocker rides along, so
 * re-rounding would only re-report it. The CLI maps this to its own exit code
 * so a prose-dispatch runner branches on a number, never on stdout prose.
 */
export type NextAction = 'reround' | 'apply-then-stop' | 'operator';

export interface DecideResult {
  readonly verdict: AutofixVerdict;
  readonly reason: DeclineReason | null;
  readonly next: NextAction;
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
 * Resolve the `--base-sha` the re-round would use: current `HEAD` when non-empty,
 * else the prior round's recorded `headSha`. Empty means neither is available.
 *
 * CURRENT `HEAD` FIRST, deliberately. The value names the pre-fix point of the
 * round about to run, and at `plan` time that is exactly `HEAD` — the fix commit
 * has not been made yet. The prior round's `headSha` is strictly worse on both
 * counts: anything that landed between `record` and this `plan` widens the
 * re-round's review window to include it, and the code-stage receipt amend
 * rewrites the tip, so a recorded sha can become an unreferenced object and
 * `orchestrate --base-sha <sha>` then fails on a gc'd commit.
 *
 * The fallback still matters because `record` degrades a failed `git rev-parse`
 * to `headSha: ''` rather than refusing to record the round; without a second
 * rung, a `plan` whose own `rev-parse` failed would emit an empty `base-sha:`
 * and the gate would invoke `orchestrate --base-sha` with an empty argument.
 */
function resolveBaseSha(ledger: AutofixLedger | null, headSha: string): string {
  const priorHead = ledger?.rounds.at(-1)?.headSha ?? '';
  return headSha !== '' ? headSha : priorHead;
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
    next: 'operator',
  });

  if (input.onBlockers !== 'auto-fix') return decline('knob-off');
  // An unfinished lane makes every downstream rule rest on a partial blocker
  // set: `aggregate` is red on `unresolved` alone, so the re-round could not go
  // green until that lane lands, and the autonomous re-round would archive its
  // in-flight sink (`guardLaneOverwrite` defaults to `archive` under
  // `--autonomous`) — after which the late writer lands pre-fix findings over
  // the archive. Checked second: only the knob, a pure policy read, outranks it.
  if (input.unresolved.length > 0) return decline('lanes-in-flight');
  // A prior round that deferred a blocker must not be re-rounded, or the loop
  // launders an unfixed blocker into a green: the re-round is `--base-sha`-scoped
  // to the fix diff, the deferred blocker is not in that diff, so it never
  // reappears, orchestrate overwrites the sink that held it, and `aggregate` goes
  // green with the blocker still live. The prose telling the controller to apply
  // EVERY `M<n>` cannot be the only guard — the same class of promise `next`
  // replaced. Handing it to the operator is the fail-safe direction.
  if ((priorRounds.at(-1)?.deferred ?? 0) > 0) return decline('prior-deferred');
  if (priorRounds.length >= AUTOFIX_ROUND_CAP) return decline('round-cap');
  // The same blocker set coming back means the previous fix did not take.
  // Checked before `no-mechanical` so a repeat round reports why it is futile
  // rather than merely reporting nothing left to fix. The LAST round is the whole
  // history that can reach here: `round-cap` above already declined anything with
  // {@link AUTOFIX_ROUND_CAP} prior rounds, so at most one exists.
  if (priorRounds.at(-1)?.fingerprint === fingerprint) return decline('no-progress');
  if (mechanical.length === 0) return decline('no-mechanical');
  if (baseSha === '') return decline('no-base-sha');

  return {
    ...base,
    verdict: 'auto-fix',
    reason: null,
    next: design.length > 0 ? 'apply-then-stop' : 'reround',
  };
}
