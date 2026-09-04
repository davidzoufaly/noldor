# CR Oscillation Detector — Part 4: The Arbitration Record Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Make the round cap terminate in evidence instead of a sentence. After this part merges, a cap refusal writes an arbitration skeleton — round history, the blockers left standing, the signals that explain them — and the operator fills one disposition per blocker.
**Architecture:** One new module owns the record: schema, path, tree binding, digest and trailer grammar. Orchestrate writes the skeleton at its existing refusal site, after verifying the lane sinks describe the round it is arbitrating. Part 5 adds the pre-push guard that makes the record required.
**Tech Stack:** TypeScript 7 (native), zod 3, vitest. No new dependencies. Depends on Parts 1–3 (`blockerIds`, `signals`, `fingerprintBlocker`).

---

## File Structure

- `src/cr/arbitration.ts` — create: the record schema, its path, its tree binding, its digest, and the trailer grammar.
- `src/cr/orchestrate.ts` — modify: write the skeleton on cap refusal, after verifying the sinks.

---

## Task 1: The record schema and path

**Files:** Create: `src/cr/arbitration.ts` · Test: `src/cr/__tests__/arbitration.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/arbitration.test.ts`:

```ts
// @tests: specs-cr-gate-multi-reviewer
import { describe, expect, it } from 'vitest';

import {
  DISPOSITIONS,
  arbitrationPath,
  arbitrationRecordSchema,
  isFilled,
} from '../arbitration.js';
import type { Slug } from '../../core/slug.js';

const base = {
  version: 1,
  slug: 's',
  kind: 'code',
  boundTree: 'a'.repeat(40),
  rounds: [{ round: 1, verdict: 'red', headSha: 'abc1234' }],
  blockers: [{ id: 'b1', severity: 'high', message: 'boom', lanes: ['reviewer'] }],
  signals: [],
  dispositions: [],
};

describe('arbitrationPath', () => {
  // A file matching `.noldor/cr/<slug>-<kind>-*.json` is collected by
  // `aggregate` as a lane sink; `autofix-ledger.ts:120-130` records what that
  // cost last time. The subdirectory is the proven remedy, not decoration.
  it('nests under .noldor/cr/arbitration, outside the lane-sink glob', () => {
    const p = arbitrationPath('/r', 's' as Slug, 'code');
    expect(p).toContain('/.noldor/cr/arbitration/');
    expect(p.endsWith('/s-code.json')).toBe(true);
  });
});

describe('arbitrationRecordSchema', () => {
  it('accepts a skeleton with no dispositions', () => {
    expect(() => arbitrationRecordSchema.parse(base)).not.toThrow();
  });

  it('rejects an unknown disposition value', () => {
    const bad = { ...base, dispositions: [{ blockerId: 'b1', disposition: 'shrug' }] };
    expect(() => arbitrationRecordSchema.parse(bad)).toThrow();
  });

  it('accepts every documented disposition value', () => {
    for (const d of DISPOSITIONS) {
      const rec = { ...base, dispositions: [{ blockerId: 'b1', disposition: d, note: 'why' }] };
      expect(() => arbitrationRecordSchema.parse(rec)).not.toThrow();
    }
  });

  it('rejects a duplicate disposition for one blocker', () => {
    const dup = {
      ...base,
      dispositions: [
        { blockerId: 'b1', disposition: 'accepted' },
        { blockerId: 'b1', disposition: 'rejected' },
      ],
    };
    expect(() => arbitrationRecordSchema.parse(dup)).toThrow();
  });

  it('rejects a disposition for an unknown blocker id', () => {
    const orphan = { ...base, dispositions: [{ blockerId: 'nope', disposition: 'accepted' }] };
    expect(() => arbitrationRecordSchema.parse(orphan)).toThrow();
  });
});

describe('isFilled', () => {
  it('is false for a skeleton', () => {
    expect(isFilled(arbitrationRecordSchema.parse(base))).toBe(false);
  });

  it('is true only when every blocker has a disposition', () => {
    const rec = arbitrationRecordSchema.parse({
      ...base,
      blockers: [
        { id: 'b1', severity: 'high', message: 'x', lanes: ['reviewer'] },
        { id: 'b2', severity: 'med', message: 'y', lanes: ['codex'] },
      ],
      dispositions: [{ blockerId: 'b1', disposition: 'accepted' }],
    });
    expect(isFilled(rec)).toBe(false);
    const full = { ...rec, dispositions: [...rec.dispositions, { blockerId: 'b2', disposition: 'rejected' as const }] };
    expect(isFilled(arbitrationRecordSchema.parse(full))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm vitest run src/cr/__tests__/arbitration.test.ts
```

Expected: `Failed to resolve import "../arbitration.js"`.

- [ ] **Step 3: Implement.** Create `src/cr/arbitration.ts`:

```ts
/**
 * The arbitration record — what a spent round cap terminates in.
 *
 * 23 of this repo's 41 unique `Noldor-Path-Override` trailers name a CR round
 * or a convergence failure, and every one of them is free text. This record is
 * the machine-readable half: the round history, the blockers left standing, the
 * signals that explain them, and one operator disposition per blocker.
 *
 * NOT tracked by git. `.gitignore:64` ignores `.noldor/cr/`, so the record is
 * local like the ledger and the sinks it is built from. That is what keeps its
 * tree binding non-self-referential — committing never changes the record, so
 * the tree it binds is stable — and pre-push runs in the same checkout, so the
 * file is there when the guard looks. The cost is that the record does not
 * travel with the PR; the trailer is what reaches `main`.
 */
import { z } from 'zod';

import { slugPath } from '../core/slug-paths.js';
import type { Slug } from '../core/slug.js';
import { artifactKindSchema } from './findings-schema.js';
import type { ArtifactKind } from './findings-schema.js';

/**
 * What an operator can say about a blocker they are not fixing.
 *
 * A closed vocabulary rather than free text, because the whole point is that a
 * later reader — or a detector — can tell "I judged this wrong" from "I agree
 * and accept the debt". The `note` beside it carries the sentence.
 */
export const DISPOSITIONS = ['accepted', 'rejected', 'deferred'] as const;
export const dispositionSchema = z.enum(DISPOSITIONS);
export type Disposition = z.infer<typeof dispositionSchema>;

export const arbitrationBlockerSchema = z.object({
  /** {@link fingerprintBlocker} id — the same key a signal points at. */
  id: z.string().min(1),
  severity: z.enum(['high', 'med', 'low']),
  message: z.string().min(1),
  /** Every lane that filed this logical finding. One id can have several. */
  lanes: z.array(z.string().min(1)).min(1),
});

export const arbitrationRoundSchema = z.object({
  round: z.number().int().positive(),
  verdict: z.enum(['green', 'red']),
  headSha: z.string(),
});

export const arbitrationDispositionSchema = z.object({
  blockerId: z.string().min(1),
  disposition: dispositionSchema,
  note: z.string().optional(),
});

export const arbitrationRecordSchema = z
  .object({
    /** Schema version. Present from the first write so a later shape can migrate. */
    version: z.literal(1),
    slug: z.string().min(1),
    kind: artifactKindSchema,
    /**
     * `HEAD^{tree}` at the moment the cap refused — what this arbitration is
     * ABOUT. A later commit changes the tree, which is what makes the record go
     * stale rather than silently standing for work it never saw.
     */
    boundTree: z.string().min(1),
    rounds: z.array(arbitrationRoundSchema),
    blockers: z.array(arbitrationBlockerSchema),
    /** Opaque here — the detector owns their shape; this record transports them. */
    signals: z.array(z.record(z.unknown())),
    dispositions: z.array(arbitrationDispositionSchema),
  })
  .strict()
  .superRefine((rec, ctx) => {
    const ids = new Set(rec.blockers.map((b) => b.id));
    const seen = new Set<string>();
    for (const d of rec.dispositions) {
      // One disposition per blocker: an id identifies a LOGICAL finding, so the
      // operator arbitrates it once even when two lanes filed it. Two entries
      // for one id would leave "which one counts" undefined.
      if (seen.has(d.blockerId))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate disposition for blocker ${d.blockerId}`,
          path: ['dispositions'],
        });
      seen.add(d.blockerId);
      if (!ids.has(d.blockerId))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `disposition names unknown blocker ${d.blockerId}`,
          path: ['dispositions'],
        });
    }
  });
export type ArbitrationRecord = z.infer<typeof arbitrationRecordSchema>;

/**
 * Path for a `slug`+`kind` pair.
 *
 * A SUBDIRECTORY of `.noldor/cr`, and that is load-bearing: `aggregate`
 * collects every `.noldor/cr/<slug>-<kind>-*.json` regular file as a lane sink,
 * so a record named `<slug>-<kind>-arbitration.json` beside them would match
 * that glob, `inferLaneFromFilename` would return null, and a bogus
 * `non-conforming filename` HIGH blocker would land in every aggregate for the
 * pair — turning green runs red. `autofix-ledger.ts:120-130` records that exact
 * incident and its remedy; this reuses it rather than minting a second one.
 */
export function arbitrationPath(cwd: string, slug: Slug, kind: ArtifactKind): string {
  const built = slugPath(cwd, ['.noldor', 'cr', 'arbitration'], slug, { suffix: `-${kind}.json` });
  if (!built.ok) throw new Error(`cannot resolve arbitration record: ${built.error.kind}`);
  return built.path;
}

/** Every unresolved blocker carries exactly one disposition. */
export function isFilled(rec: ArbitrationRecord): boolean {
  if (rec.blockers.length === 0) return false;
  const disposed = new Set(rec.dispositions.map((d) => d.blockerId));
  return rec.blockers.every((b) => disposed.has(b.id));
}
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
pnpm vitest run src/cr/__tests__/arbitration.test.ts && pnpm typecheck
```

Expected: every case passes and `pnpm typecheck` exits 0.

- [ ] **Step 5: Commit.**

```bash
cat > /tmp/msg-p4t1.txt <<'EOF'
feat(cr): add the arbitration record schema

Why — 23 of this repo's 41 unique `Noldor-Path-Override` trailers name a CR
round or a convergence failure, and all of them are free text. A spent round cap
currently terminates in a sentence nobody can query: which blockers were left
standing, what the operator decided about each, and what the detector had
already said about them are all lost.

How — A versioned record carrying the round history, the blockers left standing
with the lanes that filed them, the signals, and one disposition per blocker
from a closed vocabulary. Two invariants are enforced in the schema: at most one
disposition per blocker id, and no disposition naming a blocker the record does
not list. It lives at `.noldor/cr/arbitration/<slug>-<kind>.json` — a
SUBDIRECTORY, because `aggregate` collects every `.noldor/cr/<slug>-<kind>-*.json`
as a lane sink and `autofix-ledger.ts` already records what a file inside that
glob cost.

What — `src/cr/arbitration.ts` with the schema, the path helper and `isFilled`,
plus its test file. No writer yet.

Noldor-FD: cr-re-round-cap-enforcement-and-oscillation-detector
EOF
git add src/cr/arbitration.ts src/cr/__tests__/arbitration.test.ts
git commit -F /tmp/msg-p4t1.txt
```

---

## Task 2: The tree binding and its trailer

**Files:** Modify: `src/cr/arbitration.ts` · Test: `src/cr/__tests__/arbitration.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/cr/__tests__/arbitration.test.ts`:

```ts
describe('recordDigest', () => {
  const rec = arbitrationRecordSchema.parse(base);

  it('is stable across key order', () => {
    const reordered = arbitrationRecordSchema.parse({
      dispositions: [],
      signals: [],
      blockers: base.blockers,
      rounds: base.rounds,
      boundTree: base.boundTree,
      kind: 'code',
      slug: 's',
      version: 1,
    });
    expect(recordDigest(rec)).toBe(recordDigest(reordered));
  });

  it('changes when a disposition is added', () => {
    const filled = arbitrationRecordSchema.parse({
      ...base,
      dispositions: [{ blockerId: 'b1', disposition: 'accepted' }],
    });
    expect(recordDigest(filled)).not.toBe(recordDigest(rec));
  });
});

describe('parseArbitrationTrailer', () => {
  it('reads the digest out of a structured override', () => {
    const v = 'cr-arbitration abc123def456 — two design blockers rejected';
    expect(parseArbitrationTrailer(v)).toBe('abc123def456');
  });

  it('returns null for a bare free-text override', () => {
    expect(parseArbitrationTrailer('verify lane infra red, shipping anyway')).toBeNull();
  });

  it('returns null when the marker is present but the digest is malformed', () => {
    expect(parseArbitrationTrailer('cr-arbitration NOTHEX — why')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm vitest run src/cr/__tests__/arbitration.test.ts -t recordDigest
```

Expected: `Module '"../arbitration.js"' has no exported member 'recordDigest'`.

- [ ] **Step 3: Implement.** Append to `src/cr/arbitration.ts` (add `import { createHash } from 'node:crypto';`):

```ts
/**
 * The record's own digest — what the trailer names and the guard re-derives.
 *
 * Canonicalised by sorting object keys before serialising, so a rewrite that
 * only reorders keys does not invalidate an arbitration. Every field is
 * included, `dispositions` explicitly: the digest is computed AFTER the operator
 * fills them, which is why nothing here is excluded. Filling in a skeleton
 * changes the digest by design — the trailer names the FILLED record.
 *
 * This does not bind the record to a tree; {@link ArbitrationRecord.boundTree}
 * does that, and the guard checks both.
 */
export function recordDigest(rec: ArbitrationRecord): string {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon);
    if (v !== null && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, canon(val)]),
      );
    return v;
  };
  return createHash('sha256').update(JSON.stringify(canon(rec))).digest('hex').slice(0, 12);
}

/** The marker that distinguishes a structured override from a free-text one. */
export const ARBITRATION_MARKER = 'cr-arbitration';

const TRAILER_RE = new RegExp(`^${ARBITRATION_MARKER}\\s+([0-9a-f]{12})(?:\\s|$)`);

/**
 * The record digest named by a `Noldor-Path-Override` value, or `null`.
 *
 * `null` for every override written before this existed, which is what keeps
 * this additive: an unrecognised value is a free-text override, and the guard
 * decides separately whether that is acceptable here.
 */
export function parseArbitrationTrailer(value: string): string | null {
  const m = TRAILER_RE.exec(value.trim());
  return m ? m[1] : null;
}
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
pnpm vitest run src/cr/__tests__/arbitration.test.ts && pnpm typecheck
```

Expected: every case passes and `pnpm typecheck` exits 0.

- [ ] **Step 5: Commit.**

```bash
cat > /tmp/msg-p4t2.txt <<'EOF'
feat(cr): bind the arbitration record to a digest and a trailer grammar

`recordDigest` canonicalises the record by sorting keys before hashing, so a
rewrite that only reorders keys does not invalidate an arbitration. Nothing is
excluded from the digest — it is computed after the operator fills the
dispositions, and the trailer names the FILLED record.

`parseArbitrationTrailer` reads the digest out of a
`Noldor-Path-Override: cr-arbitration <digest> — <why>` value and returns null
for anything else, which is what keeps this additive: every override already in
history is free text and still parses as one.

The trailer vocabulary is deliberately unchanged. `release-cr-gate.ts:134`
accepts `Noldor-Path-Override` on a bare non-empty check, so a structured value
costs zero gate changes; a new key would need teaching to six consumers and
would fail the release gate until all of them knew it.

Noldor-FD: cr-re-round-cap-enforcement-and-oscillation-detector
EOF
git add src/cr/arbitration.ts src/cr/__tests__/arbitration.test.ts
git commit -F /tmp/msg-p4t2.txt
```

---

## Task 3: Write the skeleton on cap refusal

**Files:** Modify: `src/cr/orchestrate.ts` · Test: `src/cr/__tests__/orchestrate.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/cr/__tests__/orchestrate.test.ts`:

```ts
describe('buildSkeleton', () => {
  const rounds = [
    { round: 1, headSha: 'a1', fingerprint: 'F', verdict: 'red' as const, applied: 0, deferred: 0, diffStat: '', blockerIds: ['b1'], signals: [{ rule: 'R1', blockerId: 'b1' }] },
  ];
  const sinkBlockers = [{ lane: 'reviewer', severity: 'high' as const, file: 'a.md', message: 'boom' }];

  it('carries rounds, blockers and signals, with dispositions empty', () => {
    const rec = buildSkeleton('s', 'code', 'TREE', rounds, sinkBlockers, () => 'b1');
    expect(rec?.dispositions).toEqual([]);
    expect(rec?.blockers).toEqual([
      { id: 'b1', severity: 'high', message: 'boom', lanes: ['reviewer'] },
    ]);
    expect(rec?.signals).toHaveLength(1);
    expect(rec?.boundTree).toBe('TREE');
  });

  it('collapses one logical blocker filed by two lanes into one entry', () => {
    const two = [...sinkBlockers, { ...sinkBlockers[0], lane: 'codex' }];
    const rec = buildSkeleton('s', 'code', 'TREE', rounds, two, () => 'b1');
    expect(rec?.blockers).toHaveLength(1);
    expect(rec?.blockers[0].lanes).toEqual(['codex', 'reviewer']);
  });

  // Sinks are overwritten by ANY lane run, and the gate documents standalone
  // `cr` invocations. A skeleton built from someone else's review would have the
  // operator arbitrate the wrong blockers.
  it('returns null when the sinks do not match the ledger round', () => {
    expect(buildSkeleton('s', 'code', 'TREE', rounds, sinkBlockers, () => 'DIFFERENT')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm vitest run src/cr/__tests__/orchestrate.test.ts -t buildSkeleton
```

Expected: `Module '"../orchestrate.js"' has no exported member 'buildSkeleton'`.

- [ ] **Step 3: Implement.** In `src/cr/orchestrate.ts`, beside `runReflagRules`:

```ts
/**
 * The arbitration skeleton for a refused round, or `null` when the sinks cannot
 * be trusted to describe it.
 *
 * What orchestrate holds at a cap refusal is only the LEDGER — the refusal
 * returns at the top of `run()` before any dispatch, with `lanesRun: []`, and
 * the ledger stores a blocker-set fingerprint rather than the blockers. So the
 * unresolved blockers are re-read from the pair's current lane sinks, which are
 * still on disk precisely because a refused run writes none.
 *
 * Those sinks are VERIFIED before they are trusted: nothing stops a lane being
 * run standalone between the closing round and the refusal, which would leave
 * sinks describing a different review. Recomputing the set fingerprint and
 * comparing it against the ledger's last round is what catches that, and a
 * mismatch yields `null` rather than a plausible-looking record about the wrong
 * blockers.
 *
 * `idOf` is injected so the identity function is visible to a test without a
 * fixture repo; production passes {@link fingerprintBlocker}.
 */
export function buildSkeleton(
  slug: string,
  kind: ArtifactKind,
  boundTree: string,
  rounds: readonly AutofixRound[],
  sinkBlockers: readonly (Finding & { lane: string })[],
  idOf: (b: Finding) => string,
  fingerprintOf: (bs: readonly Finding[]) => string = fingerprintBlockers,
): ArbitrationRecord | null {
  const last = rounds.at(-1);
  if (!last) return null;
  if (fingerprintOf(sinkBlockers) !== last.fingerprint) return null;

  const byId = new Map<string, { blocker: Finding; lanes: Set<string> }>();
  for (const b of sinkBlockers) {
    const id = idOf(b);
    const entry = byId.get(id) ?? { blocker: b, lanes: new Set<string>() };
    entry.lanes.add(b.lane);
    byId.set(id, entry);
  }
  return {
    version: 1,
    slug,
    kind,
    boundTree,
    rounds: rounds.map((r) => ({
      round: r.round,
      verdict: roundVerdict(r),
      headSha: r.headSha,
    })),
    blockers: [...byId].map(([id, { blocker, lanes }]) => ({
      id,
      severity: blocker.severity,
      message: blocker.message,
      lanes: [...lanes].sort(),
    })),
    signals: rounds.flatMap((r) => r.signals ?? []),
    dispositions: [],
  };
}
```

The test passes `() => 'b1'` as `idOf` and relies on the default `fingerprintOf`; make the ledger fixture's `fingerprint` field equal `fingerprintBlockers(sinkBlockers)` for the two passing cases, and something else for the mismatch case. Compute it in the test rather than hard-coding a hex string.

- [ ] **Step 4: Run it and watch it pass.**

```bash
pnpm vitest run src/cr/__tests__/orchestrate.test.ts -t buildSkeleton && pnpm typecheck
```

Expected: all three cases pass and `pnpm typecheck` exits 0.

- [ ] **Step 5: Write it at the refusal site.** In `run()`, replace the existing refusal block:

```ts
  if (cap.refuse) {
    console.error(renderCapRefusal(ledger, opts.args.slug, opts.args.kind));
    return { lanesRun: [], syntheticOks: [], exitCode: EXIT_ROUND_CAP };
  }
```

with:

```ts
  if (cap.refuse) {
    console.error(renderCapRefusal(ledger, opts.args.slug, opts.args.kind));
    await writeSkeletonIfAbsent(cwd, opts.args.slug, opts.args.kind, ledger, headSha);
    return { lanesRun: [], syntheticOks: [], exitCode: EXIT_ROUND_CAP };
  }
```

and add beside `buildSkeleton`:

```ts
/**
 * Write the skeleton, unless a record for this tree already exists.
 *
 * Re-running orchestrate at the cap refuses again and reaches here again, so
 * an unconditional write would erase dispositions the operator had already
 * filled in. Existing-and-same-tree is left alone; existing-but-bound-to-another
 * tree is replaced, because that record arbitrated different work.
 *
 * Never throws: failing to write an advisory record must not change what a cap
 * refusal does.
 */
export async function writeSkeletonIfAbsent(
  cwd: string,
  slug: Slug,
  kind: ArtifactKind,
  ledger: AutofixLedger | null,
  headSha: string,
): Promise<void> {
  try {
    const tree = gitRun(['rev-parse', 'HEAD^{tree}']).trim();
    const path = arbitrationPath(cwd, slug, kind);
    const existing = await readFileNoFollowAsync(path).catch(() => null);
    if (existing !== null) {
      const prior = arbitrationRecordSchema.safeParse(JSON.parse(existing));
      if (prior.success && prior.data.boundTree === tree) {
        console.error(`arbitration record already present: ${path}`);
        return;
      }
    }
    const blockers = await readSinkBlockers(cwd, slug, kind);
    const rec = buildSkeleton(slug, kind, tree, ledger?.rounds ?? [], blockers, fingerprintBlocker);
    if (!rec) {
      console.error(
        'arbitration skeleton not written — the lane sinks on disk do not describe the ' +
          'arbitrated round. Re-run the round before arbitrating.',
      );
      return;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeJsonAtomic(path, rec);
    console.error(`arbitration skeleton written: ${path}`);
    console.error(`  ${rec.blockers.length} unresolved blockers await a disposition; then commit with:`);
    console.error('  git commit --amend --no-edit --trailer \\');
    console.error('    "Noldor-Path-Override: cr-arbitration <digest> — <why>"');
  } catch (err) {
    console.error(`arbitration skeleton not written: ${(err as Error).message}`);
  }
}
```

`readSinkBlockers` is a small local that reads the pair's `.noldor/cr/<slug>-<kind>-*.json` sinks and returns their blockers tagged with the lane. `aggregate` already does this work — reuse whatever it exports rather than writing a second reader; if it exposes no per-lane blocker list, extract one from it in this commit rather than duplicating the glob.

Add the imports this needs: `arbitrationPath`, `arbitrationRecordSchema`, `type ArbitrationRecord` from `./arbitration.js`; `readFileNoFollowAsync` from `../core/slug-paths.js`; `mkdir` from `node:fs/promises`; `dirname` from `node:path`; `writeJsonAtomic` from `./atomic-write.js`; `fingerprintBlocker` and `fingerprintBlockers` from `./autofix-ledger.js`.

- [ ] **Step 6: Run everything.**

```bash
pnpm typecheck && pnpm test
```

Expected: typecheck exits 0 and the suite is green.

- [ ] **Step 7: Verify the aggregate glob is unaffected.**

```bash
mkdir -p .noldor/cr/arbitration && echo '{}' > .noldor/cr/arbitration/probe-code.json
pnpm noldor cr aggregate --slug probe --kind code 2>&1 | grep -i "non-conforming" && echo "REGRESSION" || echo "clean"
rm -f .noldor/cr/arbitration/probe-code.json
```

Expected: `clean`. A `REGRESSION` line means the record landed inside the lane-sink glob after all — check `arbitrationPath`.

- [ ] **Step 8: Commit.**

```bash
cat > /tmp/msg-p4t3.txt <<'EOF'
feat(cr): write an arbitration skeleton when the round cap refuses

Orchestrate holds only the ledger at a refusal — it returns before any dispatch,
with `lanesRun: []`, and the ledger stores a blocker-set fingerprint rather than
the blockers themselves. So the skeleton re-reads the pair's lane sinks, which
are still on disk precisely because a refused run writes none.

Those sinks are verified first. Nothing stops a lane being run standalone
between the closing round and the refusal, and the gate skill documents doing
exactly that; recomputing the set fingerprint against the ledger's last round is
what catches it, and a mismatch writes nothing rather than a plausible record
about the wrong blockers.

A record already bound to the current tree is left alone, so re-running at the
cap cannot erase dispositions the operator has filled in. Writing never throws:
an advisory record must not change what a cap refusal does.

Noldor-FD: cr-re-round-cap-enforcement-and-oscillation-detector
EOF
git add src/cr/orchestrate.ts src/cr/__tests__/orchestrate.test.ts
git commit -F /tmp/msg-p4t3.txt
```

---

