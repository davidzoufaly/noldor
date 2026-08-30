// @tests: parallel-worktree-workflow
// @tests: pendev-ui-design-phase

import { describe, expect, it } from 'vitest';

import {
  evaluate as evaluateRaw,
  parseRawDiff,
  stagedAwarePenLookup,
  stagedAwareRecordLookup,
  type PenBlobLookup,
  type RecordLookup,
  type StagedChange,
} from '../check-shared-files.js';

/** No pen anywhere in the resulting tree — the tamper rule stays quiet. */
const NO_PENS: PenBlobLookup = () => null;

/** evaluate with the tamper seam defaulted; tamper tests pass their own. */
function evaluate(
  staged: readonly StagedChange[],
  repoRoot: string,
  env: Record<string, string | undefined>,
  records: RecordLookup,
  penBlobs: PenBlobLookup = NO_PENS,
): ReturnType<typeof evaluateRaw> {
  return evaluateRaw(staged, repoRoot, env, records, penBlobs);
}

const WORKTREE = '/repo/.worktrees/foo';
const MAIN = '/repo';

const ZERO = '0'.repeat(40);
const OID_A = 'a'.repeat(40);
const OID_B = 'b'.repeat(40);

/** One `--raw -z --no-abbrev` record, so a case reads as the git state it stands for. */
function rawRecord(status: string, oid: string, ...paths: string[]): string {
  const old = status.startsWith('A') ? ZERO : OID_A;
  return `:100644 100644 ${old} ${oid} ${status}\0${paths.join('\0')}\0`;
}

/** Terse builder for already-parsed changes. */
function mod(...paths: string[]): StagedChange[] {
  return paths.map((path) => ({ path, change: 'modify', blob: OID_A }) as const);
}

/** A lookup for tests that never reach the design-approval rules. */
const NO_RECORDS: RecordLookup = () => null;

/** A usable approved record whose penBlob is `blob`. */
function approvedRecord(blob: string): string {
  return JSON.stringify({
    outcome: 'approved',
    at: '2026-08-30T00:00:00.000Z',
    penBlob: blob,
    surfaces: ['app'],
  });
}

describe('check-shared-files / parseRawDiff', () => {
  it('parses add / modify / delete records with their full destination oids', () => {
    const raw =
      rawRecord('A', OID_A, 'src/new.ts') +
      rawRecord('M', OID_B, 'src/old.ts') +
      rawRecord('D', ZERO, 'src/gone.ts');
    expect(parseRawDiff(raw)).toEqual([
      { path: 'src/new.ts', change: 'add', blob: OID_A },
      { path: 'src/old.ts', change: 'modify', blob: OID_B },
      { path: 'src/gone.ts', change: 'delete', blob: ZERO },
    ]);
  });

  it('expands a rename into a delete of the old path and an add carrying the new oid', () => {
    const raw = rawRecord('R100', OID_B, 'docs/design/ui/a.pen', 'docs/design/ui/archive/a.pen');
    expect(parseRawDiff(raw)).toEqual([
      { path: 'docs/design/ui/a.pen', change: 'delete', blob: '0' },
      { path: 'docs/design/ui/archive/a.pen', change: 'add', blob: OID_B },
    ]);
  });

  it('records a copy as an add of the destination only', () => {
    expect(parseRawDiff(rawRecord('C75', OID_B, 'src/a.ts', 'src/b.ts'))).toEqual([
      { path: 'src/b.ts', change: 'add', blob: OID_B },
    ]);
  });

  it('keeps paths containing spaces intact', () => {
    expect(parseRawDiff(rawRecord('M', OID_A, 'docs/my notes.md'))).toEqual([
      { path: 'docs/my notes.md', change: 'modify', blob: OID_A },
    ]);
  });

  it('returns nothing for an empty diff', () => {
    expect(parseRawDiff('')).toEqual([]);
  });

  it('stops at a truncated rename record instead of emitting a half-parsed path', () => {
    const raw =
      rawRecord('M', OID_A, 'src/a.ts') + `:100644 100644 ${OID_A} ${OID_B} R100\0src/b.ts\0`;
    expect(parseRawDiff(raw)).toEqual([{ path: 'src/a.ts', change: 'modify', blob: OID_A }]);
  });
});

describe('check-shared-files / evaluate — shared roots', () => {
  it('allows a shared root file staged from the main worktree', () => {
    expect(evaluate(mod('CLAUDE.md'), MAIN, {}, NO_RECORDS)).toEqual([]);
  });

  it('allows shared root files when NOLDOR_ALLOW_SHARED=1', () => {
    expect(evaluate(mod('CLAUDE.md'), WORKTREE, { NOLDOR_ALLOW_SHARED: '1' }, NO_RECORDS)).toEqual(
      [],
    );
  });

  it('allows ordinary files staged from a worktree', () => {
    expect(evaluate(mod('src/foo.ts', 'docs/x.md'), WORKTREE, {}, NO_RECORDS)).toEqual([]);
  });

  it('blocks CLAUDE.md, package.json, pnpm-lock.yaml and the engineering rules', () => {
    const result = evaluate(
      mod('pnpm-lock.yaml', 'package.json', '.claude/engineering-rules.md', 'CLAUDE.md'),
      WORKTREE,
      {},
      NO_RECORDS,
    );
    expect(result.map((v) => v.path).toSorted()).toEqual(
      ['.claude/engineering-rules.md', 'CLAUDE.md', 'package.json', 'pnpm-lock.yaml'].toSorted(),
    );
    expect(result.every((v) => v.reason === 'shared-root')).toBe(true);
  });

  it('blocks .claude/skills/** and .claude/commands/** but not other .claude files', () => {
    const result = evaluate(
      mod('.claude/skills/foo.md', '.claude/commands/bar.md', '.claude/notes.md'),
      WORKTREE,
      {},
      NO_RECORDS,
    );
    expect(result.map((v) => v.path).toSorted()).toEqual(
      ['.claude/commands/bar.md', '.claude/skills/foo.md'].toSorted(),
    );
  });
});

describe('check-shared-files / evaluate — .pen write guard', () => {
  const BASELINE = 'docs/design/ui/baseline/app.pen';
  const ARCHIVED = 'docs/design/ui/archive/2026-08-24-liquid-glass-ui.pen';

  it('blocks a baseline .pen edited from a feature worktree', () => {
    expect(evaluate(mod(BASELINE), WORKTREE, {}, NO_RECORDS)).toEqual([
      { path: BASELINE, reason: 'pen-baseline' },
    ]);
  });

  it('blocks a baseline .pen deleted from a feature worktree', () => {
    expect(
      evaluate([{ path: BASELINE, change: 'delete', blob: ZERO }], WORKTREE, {}, NO_RECORDS),
    ).toEqual([{ path: BASELINE, reason: 'pen-baseline' }]);
  });

  it('allows the baseline write-back when NOLDOR_ALLOW_PEN_WRITE=1', () => {
    expect(evaluate(mod(BASELINE), WORKTREE, { NOLDOR_ALLOW_PEN_WRITE: '1' }, NO_RECORDS)).toEqual(
      [],
    );
  });

  it('allows a baseline .pen edited from the main worktree (ui-sync remediation)', () => {
    expect(evaluate(mod(BASELINE), MAIN, {}, NO_RECORDS)).toEqual([]);
  });

  it('blocks an in-place edit of an archived .pen from the main worktree', () => {
    expect(evaluate(mod(ARCHIVED), MAIN, {}, NO_RECORDS)).toEqual([
      { path: ARCHIVED, reason: 'pen-archive' },
    ]);
  });

  it('blocks an archived .pen moved back out of archive/', () => {
    const staged = parseRawDiff(rawRecord('R100', OID_A, ARCHIVED, 'docs/design/ui/live.pen'));
    // The destination add also has no approval record, so both rules speak:
    // the move out of archive/ is refused AND the re-entering design is
    // unratified. Reporting both keeps each remedy visible.
    expect(evaluate(staged, WORKTREE, {}, NO_RECORDS)).toEqual([
      { path: ARCHIVED, reason: 'pen-archive' },
      { path: 'docs/design/ui/live.pen', reason: 'pen-unapproved' },
    ]);
  });

  it('allows `design archive` moving a feature .pen into archive/ — its record is in HEAD', () => {
    const staged = parseRawDiff(
      rawRecord(
        'R100',
        OID_A,
        'docs/design/ui/2026-08-27-x.pen',
        ARCHIVED.replace('2026-08-24-liquid-glass-ui', '2026-08-27-x'),
      ),
    );
    // The move's destination is an add under archive/, so the approval rules
    // apply — and pass, because the record committed at spec time still names
    // the unchanged blob. That is what keeps a DIRECT unapproved add into
    // archive/ from being the guard's bypass.
    expect(evaluate(staged, WORKTREE, {}, () => approvedRecord(OID_A))).toEqual([]);
  });

  it('refuses a .pen added directly into archive/ with no record (bypass closed)', () => {
    const dest = 'docs/design/ui/archive/2026-08-30-sneaky.pen';
    const staged: StagedChange[] = [{ path: dest, change: 'add', blob: OID_A }];
    expect(evaluate(staged, MAIN, {}, NO_RECORDS)).toEqual([
      { path: dest, reason: 'pen-unapproved' },
    ]);
  });

  it('leaves a modified feature .pen and non-.pen archive files alone', () => {
    expect(
      evaluate(
        mod('docs/design/ui/2026-08-27-x.pen', 'docs/design/specs/archive/2026-08-01-y-design.md'),
        WORKTREE,
        {},
        NO_RECORDS,
      ),
    ).toEqual([]);
  });

  it('reports a shared root and a .pen violation together in one run', () => {
    const result = evaluate(mod('CLAUDE.md', ARCHIVED), WORKTREE, {}, NO_RECORDS);
    expect(result.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual(
      [
        { path: 'CLAUDE.md', reason: 'shared-root' },
        { path: ARCHIVED, reason: 'pen-archive' },
      ].toSorted((a, b) => a.path.localeCompare(b.path)),
    );
  });
});

describe('check-shared-files / evaluate — design-approval rules', () => {
  const PEN = 'docs/design/ui/2026-08-30-my-feature.pen';
  const RECORD = '.noldor/design-approval/2026-08-30-my-feature.json';
  const addPen: StagedChange = { path: PEN, change: 'add', blob: OID_A };

  it('refuses adding a feature .pen with no record in the resulting tree', () => {
    expect(evaluate([addPen], MAIN, {}, NO_RECORDS)).toEqual([
      { path: PEN, reason: 'pen-unapproved' },
    ]);
  });

  it('refuses when the record is malformed or fails the strict schema', () => {
    const malformed: RecordLookup = () => '{ not json';
    expect(evaluate([addPen], MAIN, {}, malformed)).toEqual([
      { path: PEN, reason: 'pen-unapproved' },
    ]);
    const unknownField: RecordLookup = () =>
      JSON.stringify({
        outcome: 'approved',
        at: 'x',
        penBlob: OID_A,
        surfaces: ['app'],
        extra: 1,
      });
    expect(evaluate([addPen], MAIN, {}, unknownField)).toEqual([
      { path: PEN, reason: 'pen-unapproved' },
    ]);
  });

  it('refuses a record whose penBlob names a different object (approve-then-edit)', () => {
    const stale: RecordLookup = () => approvedRecord(OID_B);
    expect(evaluate([addPen], MAIN, {}, stale)).toEqual([
      { path: PEN, reason: 'pen-approval-mismatch' },
    ]);
  });

  it('accepts a matching approved record, asking the lookup for the right path', () => {
    const asked: string[] = [];
    const matching: RecordLookup = (p) => {
      asked.push(p);
      return approvedRecord(OID_A);
    };
    expect(evaluate([addPen], MAIN, {}, matching)).toEqual([]);
    expect(asked).toEqual([RECORD]);
  });

  it('accepts a matching waived record — the union admits the waiver-after-Seed flow', () => {
    const waived: RecordLookup = () =>
      JSON.stringify({
        outcome: 'waived',
        at: '2026-08-30T00:00:00.000Z',
        penBlob: OID_A,
        reason: 'bridge down',
      });
    expect(evaluate([addPen], MAIN, {}, waived)).toEqual([]);
  });

  it('refuses a whitespace-only waiver reason and a non-ISO timestamp', () => {
    const blankReason: RecordLookup = () =>
      JSON.stringify({
        outcome: 'waived',
        at: '2026-08-30T00:00:00.000Z',
        penBlob: OID_A,
        reason: '   ',
      });
    expect(evaluate([addPen], MAIN, {}, blankReason)).toEqual([
      { path: PEN, reason: 'pen-unapproved' },
    ]);
    const badAt: RecordLookup = () =>
      JSON.stringify({ outcome: 'waived', at: 'yesterday', penBlob: OID_A, reason: 'r' });
    expect(evaluate([addPen], MAIN, {}, badAt)).toEqual([{ path: PEN, reason: 'pen-unapproved' }]);
  });

  it('refuses a stem outside the slug grammar even when the dated pattern matches', () => {
    // PEN_FILE_RE's key grammar is wider than the record store's slug grammar;
    // demanding a record `writeApproval` can never write would be a dead end.
    const mixedCase: StagedChange = {
      path: 'docs/design/ui/2026-08-30-My-Feature.pen',
      change: 'add',
      blob: OID_A,
    };
    expect(evaluate([mixedCase], MAIN, {}, () => approvedRecord(OID_A))).toEqual([
      { path: 'docs/design/ui/2026-08-30-My-Feature.pen', reason: 'pen-unapproved' },
    ]);
  });

  it('does not fire on a modify of an already-committed feature .pen', () => {
    expect(evaluate([{ path: PEN, change: 'modify', blob: OID_B }], MAIN, {}, NO_RECORDS)).toEqual(
      [],
    );
  });

  it('fires on a rename into the feature directory (destination is an add)', () => {
    const staged = parseRawDiff(rawRecord('R100', OID_A, 'scratch/x.pen', PEN));
    expect(evaluate(staged, MAIN, {}, NO_RECORDS)).toEqual([
      { path: PEN, reason: 'pen-unapproved' },
    ]);
  });

  it('refuses a feature .pen whose basename yields no stem (unkeyable = unapprovable)', () => {
    const undated: StagedChange = { path: 'docs/design/ui/foo.pen', change: 'add', blob: OID_A };
    expect(evaluate([undated], MAIN, {}, () => approvedRecord(OID_A))).toEqual([
      { path: 'docs/design/ui/foo.pen', reason: 'pen-unapproved' },
    ]);
  });

  it('is not waived by NOLDOR_ALLOW_PEN_WRITE', () => {
    expect(evaluate([addPen], WORKTREE, { NOLDOR_ALLOW_PEN_WRITE: '1' }, NO_RECORDS)).toEqual([
      { path: PEN, reason: 'pen-unapproved' },
    ]);
  });

  it('ignores baseline adds — undated, unkeyable by design, covered by their own rule', () => {
    const staged: StagedChange[] = [
      { path: 'docs/design/ui/baseline/app.pen', change: 'add', blob: OID_A },
    ];
    expect(evaluate(staged, MAIN, {}, NO_RECORDS)).toEqual([]);
  });
});

describe('check-shared-files / evaluate — record-tamper rule (amend bypass)', () => {
  const PEN_STEM = '2026-08-30-my-feature';
  const RECORD = `.noldor/design-approval/${PEN_STEM}.json`;
  /** The pen survives in HEAD — the amend stages only the record change. */
  const penInHead: PenBlobLookup = (stem) => (stem === PEN_STEM ? OID_A : null);

  it('refuses a staged DELETE of a record whose pen survives (amend bypass closed)', () => {
    const staged: StagedChange[] = [{ path: RECORD, change: 'delete', blob: ZERO }];
    // records lookup is delete-aware → resulting tree holds no record.
    const lookup = stagedAwareRecordLookup(staged, () => approvedRecord(OID_A));
    expect(evaluate(staged, MAIN, {}, lookup, penInHead)).toEqual([
      { path: RECORD, reason: 'pen-unapproved' },
    ]);
  });

  it('refuses a staged corruption of a record whose pen survives', () => {
    const staged: StagedChange[] = [{ path: RECORD, change: 'modify', blob: OID_B }];
    const lookup: RecordLookup = () => '{ not json';
    expect(evaluate(staged, MAIN, {}, lookup, penInHead)).toEqual([
      { path: RECORD, reason: 'pen-unapproved' },
    ]);
  });

  it('refuses a record rewrite that no longer names the surviving pen', () => {
    const staged: StagedChange[] = [{ path: RECORD, change: 'modify', blob: OID_B }];
    const lookup: RecordLookup = () => approvedRecord(OID_B); // names the wrong blob
    expect(evaluate(staged, MAIN, {}, lookup, penInHead)).toEqual([
      { path: RECORD, reason: 'pen-approval-mismatch' },
    ]);
  });

  it('allows deleting an orphan record — its pen is gone from the resulting tree', () => {
    const staged: StagedChange[] = [{ path: RECORD, change: 'delete', blob: ZERO }];
    const lookup = stagedAwareRecordLookup(staged, () => null);
    expect(evaluate(staged, MAIN, {}, lookup, NO_PENS)).toEqual([]);
  });

  it('allows a legitimate re-verdict — the rewritten record matches the surviving pen', () => {
    const staged: StagedChange[] = [{ path: RECORD, change: 'modify', blob: OID_B }];
    const lookup: RecordLookup = () => approvedRecord(OID_A);
    expect(evaluate(staged, MAIN, {}, lookup, penInHead)).toEqual([]);
  });
});

describe('check-shared-files / stagedAwarePenLookup', () => {
  const PEN_STEM = '2026-08-30-my-feature';
  const FEATURE = `docs/design/ui/${PEN_STEM}.pen`;
  const ARCHIVED = `docs/design/ui/archive/${PEN_STEM}.pen`;

  it('prefers the staged feature-path blob', () => {
    const staged: StagedChange[] = [{ path: FEATURE, change: 'modify', blob: OID_B }];
    expect(stagedAwarePenLookup(staged, () => null)(PEN_STEM)).toBe(OID_B);
  });

  it('treats a staged delete as gone and falls through to the archive twin in HEAD', () => {
    const staged: StagedChange[] = [{ path: FEATURE, change: 'delete', blob: ZERO }];
    const lookup = stagedAwarePenLookup(staged, (rel) => (rel === ARCHIVED ? OID_A : null));
    expect(lookup(PEN_STEM)).toBe(OID_A);
  });

  it('reads HEAD when the commit does not touch the pen (the amend shape)', () => {
    const lookup = stagedAwarePenLookup([], (rel) => (rel === FEATURE ? OID_A : null));
    expect(lookup(PEN_STEM)).toBe(OID_A);
  });

  it('returns null when neither path survives', () => {
    expect(stagedAwarePenLookup([], () => null)(PEN_STEM)).toBeNull();
  });
});

describe('check-shared-files / stagedAwareRecordLookup', () => {
  const RECORD = '.noldor/design-approval/2026-08-30-my-feature.json';

  it('reads the staged blob when the record is staged', () => {
    const staged: StagedChange[] = [{ path: RECORD, change: 'add', blob: OID_A }];
    const reads: string[] = [];
    const lookup = stagedAwareRecordLookup(staged, (spec) => {
      reads.push(spec);
      return 'bytes';
    });
    expect(lookup(RECORD)).toBe('bytes');
    expect(reads).toEqual([OID_A]);
  });

  it('resolves a staged DELETE of the record to absent — never the HEAD copy', () => {
    const staged: StagedChange[] = [{ path: RECORD, change: 'delete', blob: ZERO }];
    const lookup = stagedAwareRecordLookup(staged, () => {
      throw new Error('must not read anything for a staged delete');
    });
    expect(lookup(RECORD)).toBeNull();
  });

  it('falls back to HEAD only when the path is absent from the staged set', () => {
    const reads: string[] = [];
    const lookup = stagedAwareRecordLookup([], (spec) => {
      reads.push(spec);
      return 'head bytes';
    });
    expect(lookup(RECORD)).toBe('head bytes');
    expect(reads).toEqual([`HEAD:${RECORD}`]);
  });

  it('treats an all-zero staged oid as absent', () => {
    const staged: StagedChange[] = [{ path: RECORD, change: 'modify', blob: ZERO }];
    const lookup = stagedAwareRecordLookup(staged, () => 'anything');
    expect(lookup(RECORD)).toBeNull();
  });
});
