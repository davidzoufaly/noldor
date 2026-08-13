// @tests: code-clone-detector
import { describe, expect, it } from 'vitest';
import { flaggedGroups, parseUnifiedDiffRanges, resolveChangedRanges } from '../diff-scope';
import type { LineRange } from '../diff-scope';
import type { CloneReport } from '../detect';

type GitCall = readonly string[];

/** Fake `RunGit` driven by a prefix→result table, recording every call. */
function fakeGit(table: ReadonlyArray<readonly [string, { status?: number; stdout?: string }]>): {
  run: (args: readonly string[]) => { status: number; stdout: string; stderr: string };
  calls: GitCall[];
} {
  const calls: GitCall[] = [];
  const run = (args: readonly string[]) => {
    calls.push(args);
    const joined = args.join(' ');
    for (const [needle, result] of table) {
      if (joined.includes(needle)) {
        return { status: result.status ?? 0, stdout: result.stdout ?? '', stderr: '' };
      }
    }
    return { status: 1, stdout: '', stderr: 'no match' };
  };
  return { run, calls };
}

const report = (
  groups: Array<{ tokens: number; instances: Array<[string, number, number]> }>,
): CloneReport => ({
  groups: groups.map((g) => ({
    tokens: g.tokens,
    lines: 1,
    instances: g.instances.map(([file, startLine, endLine]) => ({ file, startLine, endLine })),
  })),
  filesScanned: 2,
  totalTokens: 100,
  duplicatedTokens: 0,
  duplicationPct: 0,
});

const ranges = (entries: Record<string, Array<[number, number]>>): Map<string, LineRange[]> =>
  new Map(
    Object.entries(entries).map(([file, spans]) => [
      file,
      spans.map(([start, end]) => ({ start, end })),
    ]),
  );

/** One file's worth of real `git diff -U0` framing. */
const fileDiff = (path: string, ...body: string[]): string[] => [
  `diff --git a/${path} b/${path}`,
  'index 1111111..2222222 100644',
  `--- a/${path}`,
  `+++ b/${path}`,
  ...body,
];

describe('parseUnifiedDiffRanges', () => {
  it('collects every hunk of a file', () => {
    const out = parseUnifiedDiffRanges(
      fileDiff('src/a.ts', '@@ -1,2 +1,3 @@', '+body', '@@ -20,0 +30,2 @@', '+x', '+y').join('\n'),
    );
    expect(out.get('src/a.ts')).toEqual([
      { start: 1, end: 3 },
      { start: 30, end: 31 },
    ]);
  });

  it('keys each hunk to the file header above it', () => {
    const out = parseUnifiedDiffRanges(
      [
        ...fileDiff('src/a.ts', '@@ -1 +1,1 @@', '+x'),
        ...fileDiff('src/b.ts', '@@ -5,0 +9,4 @@', '+x'),
      ].join('\n'),
    );
    expect([...out.keys()]).toEqual(['src/a.ts', 'src/b.ts']);
    expect(out.get('src/b.ts')).toEqual([{ start: 9, end: 12 }]);
  });

  it('reads the count-omitted form as one line', () => {
    const out = parseUnifiedDiffRanges(fileDiff('src/a.ts', '@@ -1 +7 @@', '+x').join('\n'));
    expect(out.get('src/a.ts')).toEqual([{ start: 7, end: 7 }]);
  });

  it('drops deletion-only hunks instead of emitting an inverted range', () => {
    const out = parseUnifiedDiffRanges(fileDiff('src/a.ts', '@@ -4,3 +3,0 @@', '-x').join('\n'));
    expect(out.has('src/a.ts')).toBe(false);
  });

  it('ignores hunks under a /dev/null post-image', () => {
    const out = parseUnifiedDiffRanges(
      [
        'diff --git a/src/gone.ts b/src/gone.ts',
        '--- a/src/gone.ts',
        '+++ /dev/null',
        '@@ -1,4 +0,0 @@',
      ].join('\n'),
    );
    expect(out.size).toBe(0);
  });

  it('keys a rename on its new path', () => {
    const out = parseUnifiedDiffRanges(
      [
        'diff --git a/src/old.ts b/src/new.ts',
        'similarity index 90%',
        '--- a/src/old.ts',
        '+++ b/src/new.ts',
        '@@ -1 +1 @@',
        '+x',
      ].join('\n'),
    );
    expect([...out.keys()]).toEqual(['src/new.ts']);
  });

  it('strips the TAB git appends to a path containing whitespace', () => {
    // Verified against git 2.43.1: `+++ b/a b.ts\t` for a path with a space.
    const out = parseUnifiedDiffRanges(
      [
        'diff --git a/src/a b.ts b/src/a b.ts',
        '--- a/src/a b.ts\t',
        '+++ b/src/a b.ts\t',
        '@@ -1,0 +2 @@',
        '+x',
      ].join('\n'),
    );
    expect([...out.keys()]).toEqual(['src/a b.ts']);
  });

  it('does not let an added content line forge a file header', () => {
    // An added line whose content is `++ b/evil.ts` renders as `+++ b/evil.ts`.
    // Honouring it would re-attribute src/a.ts's later hunks to evil.ts.
    const out = parseUnifiedDiffRanges(
      fileDiff(
        'src/a.ts',
        '@@ -1,0 +2,2 @@',
        '+++ b/evil.ts',
        '+z',
        '@@ -9,0 +20 @@',
        '+later',
      ).join('\n'),
    );
    expect(out.has('evil.ts')).toBe(false);
    expect(out.get('src/a.ts')).toEqual([
      { start: 2, end: 3 },
      { start: 20, end: 20 },
    ]);
  });
});

describe('resolveChangedRanges', () => {
  const diffOut = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1 +4,2 @@',
    '+x',
    '+y',
  ].join('\n');

  /** Every table needs this row: a missing `ls-files` answer reads as `null`. */
  const noUntracked = ['ls-files', { stdout: '' }] as const;

  it('honours an explicit base verbatim', () => {
    const { run, calls } = fakeGit([
      ['merge-base --end-of-options v1.0.0 HEAD', { stdout: 'abc123\n' }],
      ['diff -U0', { stdout: diffOut }],
      noUntracked,
    ]);
    expect(resolveChangedRanges({ against: 'v1.0.0', runGit: run })?.get('src/a.ts')).toEqual([
      { start: 4, end: 5 },
    ]);
    expect(calls.some((c) => c.includes('@{upstream}'))).toBe(false);
  });

  it('prefers the upstream when no base was given', () => {
    const { run } = fakeGit([
      ['rev-parse --abbrev-ref @{upstream}', { stdout: 'origin/feat\n' }],
      ['merge-base --end-of-options origin/feat HEAD', { stdout: 'abc123\n' }],
      ['diff -U0', { stdout: diffOut }],
      noUntracked,
    ]);
    expect(resolveChangedRanges({ runGit: run })).not.toBeNull();
  });

  it('falls back to the remote default branch when there is no upstream', () => {
    const { run, calls } = fakeGit([
      ['symbolic-ref --short refs/remotes/origin/HEAD', { stdout: 'origin/trunk\n' }],
      ['merge-base --end-of-options origin/trunk HEAD', { stdout: 'abc123\n' }],
      ['diff -U0', { stdout: diffOut }],
      noUntracked,
    ]);
    expect(resolveChangedRanges({ runGit: run })).not.toBeNull();
    expect(
      calls.some((c) => c.join(' ').includes('merge-base --end-of-options origin/trunk')),
    ).toBe(true);
  });

  it('returns null — not an empty map — when there is no merge base', () => {
    const { run } = fakeGit([['diff -U0', { stdout: diffOut }], noUntracked]);
    expect(resolveChangedRanges({ against: 'v1.0.0', runGit: run })).toBeNull();
  });

  it('returns an empty map when the diff is empty and nothing is untracked', () => {
    const { run } = fakeGit([
      ['merge-base', { stdout: 'abc123\n' }],
      ['diff -U0', { stdout: '' }],
      noUntracked,
    ]);
    expect(resolveChangedRanges({ against: 'v1.0.0', runGit: run })?.size).toBe(0);
  });

  it('pins the git config that could reshape the diff into a silent green', () => {
    const { run, calls } = fakeGit([
      ['merge-base', { stdout: 'abc123\n' }],
      ['diff -U0', { stdout: diffOut }],
      noUntracked,
    ]);
    resolveChangedRanges({ against: 'v1.0.0', runGit: run });
    const diff = calls.find((c) => c.includes('diff'));
    expect(diff).toContain('core.quotepath=false');
    expect(diff).toContain('diff.relative=false');
    expect(diff).toContain('--no-ext-diff');
    expect(diff).toContain('--src-prefix=a/');
    expect(diff).toContain('--dst-prefix=b/');
    // Single ref: the post-image must be the working tree the corpus reads.
    expect(diff?.some((a) => a.includes('...'))).toBe(false);
  });

  it('guards merge-base against a dash-prefixed base from a library caller', () => {
    const { run, calls } = fakeGit([
      ['merge-base', { stdout: 'abc123\n' }],
      ['diff -U0', { stdout: diffOut }],
      noUntracked,
    ]);
    resolveChangedRanges({ against: '--upload-pack=evil', runGit: run });
    const mb = calls.find((c) => c.includes('merge-base'));
    expect(mb?.indexOf('--end-of-options')).toBeLessThan(mb?.indexOf('--upload-pack=evil') ?? -1);
  });

  it('unions untracked files in as whole-file spans (Q-0123)', () => {
    const { run, calls } = fakeGit([
      ['merge-base', { stdout: 'abc123\n' }],
      ['diff -U0', { stdout: diffOut }],
      ['ls-files', { stdout: 'src/new.ts\0src/also new.ts\0' }],
    ]);
    const out = resolveChangedRanges({ against: 'v1.0.0', runGit: run });
    // NUL separation keeps a path with a space intact — no quoting to unwrap.
    expect(out?.get('src/new.ts')).toEqual([{ start: 1, end: Number.MAX_SAFE_INTEGER }]);
    expect(out?.get('src/also new.ts')).toEqual([{ start: 1, end: Number.MAX_SAFE_INTEGER }]);
    // Tracked diff ranges survive alongside the untracked union.
    expect(out?.get('src/a.ts')).toEqual([{ start: 4, end: 5 }]);
    const ls = calls.find((c) => c.includes('ls-files'));
    expect(ls).toContain('--others');
    expect(ls).toContain('--exclude-standard');
    expect(ls).toContain('-z');
  });

  it('returns null when git cannot list untracked files — unknown is not clean', () => {
    const { run } = fakeGit([
      ['merge-base', { stdout: 'abc123\n' }],
      ['diff -U0', { stdout: diffOut }],
      ['ls-files', { status: 128 }],
    ]);
    expect(resolveChangedRanges({ against: 'v1.0.0', runGit: run })).toBeNull();
  });

  it('flags a clone instance living entirely in an untracked file end-to-end', () => {
    // The Q-0123 shape: a brand-new (never-committed) file whose whole body is
    // a paste. `git diff` says nothing about it; the union must still flag it.
    const { run } = fakeGit([
      ['merge-base', { stdout: 'abc123\n' }],
      ['diff -U0', { stdout: '' }],
      ['ls-files', { stdout: 'src/pasted.ts\0' }],
    ]);
    const changed = resolveChangedRanges({ against: 'v1.0.0', runGit: run });
    expect(changed).not.toBeNull();
    const r = report([{ tokens: 60, instances: [['src/pasted.ts', 10, 20]] }]);
    expect(flaggedGroups(r, changed!)).toHaveLength(1);
  });
});

describe('flaggedGroups', () => {
  it('flags an instance the change wrote entirely (a real paste, 100% coverage)', () => {
    const r = report([{ tokens: 60, instances: [['src/a.ts', 10, 20]] }]);
    expect(flaggedGroups(r, ranges({ 'src/a.ts': [[10, 20]] }))).toHaveLength(1);
  });

  it('leaves a group wholly outside the changed lines alone', () => {
    const r = report([{ tokens: 60, instances: [['src/a.ts', 10, 20]] }]);
    expect(flaggedGroups(r, ranges({ 'src/a.ts': [[21, 30]] }))).toHaveLength(0);
  });

  it('does not flag a one-line graze inside an instance (the Q-0094 data-table edit)', () => {
    // 1 of 11 lines changed ≈ 9% — the manifest.ts `desc:` edit shape.
    const r = report([{ tokens: 60, instances: [['src/a.ts', 10, 20]] }]);
    expect(flaggedGroups(r, ranges({ 'src/a.ts': [[15, 15]] }))).toHaveLength(0);
  });

  it('does not flag the recorded adjacency coverages (25%, 37%, ~55%)', () => {
    // 100-line instance so the percentages are exact.
    const r = report([{ tokens: 200, instances: [['src/a.ts', 1, 100]] }]);
    expect(flaggedGroups(r, ranges({ 'src/a.ts': [[1, 25]] }))).toHaveLength(0);
    expect(flaggedGroups(r, ranges({ 'src/a.ts': [[1, 37]] }))).toHaveLength(0);
    expect(flaggedGroups(r, ranges({ 'src/a.ts': [[1, 55]] }))).toHaveLength(0);
  });

  it('flags at the 70% coverage threshold inclusively, not one line below it', () => {
    const r = report([{ tokens: 200, instances: [['src/a.ts', 1, 100]] }]);
    expect(flaggedGroups(r, ranges({ 'src/a.ts': [[1, 70]] }))).toHaveLength(1);
    expect(flaggedGroups(r, ranges({ 'src/a.ts': [[1, 69]] }))).toHaveLength(0);
  });

  it('sums disjoint changed ranges toward one instance coverage', () => {
    // 40 + 40 = 80 of 100 lines — covered even though no single hunk clears 70%.
    const r = report([{ tokens: 200, instances: [['src/a.ts', 1, 100]] }]);
    expect(
      flaggedGroups(
        r,
        ranges({
          'src/a.ts': [
            [1, 40],
            [61, 100],
          ],
        }),
      ),
    ).toHaveLength(1);
  });

  it('does not double-count overlapping changed ranges', () => {
    // Two ranges over the same 50 lines are 50% coverage, not 100%.
    const r = report([{ tokens: 200, instances: [['src/a.ts', 1, 100]] }]);
    expect(
      flaggedGroups(
        r,
        ranges({
          'src/a.ts': [
            [1, 50],
            [1, 50],
          ],
        }),
      ),
    ).toHaveLength(0);
  });

  it('clips a changed range to the instance span before measuring coverage', () => {
    // The change covers 5 of 11 instance lines (≈45%); the 20 lines it wrote
    // past the instance must not inflate that.
    const r = report([{ tokens: 60, instances: [['src/a.ts', 10, 20]] }]);
    expect(flaggedGroups(r, ranges({ 'src/a.ts': [[16, 40]] }))).toHaveLength(0);
  });

  it('flags a straddling group when the changed side of it was substantially written', () => {
    const r = report([
      {
        tokens: 60,
        instances: [
          ['src/a.ts', 10, 20],
          ['src/b.ts', 80, 90],
        ],
      },
    ]);
    // 9 of 11 lines (≈82%) of the b.ts instance — a paste next to existing code.
    expect(flaggedGroups(r, ranges({ 'src/b.ts': [[80, 88]] }))).toHaveLength(1);
    // 2 of 11 lines (≈18%) — an edit that merely lands inside the clone.
    expect(flaggedGroups(r, ranges({ 'src/b.ts': [[85, 86]] }))).toHaveLength(0);
  });

  it('flags a group whose instances are ALL inside the change', () => {
    const r = report([
      {
        tokens: 60,
        instances: [
          ['src/a.ts', 10, 20],
          ['src/a.ts', 40, 50],
        ],
      },
    ]);
    expect(flaggedGroups(r, ranges({ 'src/a.ts': [[1, 60]] }))).toHaveLength(1);
  });

  it('does not flag on a single shared boundary line', () => {
    const r = report([{ tokens: 60, instances: [['src/a.ts', 10, 20]] }]);
    expect(flaggedGroups(r, ranges({ 'src/a.ts': [[20, 25]] }))).toHaveLength(0);
    expect(flaggedGroups(r, ranges({ 'src/a.ts': [[1, 10]] }))).toHaveLength(0);
  });

  it('does not match the same line numbers in a different file', () => {
    const r = report([{ tokens: 60, instances: [['src/a.ts', 10, 20]] }]);
    expect(flaggedGroups(r, ranges({ 'src/b.ts': [[10, 20]] }))).toHaveLength(0);
  });
});
