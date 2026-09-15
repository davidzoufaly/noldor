// @tests: specs-cr-gate-multi-reviewer
import { describe, expect, it } from 'vitest';

import { decideArbitration, enforceArbitration } from '../noldor-enforce-arbitration.js';
import type { RecordFacts } from '../noldor-enforce-arbitration.js';

const cappedRounds = [
  { round: 1, verdict: 'red' as const },
  { round: 2, verdict: 'red' as const },
  { round: 3, verdict: 'red' as const },
];

const capped = { rounds: cappedRounds };

/** A filled record bound to the tree being pushed, overridable per case. */
const freshRecord = (over: Partial<RecordFacts> = {}): RecordFacts => ({
  digest: 'abc123abc123',
  filled: true,
  boundTree: 'T',
  currentTree: 'T',
  rounds: cappedRounds,
  blockerCount: 2,
  ...over,
});

describe('decideArbitration', () => {
  it('refuses a bare override on a capped, still-red series', () => {
    const r = decideArbitration({ override: 'shipping anyway', ledger: capped, record: null });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/arbitration record/i);
  });

  // The predicate is "cap reached", not "any red round". A loop that went red
  // and converged green never triggered a refusal, so no skeleton exists and
  // there is nothing to fill.
  it('allows a bare override when the series converged green', () => {
    const converged = { rounds: [...capped.rounds, { round: 4, verdict: 'green' as const }] };
    expect(decideArbitration({ override: 'x', ledger: converged, record: null }).ok).toBe(true);
  });

  it('allows a bare override below the cap', () => {
    const under = { rounds: [{ round: 1, verdict: 'red' as const }] };
    expect(decideArbitration({ override: 'x', ledger: under, record: null }).ok).toBe(true);
  });

  // Fail OPEN, loudly. A deleted ledger and a session that never hit the cap are
  // indistinguishable, and refusing here would block every honest micro-chore
  // and fast-track override.
  it('allows and warns when no ledger exists', () => {
    const r = decideArbitration({ override: 'x', ledger: null, record: null });
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/could not verify/i);
  });

  it('allows a matching filled record', () => {
    const r = decideArbitration({
      override: 'cr-arbitration abc123abc123 — two rejected',
      ledger: capped,
      record: freshRecord(),
    });
    expect(r.ok).toBe(true);
  });

  it('refuses a record whose digest does not match the trailer', () => {
    const r = decideArbitration({
      override: 'cr-arbitration abc123abc123 — why',
      ledger: capped,
      record: freshRecord({ digest: 'ffffffffffff' }),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/digest/i);
  });

  it('refuses a partially filled record', () => {
    const r = decideArbitration({
      override: 'cr-arbitration abc123abc123 — why',
      ledger: capped,
      record: freshRecord({ filled: false }),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/disposition/i);
  });

  it('refuses a record bound to another tree', () => {
    const r = decideArbitration({
      override: 'cr-arbitration abc123abc123 — why',
      ledger: capped,
      record: freshRecord({ boundTree: 'OLD', currentTree: 'NEW' }),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/stale|tree/i);
  });

  it('ignores a commit with no override at all', () => {
    expect(decideArbitration({ override: null, ledger: capped, record: null }).ok).toBe(true);
  });
});

// The gate's context-cleanup step deletes `.noldor/cr/autofix/<slug>-code.json`
// one step before `pr-flow` pushes, so by the time this guard runs the ledger is
// routinely gone and the fail-open warning fired on every arbitrated push. The
// record survives that cleanup and carries the same round history.
describe('decideArbitration falling back to the record rounds', () => {
  it('verifies a named digest when the ledger is gone but the record is fresh', () => {
    const r = decideArbitration({
      override: 'cr-arbitration abc123abc123 — two rejected',
      ledger: null,
      record: freshRecord(),
    });
    expect(r.ok).toBe(true);
    expect(r.warning).toBeUndefined();
  });

  it('refuses a bare override when only the record proves the capped red series', () => {
    const r = decideArbitration({
      override: 'shipping anyway',
      ledger: null,
      record: freshRecord(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/arbitration record/i);
  });

  it('refuses a digest the record does not match when the rounds came from the record', () => {
    const r = decideArbitration({
      override: 'cr-arbitration abc123abc123 — why',
      ledger: null,
      record: freshRecord({ digest: 'ffffffffffff' }),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/digest/i);
  });

  // A record is evidence only about the tree it is bound to. Once HEAD moves
  // past that tree the round history describes work this push no longer carries,
  // so it is not a ledger substitute — and refusing on it would block honest
  // overrides in every later session on the same slug, because nothing ever
  // deletes the record.
  it('warns rather than refusing when the surviving record is bound to another tree', () => {
    const r = decideArbitration({
      override: 'shipping anyway',
      ledger: null,
      record: freshRecord({ boundTree: 'OLD', currentTree: 'NEW' }),
    });
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/could not verify/i);
  });

  // `buildSkeleton` drops every `integrity: true` blocker while `aggregate` can
  // go red on integrity blockers alone, so a capped red series really can leave a
  // record with nothing to arbitrate. `isFilled` calls that unfilled, so treating
  // it as a ledger would refuse the push over a disposition no operator can ever
  // write — a dead end where the old fail-open warning used to be.
  it('warns rather than refusing when the surviving record has no arbitrable blockers', () => {
    const r = decideArbitration({
      override: 'cr-arbitration abc123abc123 — why',
      ledger: null,
      record: freshRecord({ blockerCount: 0, filled: false }),
    });
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/could not verify/i);
  });

  it('allows a bare override when the record shows the series converged green', () => {
    const r = decideArbitration({
      override: 'unrelated infra red',
      ledger: null,
      record: freshRecord({ rounds: [...cappedRounds, { round: 4, verdict: 'green' as const }] }),
    });
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  // The ledger is the live history and can hold rounds the skeleton predates —
  // notably the one closing round the cap grants. Falling back to the record
  // while a ledger exists would arbitrate against a shorter history.
  it('prefers the ledger over the record when both are present', () => {
    const r = decideArbitration({
      override: 'unrelated infra red',
      ledger: { rounds: [...cappedRounds, { round: 4, verdict: 'green' as const }] },
      record: freshRecord(),
    });
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
  });
});

describe('enforceArbitration over a push range', () => {
  // Guarding only the tip is bypassable by adding one commit on top: a capped
  // override can sit on any commit in the range while the tip names another FD.
  it('examines every commit in the range, not just the tip', () => {
    const seen: string[] = [];
    const r = enforceArbitration({
      commits: ['c1', 'c2', 'c3'],
      readCommit: (sha) => {
        seen.push(sha);
        return { override: null, slug: null };
      },
      readLedger: () => null,
      readRecord: () => null,
    });
    expect(seen).toEqual(['c1', 'c2', 'c3']);
    expect(r.ok).toBe(true);
  });

  it('refuses when any non-tip commit fails the decision', () => {
    const r = enforceArbitration({
      commits: ['c1', 'c2'],
      readCommit: (sha) =>
        sha === 'c1' ? { override: 'bare', slug: 's' } : { override: null, slug: null },
      readLedger: () => capped,
      readRecord: () => null,
    });
    expect(r.ok).toBe(false);
  });

  // A commit with no Noldor-FD trailer (fast-track, micro-chore) has no pair to
  // resolve, so there is nothing to guard.
  it('skips a commit with no slug', () => {
    const r = enforceArbitration({
      commits: ['c1'],
      readCommit: () => ({ override: 'bare', slug: null }),
      readLedger: () => {
        throw new Error('must not be consulted');
      },
      readRecord: () => null,
    });
    expect(r.ok).toBe(true);
  });
});
