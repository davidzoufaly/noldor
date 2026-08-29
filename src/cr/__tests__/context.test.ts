// @tests: acceptance-verify-lane, noldor
import { describe, expect, it, vi } from 'vitest';
import { REVIEW_IRRELEVANT_EXCLUDES, buildContext } from '../context.js';

/**
 * Every diff carries the generated-output excludes, so a case scripts the lane
 * part of the command and this appends the rest — otherwise each expectation
 * would restate the exclusion list and stop testing the lane at all.
 */
const withExcludes = (lane: string, paths: string[] = []): string =>
  [lane, '--', ...paths, ...REVIEW_IRRELEVANT_EXCLUDES].join(' ');

const fakeGit = (responses: Record<string, string>) =>
  vi.fn((args: string[]) => responses[args.join(' ')] ?? '');

describe('buildContext', () => {
  it('gate lane uses main...HEAD diff', () => {
    const git = fakeGit({ [withExcludes('diff main...HEAD')]: 'DIFF_BODY' });
    const ctx = buildContext({
      lane: { kind: 'gate' },
      runGit: git,
      featureMd: 'FD',
      rules: 'RULES',
    });
    expect(ctx.diff).toBe('DIFF_BODY');
    expect(ctx.featureMd).toBe('FD');
    expect(ctx.rules).toBe('RULES');
    expect(git).toHaveBeenCalledWith(['diff', 'main...HEAD', '--', ...REVIEW_IRRELEVANT_EXCLUDES]);
  });

  it('working lane uses git diff HEAD', () => {
    const git = fakeGit({ [withExcludes('diff HEAD')]: 'WORKING' });
    const ctx = buildContext({ lane: { kind: 'working' }, runGit: git, featureMd: '', rules: '' });
    expect(ctx.diff).toBe('WORKING');
  });

  it('sha lane uses main...<sha>', () => {
    const git = fakeGit({ [withExcludes('diff main...abc')]: 'SHA_DIFF' });
    const ctx = buildContext({
      lane: { kind: 'sha', sha: 'abc' },
      runGit: git,
      featureMd: '',
      rules: '',
    });
    expect(ctx.diff).toBe('SHA_DIFF');
  });

  it('range lane uses <from>..<to>', () => {
    const git = fakeGit({ [withExcludes('diff aaa..bbb')]: 'RANGE' });
    const ctx = buildContext({
      lane: { kind: 'range', from: 'aaa', to: 'bbb' },
      runGit: git,
      featureMd: '',
      rules: '',
    });
    expect(ctx.diff).toBe('RANGE');
  });

  it('paths flag scopes the diff', () => {
    const git = fakeGit({ [withExcludes('diff main...HEAD', ['a.ts', 'b.ts'])]: 'PATHS' });
    const ctx = buildContext({
      lane: { kind: 'gate' },
      paths: ['a.ts', 'b.ts'],
      runGit: git,
      featureMd: '',
      rules: '',
    });
    expect(ctx.diff).toBe('PATHS');
  });

  it('still carries the excludes when paths is undefined', () => {
    // The separator is present even with no caller paths: an empty positive
    // pathspec set plus excludes reads as "everything except these", which is
    // the intent. The pre-exclusion contract omitted it because there was
    // nothing to put after it.
    const git = fakeGit({ [withExcludes('diff main...HEAD')]: 'NO_PATHS' });
    const ctx = buildContext({ lane: { kind: 'gate' }, runGit: git, featureMd: '', rules: '' });
    expect(ctx.diff).toBe('NO_PATHS');
    expect(git).toHaveBeenCalledWith(['diff', 'main...HEAD', '--', ...REVIEW_IRRELEVANT_EXCLUDES]);
  });

  it('still carries the excludes when paths is empty', () => {
    const git = fakeGit({ [withExcludes('diff main...HEAD')]: 'EMPTY_PATHS' });
    const ctx = buildContext({
      lane: { kind: 'gate' },
      paths: [],
      runGit: git,
      featureMd: '',
      rules: '',
    });
    expect(ctx.diff).toBe('EMPTY_PATHS');
    expect(git).toHaveBeenCalledWith(['diff', 'main...HEAD', '--', ...REVIEW_IRRELEVANT_EXCLUDES]);
  });
});
