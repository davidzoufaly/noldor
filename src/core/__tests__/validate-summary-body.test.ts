// @tests: pr-summary-body-enforcement
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateSummaryBody } from '../validate-summary-body.js';

const GOOD_BODY = [
  'fix(clones): union untracked files into the diff-scoped verdict',
  '',
  'Why — a new file has no git post-image, so the clone gate printed green',
  'for a file whose every line was just written.',
  'How — resolveChangedRanges now unions `git ls-files --others` into the',
  'changed-range map as whole-file spans.',
  'What — src/clones/ranges.ts plus a regression test.',
  '',
  'Noldor-Path: fast-track',
].join('\n');

const CODE = ['src/clones/ranges.ts'];

describe('validateSummaryBody', () => {
  it('accepts a body carrying all three sections', () => {
    expect(validateSummaryBody({ message: GOOD_BODY, stagedFiles: CODE }).success).toBe(true);
  });

  for (const section of ['Why', 'How', 'What']) {
    it(`rejects a body missing ${section}`, () => {
      const message = GOOD_BODY.split('\n')
        .filter((l) => !l.startsWith(`${section} —`))
        .join('\n');
      const result = validateSummaryBody({ message, stagedFiles: CODE });
      expect(result.success).toBe(false);
      expect(result.error).toContain(section);
    });
  }

  it('rejects a section that exists but says nothing', () => {
    const message = ['fix(x): y', '', 'Why — x', 'How — y', 'What — z'].join('\n');
    const result = validateSummaryBody({ message, stagedFiles: CODE });
    expect(result.success).toBe(false);
    expect(result.error).toContain('under 24 chars');
  });

  it('accepts sections in any order — presence is the bar, not sequence', () => {
    const message = [
      'fix(x): y',
      '',
      'What — src/clones/ranges.ts plus a regression test.',
      'Why — a new file has no git post-image, so the gate printed green.',
      'How — resolveChangedRanges unions ls-files output into the range map.',
    ].join('\n');
    expect(validateSummaryBody({ message, stagedFiles: CODE }).success).toBe(true);
  });

  // `Why:` in a body's last paragraph is a valid git trailer and
  // interpret-trailers absorbs it — the reason the markers use an em dash.
  it('rejects the colon form and says why', () => {
    const message = [
      'fix(x): y',
      '',
      'Why: a new file has no git post-image, so the gate printed green.',
      'How: resolveChangedRanges unions ls-files output into the range map.',
      'What: src/clones/ranges.ts plus a regression test.',
    ].join('\n');
    const result = validateSummaryBody({ message, stagedFiles: CODE });
    expect(result.success).toBe(false);
    expect(result.error).toContain('em dash');
  });

  // Trailers are stripped before the sections are measured, so a trailer line
  // sitting inside a section cannot pad it over the threshold.
  it('does not count trailer lines toward section content', () => {
    const padded = [
      'fix(x): y',
      '',
      'Why — the gate printed green for a brand-new file, silently.',
      'How — ranges now union ls-files output into the changed-range map.',
      'What — short.',
      'Noldor-Path: fast-track',
      'Noldor-FD: some-slug',
    ].join('\n');
    const result = validateSummaryBody({ message: padded, stagedFiles: CODE });
    expect(result.success).toBe(false);
    expect(result.error).toContain('What');
  });

  it('measures a section across its continuation lines', () => {
    const wrapped = [
      'fix(x): y',
      '',
      'Why — the gate printed green for a brand-new file, silently.',
      'How — ranges now union ls-files output into the changed-range map.',
      'What — one file,',
      'plus the regression test that pins it.',
    ].join('\n');
    expect(validateSummaryBody({ message: wrapped, stagedFiles: CODE }).success).toBe(true);
  });

  describe('exemptions', () => {
    const bare = 'chore: no body at all';

    it('exempts a bookkeeping-only staged set', () => {
      expect(
        validateSummaryBody({
          message: 'docs(roadmap): retire some-slug — shipped via fast-track (no FD)',
          stagedFiles: ['docs/roadmap.md', '.noldor/retired-entry-ids.json'],
        }).success,
      ).toBe(true);
    });

    it('exempts an empty staged set', () => {
      expect(validateSummaryBody({ message: bare, stagedFiles: [] }).success).toBe(true);
    });

    it('exempts fixup!, squash! and Revert subjects', () => {
      for (const subject of ['fixup! fix(x): y', 'squash! fix(x): y', 'Revert "fix(x): y"']) {
        expect(validateSummaryBody({ message: subject, stagedFiles: CODE }).success).toBe(true);
      }
    });

    it('exempts release automation by trailer', () => {
      const message = ['chore(release): v1.3.0', '', 'Noldor-Path: release-automation'].join('\n');
      expect(validateSummaryBody({ message, stagedFiles: CODE }).success).toBe(true);
    });

    it('exempts a real merge (mergeInProgress true)', () => {
      expect(
        validateSummaryBody({
          message: "Merge branch 'main' into feat/x",
          stagedFiles: CODE,
          mergeInProgress: true,
        }).success,
      ).toBe(true);
    });

    // The forgery the MERGE_HEAD keying exists to stop.
    it('rejects a forged Merge subject with no merge in progress', () => {
      expect(
        validateSummaryBody({ message: "Merge branch 'fake'", stagedFiles: CODE }).success,
      ).toBe(false);
    });

    it('rejects when mergeInProgress is absent — omission must not buy the exemption', () => {
      expect(
        validateSummaryBody({ message: "Merge branch 'main'", stagedFiles: CODE }).success,
      ).toBe(false);
    });
  });
});

describe('git merge semantics the exemption depends on', () => {
  // The design rests on two empirical claims about git. Pin them here rather
  // than trusting prose: a git that stopped setting MERGE_HEAD during
  // commit-msg would silently disable the exemption.
  it('sets MERGE_HEAD during a real merge and not on a clean tree', () => {
    const repo = mkdtempSync(join(tmpdir(), 'noldor-mergehead-'));
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');

    writeFileSync(join(repo, 'seed.txt'), 'seed\n');
    git('add', '.');
    git('commit', '-q', '-m', 'seed');

    const mergeHeadResolves = (): boolean => {
      try {
        execFileSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], {
          cwd: repo,
          stdio: 'pipe',
        });
        return true;
      } catch {
        return false;
      }
    };

    expect(mergeHeadResolves()).toBe(false);

    git('checkout', '-q', '-b', 'side');
    writeFileSync(join(repo, 'side.txt'), 'side\n');
    git('add', '.');
    git('commit', '-q', '-m', 'side work');
    git('checkout', '-q', 'main');
    writeFileSync(join(repo, 'main.txt'), 'main\n');
    git('add', '.');
    git('commit', '-q', '-m', 'main work');

    // --no-commit leaves the merge in progress, which is exactly the state the
    // commit-msg hook observes mid-merge.
    try {
      git('merge', '--no-commit', '--no-ff', 'side');
    } catch {
      // a conflict would also leave MERGE_HEAD set; either way the assertion holds
    }
    expect(mergeHeadResolves()).toBe(true);
  });
});
