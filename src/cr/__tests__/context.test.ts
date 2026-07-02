// @tests: acceptance-verify-lane, noldor
import { describe, expect, it, vi } from 'vitest';
import { buildContext } from '../context.js';

const fakeGit = (responses: Record<string, string>) =>
  vi.fn((args: string[]) => responses[args.join(' ')] ?? '');

describe('buildContext', () => {
  it('gate lane uses main...HEAD diff', () => {
    const git = fakeGit({ 'diff main...HEAD': 'DIFF_BODY' });
    const ctx = buildContext({
      lane: { kind: 'gate' },
      runGit: git,
      featureMd: 'FD',
      rules: 'RULES',
    });
    expect(ctx.diff).toBe('DIFF_BODY');
    expect(ctx.featureMd).toBe('FD');
    expect(ctx.rules).toBe('RULES');
    expect(git).toHaveBeenCalledWith(['diff', 'main...HEAD']);
  });

  it('working lane uses git diff HEAD', () => {
    const git = fakeGit({ 'diff HEAD': 'WORKING' });
    const ctx = buildContext({ lane: { kind: 'working' }, runGit: git, featureMd: '', rules: '' });
    expect(ctx.diff).toBe('WORKING');
  });

  it('sha lane uses main...<sha>', () => {
    const git = fakeGit({ 'diff main...abc': 'SHA_DIFF' });
    const ctx = buildContext({
      lane: { kind: 'sha', sha: 'abc' },
      runGit: git,
      featureMd: '',
      rules: '',
    });
    expect(ctx.diff).toBe('SHA_DIFF');
  });

  it('range lane uses <from>..<to>', () => {
    const git = fakeGit({ 'diff aaa..bbb': 'RANGE' });
    const ctx = buildContext({
      lane: { kind: 'range', from: 'aaa', to: 'bbb' },
      runGit: git,
      featureMd: '',
      rules: '',
    });
    expect(ctx.diff).toBe('RANGE');
  });

  it('paths flag scopes the diff', () => {
    const git = fakeGit({ 'diff main...HEAD -- a.ts b.ts': 'PATHS' });
    const ctx = buildContext({
      lane: { kind: 'gate' },
      paths: ['a.ts', 'b.ts'],
      runGit: git,
      featureMd: '',
      rules: '',
    });
    expect(ctx.diff).toBe('PATHS');
  });

  it('omits the -- separator when paths is undefined', () => {
    const git = fakeGit({ 'diff main...HEAD': 'NO_PATHS' });
    const ctx = buildContext({ lane: { kind: 'gate' }, runGit: git, featureMd: '', rules: '' });
    expect(ctx.diff).toBe('NO_PATHS');
    expect(git).toHaveBeenCalledWith(['diff', 'main...HEAD']);
  });

  it('omits the -- separator when paths is empty', () => {
    const git = fakeGit({ 'diff main...HEAD': 'EMPTY_PATHS' });
    const ctx = buildContext({
      lane: { kind: 'gate' },
      paths: [],
      runGit: git,
      featureMd: '',
      rules: '',
    });
    expect(ctx.diff).toBe('EMPTY_PATHS');
    expect(git).toHaveBeenCalledWith(['diff', 'main...HEAD']);
  });
});
