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

  it('honours an explicit base verbatim', () => {
    const { run, calls } = fakeGit([
      ['merge-base --end-of-options v1.0.0 HEAD', { stdout: 'abc123\n' }],
      ['diff -U0', { stdout: diffOut }],
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
    ]);
    expect(resolveChangedRanges({ runGit: run })).not.toBeNull();
  });

  it('falls back to the remote default branch when there is no upstream', () => {
    const { run, calls } = fakeGit([
      ['symbolic-ref --short refs/remotes/origin/HEAD', { stdout: 'origin/trunk\n' }],
      ['merge-base --end-of-options origin/trunk HEAD', { stdout: 'abc123\n' }],
      ['diff -U0', { stdout: diffOut }],
    ]);
    expect(resolveChangedRanges({ runGit: run })).not.toBeNull();
    expect(
      calls.some((c) => c.join(' ').includes('merge-base --end-of-options origin/trunk')),
    ).toBe(true);
  });

  it('returns null — not an empty map — when there is no merge base', () => {
    const { run } = fakeGit([['diff -U0', { stdout: diffOut }]]);
    expect(resolveChangedRanges({ against: 'v1.0.0', runGit: run })).toBeNull();
  });

  it('returns an empty map when the diff is empty', () => {
    const { run } = fakeGit([
      ['merge-base', { stdout: 'abc123\n' }],
      ['diff -U0', { stdout: '' }],
    ]);
    expect(resolveChangedRanges({ against: 'v1.0.0', runGit: run })?.size).toBe(0);
  });

  it('pins the git config that could reshape the diff into a silent green', () => {
    const { run, calls } = fakeGit([
      ['merge-base', { stdout: 'abc123\n' }],
      ['diff -U0', { stdout: diffOut }],
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
    ]);
    resolveChangedRanges({ against: '--upload-pack=evil', runGit: run });
    const mb = calls.find((c) => c.includes('merge-base'));
    expect(mb?.indexOf('--end-of-options')).toBeLessThan(mb?.indexOf('--upload-pack=evil') ?? -1);
  });
});

describe('flaggedGroups', () => {
  it('flags a group whose instance overlaps a changed line', () => {
    const r = report([{ tokens: 60, instances: [['src/a.ts', 10, 20]] }]);
    expect(flaggedGroups(r, ranges({ 'src/a.ts': [[15, 15]] }))).toHaveLength(1);
  });

  it('leaves a group wholly outside the changed lines alone', () => {
    const r = report([{ tokens: 60, instances: [['src/a.ts', 10, 20]] }]);
    expect(flaggedGroups(r, ranges({ 'src/a.ts': [[21, 30]] }))).toHaveLength(0);
  });

  it('flags a straddling group', () => {
    const r = report([
      {
        tokens: 60,
        instances: [
          ['src/a.ts', 10, 20],
          ['src/b.ts', 80, 90],
        ],
      },
    ]);
    expect(flaggedGroups(r, ranges({ 'src/b.ts': [[85, 86]] }))).toHaveLength(1);
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

  it('flags on a single shared boundary line', () => {
    const r = report([{ tokens: 60, instances: [['src/a.ts', 10, 20]] }]);
    expect(flaggedGroups(r, ranges({ 'src/a.ts': [[20, 25]] }))).toHaveLength(1);
    expect(flaggedGroups(r, ranges({ 'src/a.ts': [[1, 10]] }))).toHaveLength(1);
  });

  it('does not match the same line numbers in a different file', () => {
    const r = report([{ tokens: 60, instances: [['src/a.ts', 10, 20]] }]);
    expect(flaggedGroups(r, ranges({ 'src/b.ts': [[10, 20]] }))).toHaveLength(0);
  });
});
