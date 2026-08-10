// @tests: specs-cr-gate-multi-reviewer
import { describe, expect, it } from 'vitest';

import { decide } from '../autofix.js';
import type { LaneBlocker } from '../aggregate.js';
import { fingerprintBlockers } from '../autofix-ledger.js';
import type { AutofixLedger, AutofixRound } from '../autofix-ledger.js';

const HEAD = 'headsha';

function mech(message = 'missing section'): LaneBlocker {
  return { lane: 'reviewer', file: 'a.md', severity: 'high', message, class: 'mechanical' };
}
function design(message = 'wrong default'): LaneBlocker {
  return { lane: 'reviewer', file: 'a.md', severity: 'high', message, class: 'design' };
}
/** No `class` key at all — a legacy sink, or a lane that does not classify. */
function untagged(message = 'unclassified'): LaneBlocker {
  return { lane: 'codex', file: 'a.md', severity: 'high', message };
}

function ledgerWith(rounds: Array<Partial<AutofixRound>>): AutofixLedger {
  return {
    slug: 'slug',
    kind: 'spec',
    sessionStartedAt: '2026-08-07T18:00:00.000Z',
    rounds: rounds.map((r, i) => ({
      round: i + 1,
      headSha: `sha${i + 1}`,
      fingerprint: `fp${i + 1}`,
      applied: 1,
      deferred: 0,
      diffStat: '',
      ...r,
    })),
  };
}

const base = {
  onBlockers: 'auto-fix',
  ledger: null,
  headSha: HEAD,
  unresolved: [],
} as const;

describe('decide — verdicts', () => {
  it('auto-fixes an all-mechanical round', () => {
    const r = decide({ ...base, blockers: [mech(), mech('another')] });
    expect(r.verdict).toBe('auto-fix');
    expect(r.reason).toBeNull();
    expect(r.mechanical).toHaveLength(2);
    expect(r.design).toHaveLength(0);
  });

  it('auto-fixes a MIXED round and still reports the design remainder', () => {
    const r = decide({ ...base, blockers: [mech(), design()] });
    expect(r.verdict).toBe('auto-fix');
    expect(r.mechanical).toHaveLength(1);
    expect(r.design).toHaveLength(1);
  });

  it('declines knob-off when onBlockers is prompt', () => {
    const r = decide({ ...base, onBlockers: 'prompt', blockers: [mech()] });
    expect(r).toMatchObject({ verdict: 'decline', reason: 'knob-off' });
  });

  it('declines round-cap once the cap is reached', () => {
    const r = decide({
      ...base,
      blockers: [mech()],
      ledger: ledgerWith([{}, {}]),
    });
    expect(r).toMatchObject({ verdict: 'decline', reason: 'round-cap' });
  });

  it('declines no-progress when the blocker set is unchanged', () => {
    const blockers = [mech()];
    const r = decide({
      ...base,
      blockers,
      ledger: ledgerWith([{ fingerprint: fingerprintBlockers(blockers) }]),
    });
    expect(r).toMatchObject({ verdict: 'decline', reason: 'no-progress' });
  });

  it('declines prior-deferred when the last round left a blocker unapplied', () => {
    const r = decide({
      ...base,
      blockers: [mech()],
      ledger: ledgerWith([{ fingerprint: 'other', applied: 1, deferred: 1 }]),
    });
    expect(r).toMatchObject({ verdict: 'decline', reason: 'prior-deferred' });
  });

  // Both `prior-deferred` and `no-progress` scan the whole series so neither
  // silently depends on the cap being 2. Only this one is observable at cap 2 —
  // `no-progress` sits after `round-cap`, which already declines at two rounds.
  it('declines prior-deferred for a deferral in ANY prior round', () => {
    const r = decide({
      ...base,
      blockers: [mech()],
      ledger: ledgerWith([{ fingerprint: 'a', deferred: 1 }, { fingerprint: 'b' }]),
    });
    expect(r.reason).toBe('prior-deferred');
  });

  it('declines no-mechanical when every blocker is design', () => {
    const r = decide({ ...base, blockers: [design(), design('other')] });
    expect(r).toMatchObject({ verdict: 'decline', reason: 'no-mechanical' });
  });

  it('declines no-mechanical on an empty blocker set', () => {
    expect(decide({ ...base, blockers: [] })).toMatchObject({
      verdict: 'decline',
      reason: 'no-mechanical',
    });
  });

  it('declines lanes-in-flight while a lane has no finishedAt', () => {
    const r = decide({ ...base, blockers: [mech()], unresolved: ['standalone'] });
    expect(r).toMatchObject({ verdict: 'decline', reason: 'lanes-in-flight' });
  });

  it('declines lanes-in-flight even with zero blockers (aggregate is red on unresolved alone)', () => {
    const r = decide({ ...base, blockers: [], unresolved: ['reviewer'] });
    expect(r).toMatchObject({ verdict: 'decline', reason: 'lanes-in-flight' });
  });

  it('declines no-base-sha when neither the prior headSha nor HEAD resolves', () => {
    const r = decide({
      ...base,
      blockers: [mech()],
      headSha: '',
      ledger: ledgerWith([{ headSha: '', fingerprint: 'other' }]),
    });
    expect(r).toMatchObject({ verdict: 'decline', reason: 'no-base-sha' });
    expect(r.baseSha).toBe('');
  });
});

describe('decide — classification read', () => {
  it('treats an UNTAGGED blocker as design (fail-safe)', () => {
    const r = decide({ ...base, blockers: [untagged()] });
    expect(r).toMatchObject({ verdict: 'decline', reason: 'no-mechanical' });
    expect(r.design).toHaveLength(1);
    expect(r.mechanical).toHaveLength(0);
  });

  it('mixes an untagged blocker into design alongside a real mechanical one', () => {
    const r = decide({ ...base, blockers: [mech(), untagged()] });
    expect(r.verdict).toBe('auto-fix');
    expect(r.design).toHaveLength(1);
  });
});

describe('decide — precedence', () => {
  it('knob-off wins over round-cap', () => {
    const r = decide({
      ...base,
      onBlockers: 'prompt',
      blockers: [mech()],
      ledger: ledgerWith([{}, {}]),
    });
    expect(r.reason).toBe('knob-off');
  });

  it('knob-off wins over lanes-in-flight', () => {
    const r = decide({
      ...base,
      onBlockers: 'prompt',
      blockers: [mech()],
      unresolved: ['standalone'],
    });
    expect(r.reason).toBe('knob-off');
  });

  it('prior-deferred wins over round-cap', () => {
    const r = decide({
      ...base,
      blockers: [mech()],
      ledger: ledgerWith([{ fingerprint: 'a' }, { fingerprint: 'b', deferred: 1 }]),
    });
    expect(r.reason).toBe('prior-deferred');
  });

  it('lanes-in-flight wins over prior-deferred', () => {
    const r = decide({
      ...base,
      blockers: [mech()],
      unresolved: ['standalone'],
      ledger: ledgerWith([{ fingerprint: 'other', deferred: 1 }]),
    });
    expect(r.reason).toBe('lanes-in-flight');
  });

  it('lanes-in-flight wins over round-cap', () => {
    const r = decide({
      ...base,
      blockers: [mech()],
      unresolved: ['standalone'],
      ledger: ledgerWith([{}, {}]),
    });
    expect(r.reason).toBe('lanes-in-flight');
  });

  it('round-cap wins over no-progress', () => {
    const blockers = [mech()];
    const fp = fingerprintBlockers(blockers);
    const r = decide({
      ...base,
      blockers,
      ledger: ledgerWith([{ fingerprint: fp }, { fingerprint: fp }]),
    });
    expect(r.reason).toBe('round-cap');
  });

  it('no-progress wins over no-mechanical', () => {
    const blockers = [design()];
    const r = decide({
      ...base,
      blockers,
      ledger: ledgerWith([{ fingerprint: fingerprintBlockers(blockers) }]),
    });
    expect(r.reason).toBe('no-progress');
  });

  it('no-mechanical wins over no-base-sha', () => {
    const r = decide({ ...base, blockers: [design()], headSha: '' });
    expect(r.reason).toBe('no-mechanical');
  });
});

describe('decide — baseSha ladder', () => {
  it('uses current HEAD on round 1', () => {
    expect(decide({ ...base, blockers: [mech()] }).baseSha).toBe(HEAD);
  });

  it("prefers current HEAD over the prior round's recorded headSha", () => {
    const r = decide({
      ...base,
      blockers: [mech()],
      ledger: ledgerWith([{ headSha: 'prior', fingerprint: 'other' }]),
    });
    expect(r.baseSha).toBe(HEAD);
  });

  it("falls back to the prior round's headSha when HEAD does not resolve", () => {
    const r = decide({
      ...base,
      blockers: [mech()],
      headSha: '',
      ledger: ledgerWith([{ headSha: 'prior', fingerprint: 'other' }]),
    });
    expect(r.baseSha).toBe('prior');
  });

  it("falls back to HEAD when the prior round's headSha is empty", () => {
    const r = decide({
      ...base,
      blockers: [mech()],
      ledger: ledgerWith([{ headSha: '', fingerprint: 'other' }]),
    });
    expect(r.baseSha).toBe(HEAD);
    expect(r.verdict).toBe('auto-fix');
  });
});

describe('decide — next action', () => {
  it('is reround on an all-mechanical round', () => {
    expect(decide({ ...base, blockers: [mech()] }).next).toBe('reround');
  });

  it('is apply-then-stop on a MIXED round', () => {
    expect(decide({ ...base, blockers: [mech(), design()] }).next).toBe('apply-then-stop');
  });

  it('is apply-then-stop when the design remainder is only an UNTAGGED blocker', () => {
    expect(decide({ ...base, blockers: [mech(), untagged()] }).next).toBe('apply-then-stop');
  });

  it('is operator on every decline', () => {
    expect(decide({ ...base, onBlockers: 'prompt', blockers: [mech()] }).next).toBe('operator');
    expect(decide({ ...base, blockers: [design()] }).next).toBe('operator');
  });
});

describe('decide — round number', () => {
  it('is 1 with no ledger', () => {
    expect(decide({ ...base, blockers: [mech()] }).round).toBe(1);
  });

  it('is prior rounds + 1', () => {
    expect(
      decide({ ...base, blockers: [mech()], ledger: ledgerWith([{ fingerprint: 'other' }]) }).round,
    ).toBe(2);
  });

  it('is reported even on a decline', () => {
    expect(decide({ ...base, onBlockers: 'prompt', blockers: [mech()] }).round).toBe(1);
  });
});
