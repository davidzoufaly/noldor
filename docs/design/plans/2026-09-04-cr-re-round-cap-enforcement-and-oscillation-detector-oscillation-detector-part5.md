# CR Oscillation Detector — Part 5: The Pre-Push Guard Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Make the arbitration record required, not merely available. After this part merges, pre-push refuses a bare free-text `Noldor-Path-Override` on a series whose round cap is spent and still red.
**Architecture:** One pure decision function plus a range traversal, both taking injected readers so the policy is testable from literals. Registered beside `noldor-enforce-review-receipt`, whose early return on any `Noldor-Path-Override` is the exact hole this closes.
**Tech Stack:** TypeScript 7 (native), vitest. No new dependencies. Depends on Part 4 (the record, its digest, its trailer grammar).

---

## File Structure

- `src/hooks/noldor-enforce-arbitration.ts` — create: the decision, the range traversal, and the CLI entry point.
- `src/cli/manifest.ts` — modify: register `hooks enforce-arbitration`.
- `lefthook/noldor.yml` — modify: add the job beside `noldor-enforce-review-receipt`.

---

## Task 1: The pre-push guard

**Files:** Create: `src/hooks/noldor-enforce-arbitration.ts` · Test: `src/hooks/__tests__/noldor-enforce-arbitration.test.ts`

`enforceReviewReceipt` returns `{ ok: true }` the moment it sees a `Noldor-Path-Override` (`src/hooks/noldor-enforce-review-receipt.ts:39`). That early return is the hole. This guard runs beside it and closes it for the one case that matters.

- [x] **Step 1: Write the failing test.** Create `src/hooks/__tests__/noldor-enforce-arbitration.test.ts`:

```ts
// @tests: specs-cr-gate-multi-reviewer
import { describe, expect, it } from 'vitest';

import { decideArbitration } from '../noldor-enforce-arbitration.js';

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
```

- [x] **Step 2: Run it and watch it fail.**

```bash
pnpm vitest run src/hooks/__tests__/noldor-enforce-arbitration.test.ts
```

Expected: `Failed to resolve import "../noldor-enforce-arbitration.js"`.

- [x] **Step 3: Implement the decision.** Create `src/hooks/noldor-enforce-arbitration.ts`:

```ts
// pre-push stage: refuses a bare free-text `Noldor-Path-Override` on a series
// whose round cap is spent and still red.
//
// `enforceReviewReceipt` returns `{ ok: true }` the moment it sees any
// `Noldor-Path-Override` (noldor-enforce-review-receipt.ts:39). That early
// return is the escape hatch this guard closes — and only for the one case
// where a machine-readable answer exists to demand.
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
    return { ok: false, reason: 'pre-push: the arbitration record has a blocker with no disposition' };
  return { ok: true };
}
```

- [x] **Step 4: Run it and watch it pass.**

```bash
pnpm vitest run src/hooks/__tests__/noldor-enforce-arbitration.test.ts && pnpm typecheck
```

Expected: all nine cases pass and `pnpm typecheck` exits 0.

- [x] **Step 5: Commit.**

```bash
cat > /tmp/msg-p5t1.txt <<'EOF'
feat(cr): decide whether a bare override is enough at pre-push

`decideArbitration` is the policy, pure and testable from literals: every I/O
question is answered by its caller.

It fires only on cap-reached AND last-round-red. "Any red round" would trap a
loop that went red and then converged green — no cap refusal ever happened
there, so no skeleton exists and there is nothing to fill — and it would block
an operator overriding for an unrelated reason, which is the Q-0185 shape.

An absent ledger fails OPEN with a printed warning. A deleted ledger and a
session that never ran orchestrate are indistinguishable, and the second is most
overrides in this repo. This matches Q-0170's existing behaviour rather than
silently widening it; the warning is what keeps the hole audible.

Noldor-FD: cr-re-round-cap-enforcement-and-oscillation-detector
EOF
git add src/hooks/noldor-enforce-arbitration.ts src/hooks/__tests__/noldor-enforce-arbitration.test.ts
git commit -F /tmp/msg-p5t1.txt
```

---

## Task 2: Scan the whole push range and register the hook

**Files:** Modify: `src/hooks/noldor-enforce-arbitration.ts`, `src/cli/manifest.ts`, `lefthook/noldor.yml` · Test: `src/hooks/__tests__/noldor-enforce-arbitration.test.ts`, `src/checks/__tests__/check-lefthook-wiring.test.ts`

- [x] **Step 1: Write the failing test.** Append to `src/hooks/__tests__/noldor-enforce-arbitration.test.ts`:

```ts
describe('enforceArbitration over a push range', () => {
  // Guarding only the tip is bypassable by adding one commit on top: a capped
  // override can sit on any commit in the range while the tip names another FD.
  it('examines every commit in the range, not just the tip', () => {
    const seen: string[] = [];
    const r = enforceArbitration({
      cwd: '/r',
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
      cwd: '/r',
      commits: ['c1', 'c2'],
      readCommit: (sha) =>
        sha === 'c1' ? { override: 'bare', slug: 's' } : { override: null, slug: null },
      readLedger: () => ({
        rounds: [
          { round: 1, verdict: 'red' as const },
          { round: 2, verdict: 'red' as const },
          { round: 3, verdict: 'red' as const },
        ],
      }),
      readRecord: () => null,
    });
    expect(r.ok).toBe(false);
  });

  // A commit with no Noldor-FD trailer (fast-track, micro-chore) has no pair to
  // resolve, so there is nothing to guard.
  it('skips a commit with no slug', () => {
    const r = enforceArbitration({
      cwd: '/r',
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
```

- [x] **Step 2: Run it and watch it fail.**

```bash
pnpm vitest run src/hooks/__tests__/noldor-enforce-arbitration.test.ts -t "push range"
```

Expected: `Module '"../noldor-enforce-arbitration.js"' has no exported member 'enforceArbitration'`.

- [x] **Step 3: Implement.** Append to `src/hooks/noldor-enforce-arbitration.ts`:

```ts
/**
 * Apply {@link decideArbitration} to every commit in the push range.
 *
 * Every commit, not just the tip. A push commonly carries several new commits,
 * and a capped override can sit on any of them while the tip names a different
 * FD or none at all — so a tip-only guard is bypassable by adding one commit on
 * top. The pre-push hook already receives the range on stdin, which is what
 * makes this free.
 *
 * The readers are injected for the same reason `decideArbitration` takes facts:
 * the traversal is policy, and policy should not need a fixture repo.
 */
export function enforceArbitration(input: {
  cwd: string;
  commits: readonly string[];
  readCommit: (sha: string) => { override: string | null; slug: string | null };
  readLedger: (slug: string) => LedgerFacts | null;
  readRecord: (slug: string, claimed: string | null) => RecordFacts | null;
}): ArbitrationDecision {
  const warnings: string[] = [];
  for (const sha of input.commits) {
    const { override, slug } = input.readCommit(sha);
    // No override to scrutinise, or no pair to resolve (fast-track,
    // micro-chore): nothing to guard on this commit.
    if (override === null || slug === null) continue;
    const claimed = parseArbitrationTrailer(override);
    const d = decideArbitration({
      override,
      ledger: input.readLedger(slug),
      record: input.readRecord(slug, claimed),
    });
    if (!d.ok) return { ok: false, reason: `${sha.slice(0, 10)}: ${d.reason}` };
    if (d.warning) warnings.push(`${sha.slice(0, 10)}: ${d.warning}`);
  }
  return warnings.length > 0 ? { ok: true, warning: warnings.join('\n') } : { ok: true };
}
```

- [x] **Step 4: Run it and watch it pass.**

```bash
pnpm vitest run src/hooks/__tests__/noldor-enforce-arbitration.test.ts && pnpm typecheck
```

Expected: all twelve cases pass and `pnpm typecheck` exits 0.

- [x] **Step 5: Add the CLI entry and the production readers.** Register the command in `src/cli/manifest.ts` under the existing `hooks` group, beside `enforce-review-receipt`:

```ts
      'enforce-arbitration': {
        src: 'hooks/noldor-enforce-arbitration.ts',
        desc: 'pre-push: require a filled arbitration record for a capped, still-red override',
      },
```

Then add the runnable entry point at the bottom of `src/hooks/noldor-enforce-arbitration.ts`, following whatever `runIfDirect` / `import.meta.url` pattern `noldor-enforce-review-receipt.ts` uses — match it exactly rather than inventing a second shape. Its readers:

- `commits` — the range from stdin, via the existing helpers in `src/hooks/pre-push-range.ts` (`createGitRunner`, `isObjectId`, and that module's stdin ref-line parser). Do not re-parse stdin by hand; that parser exists because `git rev-list --stdin` accepts pseudo-options.
- `readCommit` — `git log -1 --pretty=%B <sha>` through `parseTrailers`, taking `Noldor-Path-Override` and `Noldor-FD`.
- `readLedger` — read `.noldor/cr/autofix/<slug>-code.json` and map its rounds to `{ round, verdict }`. **Do NOT use `readLedger` from `autofix-ledger.ts`**: it returns `null` for a different `sessionStartedAt`, and a push legitimately happens in a later session than the rounds it arbitrates — session-scoped reading would make this guard fail open on every session rotation while claiming to be loud.
- `readRecord` — read the arbitration record, `arbitrationRecordSchema.parse` it, and return `{ digest: recordDigest(rec), filled: isFilled(rec), boundTree: rec.boundTree, currentTree: <git rev-parse HEAD^{tree}> }`. An unreadable or unparseable file returns `null`, which the decision reports as "no arbitration record on disk".

- [x] **Step 6: Register the lefthook job.** In `lefthook/noldor.yml`, directly after the `noldor-enforce-review-receipt` job:

```yaml
    - name: noldor-enforce-arbitration
      use_stdin: true
      run: pnpm noldor hooks enforce-arbitration {1}
```

`use_stdin: true` matches the `noldor-pre-push` job above it — the range arrives the same way.

Then mirror the change into the templates twin (`templates/**`), or `checks template-sync` and the doctor-drift case in `cli.test.ts` go red.

- [x] **Step 7: Run everything, including the wiring check.**

```bash
pnpm typecheck && pnpm test && pnpm noldor checks lefthook-wiring && pnpm noldor checks push-gates
```

Expected: typecheck exits 0, the suite is green, and both checks exit 0. `checks push-gates` now replays the new job too — that is the point of preflighting through lefthook itself rather than an enumeration.

- [x] **Step 8: Verify the guard end to end.** On a scratch branch, confirm the two directions:

```bash
git switch -c arb-probe
mkdir -p .noldor/cr/autofix
node -e "
const fs=require('fs');
fs.writeFileSync('.noldor/cr/autofix/probe-code.json', JSON.stringify({
  slug:'probe', kind:'code', sessionStartedAt:'X',
  rounds:[1,2,3].map(round=>({round, headSha:'a'.repeat(40), fingerprint:'f', verdict:'red', applied:0, deferred:0, diffStat:''}))
}));"
git commit --allow-empty -m "chore: probe" -m "Noldor-FD: probe
Noldor-Path-Override: shipping anyway"
pnpm noldor hooks enforce-arbitration <<< "refs/heads/arb-probe $(git rev-parse HEAD) refs/heads/arb-probe 0000000000000000000000000000000000000000"; echo "EXIT:$?"
```

Expected: a non-zero exit and the "a bare override is not enough" message. Then clean up:

```bash
git switch - && git branch -D arb-probe && rm -f .noldor/cr/autofix/probe-code.json
```

- [x] **Step 9: Commit.**

```bash
cat > /tmp/msg-p5t2.txt <<'EOF'
feat(cr): enforce the arbitration record at pre-push

`enforceArbitration` applies the decision to every commit in the push range, not
just the tip: a push commonly carries several commits, and a capped override can
sit on any of them while the tip names a different FD — so a tip-only guard is
bypassable by adding one commit on top. The hook already receives the range on
stdin, so this costs nothing.

The production ledger reader deliberately does NOT go through
`autofix-ledger.ts`'s `readLedger`, which returns null for a different
`sessionStartedAt`. A push legitimately happens in a later session than the
rounds it arbitrates, and session-scoped reading would make this guard fail open
on every session rotation while claiming to be loud.

Registered beside `noldor-enforce-review-receipt`, whose own early return on any
`Noldor-Path-Override` is the hole this closes. `checks push-gates` replays
lefthook itself, so the new job is preflighted with no change to the gate prose.

Noldor-FD: cr-re-round-cap-enforcement-and-oscillation-detector
EOF
git add src/hooks/noldor-enforce-arbitration.ts src/hooks/__tests__/noldor-enforce-arbitration.test.ts src/cli/manifest.ts lefthook/noldor.yml templates/
git commit -F /tmp/msg-p5t2.txt
```
