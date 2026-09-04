// @tests: specs-cr-gate-multi-reviewer
import { describe, expect, it } from 'vitest';

import { decideArbitration, enforceArbitration } from '../noldor-enforce-arbitration.js';

const capped = {
  rounds: [
    { round: 1, verdict: 'red' as const },
    { round: 2, verdict: 'red' as const },
    { round: 3, verdict: 'red' as const },
  ],
};

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
      record: { digest: 'abc123abc123', filled: true, boundTree: 'T', currentTree: 'T' },
    });
    expect(r.ok).toBe(true);
  });

  it('refuses a record whose digest does not match the trailer', () => {
    const r = decideArbitration({
      override: 'cr-arbitration abc123abc123 — why',
      ledger: capped,
      record: { digest: 'ffffffffffff', filled: true, boundTree: 'T', currentTree: 'T' },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/digest/i);
  });

  it('refuses a partially filled record', () => {
    const r = decideArbitration({
      override: 'cr-arbitration abc123abc123 — why',
      ledger: capped,
      record: { digest: 'abc123abc123', filled: false, boundTree: 'T', currentTree: 'T' },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/disposition/i);
  });

  it('refuses a record bound to another tree', () => {
    const r = decideArbitration({
      override: 'cr-arbitration abc123abc123 — why',
      ledger: capped,
      record: { digest: 'abc123abc123', filled: true, boundTree: 'OLD', currentTree: 'NEW' },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/stale|tree/i);
  });

  it('ignores a commit with no override at all', () => {
    expect(decideArbitration({ override: null, ledger: capped, record: null }).ok).toBe(true);
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
