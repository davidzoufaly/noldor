// pre-push stage: refuses a bare free-text `Noldor-Path-Override` on a series
// whose round cap is spent and still red.
//
// `enforceReviewReceipt` returns `{ ok: true }` the moment it sees any
// `Noldor-Path-Override`. That early return is the escape hatch this guard
// closes — and only for the one case where a machine-readable answer exists to
// demand.
import { AUTOFIX_ROUND_CAP } from '../cr/autofix-ledger.js';
import { parseArbitrationTrailer } from '../cr/arbitration.js';

/** What the guard needs to know about the round ledger. `null` = none on disk. */
export interface LedgerFacts {
  readonly rounds: readonly { readonly round: number; readonly verdict: 'green' | 'red' }[];
}

/** What the guard needs to know about the record. `null` = none on disk. */
export interface RecordFacts {
  readonly digest: string;
  readonly filled: boolean;
  readonly boundTree: string;
  readonly currentTree: string;
}

export interface ArbitrationDecision {
  readonly ok: boolean;
  readonly reason?: string;
  readonly warning?: string;
}

/**
 * Pure decision. Every I/O question — which commits, which slug, which ledger —
 * is answered by the caller, so the policy itself is testable from literals.
 *
 * The predicate is CAP REACHED AND LAST ROUND RED, not "any red round". A loop
 * that went red and then converged green has red rounds in its ledger but never
 * triggered a cap refusal, so no skeleton was ever written; refusing there would
 * trap an operator overriding for an unrelated reason (verify-lane infra red,
 * the Q-0185 case) with no record to fill and no way through.
 */
export function decideArbitration(input: {
  override: string | null;
  ledger: LedgerFacts | null;
  record: RecordFacts | null;
}): ArbitrationDecision {
  if (input.override === null) return { ok: true };

  // Fail OPEN, loudly. No ledger means no proof any red round happened, and a
  // deleted ledger is indistinguishable from a session that never ran
  // orchestrate at all — which is most overrides in this repo (micro-chore,
  // fast-track, a doc fix). The printed line is what keeps the hole visible.
  if (input.ledger === null)
    return { ok: true, warning: 'pre-push: could not verify arbitration — no round ledger found' };

  const red = input.ledger.rounds.filter((r) => r.verdict === 'red').length;
  const lastRed = input.ledger.rounds.at(-1)?.verdict === 'red';
  if (red <= AUTOFIX_ROUND_CAP || !lastRed) return { ok: true };

  const claimed = parseArbitrationTrailer(input.override);
  if (claimed === null)
    return {
      ok: false,
      reason:
        'pre-push: the round cap is spent and the last round is red, so a bare override is not ' +
        'enough. Fill the arbitration record and name it: ' +
        'Noldor-Path-Override: cr-arbitration <digest> — <why>',
    };
  if (input.record === null)
    return { ok: false, reason: `pre-push: no arbitration record on disk for digest ${claimed}` };
  if (input.record.boundTree !== input.record.currentTree)
    return {
      ok: false,
      reason:
        `pre-push: the arbitration record is stale — it is bound to tree ` +
        `${input.record.boundTree}, but HEAD's tree is ${input.record.currentTree}`,
    };
  if (input.record.digest !== claimed)
    return {
      ok: false,
      reason: `pre-push: trailer names digest ${claimed} but the record on disk digests to ${input.record.digest}`,
    };
  if (!input.record.filled)
    return {
      ok: false,
      reason: 'pre-push: the arbitration record has a blocker with no disposition',
    };
  return { ok: true };
}
