// @tests: noldor
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  decideFmtGuard,
  isNoTargetFailure,
  LEFTHOOK_UNSTAGED_PATCH,
  NO_TARGET_MARKER,
  PARTIAL_STAGING_WARNING,
  shouldWarnPartialStaging,
} from '../fmt-guard.js';
import { lefthookPatchPresent, main, resolveOxfmt, type FmtRunner } from '../fmt-guard-cli.js';

describe('isNoTargetFailure', () => {
  it('is true when a non-zero run carries the no-target marker', () => {
    expect(isNoTargetFailure(1, `error: ${NO_TARGET_MARKER}`)).toBe(true);
  });
  it('is false on a clean run even if the marker text somehow appears', () => {
    // status 0 always wins — a successful run is never a no-target failure.
    expect(isNoTargetFailure(0, NO_TARGET_MARKER)).toBe(false);
  });
  it('is false for a real format failure (no marker)', () => {
    expect(isNoTargetFailure(1, 'would reformat src/foo.ts')).toBe(false);
  });
  it('is false when the status is non-zero but the marker is absent (null status)', () => {
    expect(isNoTargetFailure(null, 'killed by signal')).toBe(false);
  });
});

describe('decideFmtGuard', () => {
  it('swallows the no-target failure → exit 0, output suppressed', () => {
    const d = decideFmtGuard({ status: 1, stdout: '', stderr: `oxfmt: ${NO_TARGET_MARKER}` });
    expect(d).toEqual({ code: 0, stdout: '', stderr: '', swallowed: true });
  });
  it('passes a clean run through verbatim', () => {
    const d = decideFmtGuard({ status: 0, stdout: 'formatted 3 files\n', stderr: '' });
    expect(d).toEqual({ code: 0, stdout: 'formatted 3 files\n', stderr: '', swallowed: false });
  });
  it('passes a real format failure through with its code + output', () => {
    const d = decideFmtGuard({ status: 1, stdout: 'would reformat src/a.ts\n', stderr: '' });
    expect(d).toEqual({
      code: 1,
      stdout: 'would reformat src/a.ts\n',
      stderr: '',
      swallowed: false,
    });
  });
  it('detects the marker across the stdout+stderr boundary', () => {
    // oxfmt may split the message; the guard concatenates before matching.
    const half = NO_TARGET_MARKER.slice(0, 10);
    const rest = NO_TARGET_MARKER.slice(10);
    const d = decideFmtGuard({ status: 1, stdout: half, stderr: rest });
    expect(d.swallowed).toBe(true);
    expect(d.code).toBe(0);
  });
  it('maps a signal kill (null status, no marker) to exit 1', () => {
    const d = decideFmtGuard({ status: null, stdout: '', stderr: 'terminated' });
    expect(d).toEqual({ code: 1, stdout: '', stderr: 'terminated', swallowed: false });
  });
});

describe('main', () => {
  afterEach(() => vi.restoreAllMocks());

  const silence = (): void => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  };

  it('forwards argv to the runner and returns 0 on a no-target failure', () => {
    silence();
    const seen: string[][] = [];
    const runner: FmtRunner = (argv) => {
      seen.push(argv);
      return { status: 1, stdout: '', stderr: NO_TARGET_MARKER };
    };
    expect(main(['--check', 'docs/x.md'], runner)).toBe(0);
    expect(seen).toEqual([['--check', 'docs/x.md']]);
  });

  it('returns the real exit code on a genuine format failure', () => {
    silence();
    const runner: FmtRunner = () => ({ status: 1, stdout: 'would reformat a.ts\n', stderr: '' });
    expect(main(['--check', 'a.ts'], runner)).toBe(1);
  });

  it('returns 0 and emits output on a clean run', () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const runner: FmtRunner = () => ({ status: 0, stdout: 'ok\n', stderr: '' });
    expect(main(['a.ts'], runner)).toBe(0);
    expect(out).toHaveBeenCalledWith('ok\n');
  });

  it('does not emit anything when a no-target failure is swallowed', () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const runner: FmtRunner = () => ({ status: 1, stdout: '', stderr: NO_TARGET_MARKER });
    main(['--check', 'x.md'], runner);
    expect(out).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });
});

describe('shouldWarnPartialStaging', () => {
  it('warns when a writing run coincides with lefthook’s saved unstaged patch', () => {
    expect(shouldWarnPartialStaging({ patchPresent: true, check: false })).toBe(true);
  });
  it('stays quiet on a --check run — it never writes, so nothing shifts', () => {
    expect(shouldWarnPartialStaging({ patchPresent: true, check: true })).toBe(false);
  });
  it('stays quiet when no patch is saved (nothing was partially staged)', () => {
    expect(shouldWarnPartialStaging({ patchPresent: false, check: false })).toBe(false);
  });
});

describe('main — partial-staging advisory', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emits the advisory after a writing run when the patch is present', () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const runner: FmtRunner = () => ({ status: 0, stdout: '', stderr: '' });
    expect(main(['a.ts'], runner, () => true)).toBe(0);
    expect(err).toHaveBeenCalledWith(PARTIAL_STAGING_WARNING);
  });

  it('still emits it on a real format failure, and leaves the exit code alone', () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    // oxfmt may have rewritten several files before failing on another one.
    const runner: FmtRunner = () => ({ status: 1, stdout: 'error\n', stderr: '' });
    expect(main(['a.ts'], runner, () => true)).toBe(1);
    expect(err).toHaveBeenCalledWith(PARTIAL_STAGING_WARNING);
  });

  it('does not emit it on a --check run', () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const runner: FmtRunner = () => ({ status: 0, stdout: '', stderr: '' });
    main(['--check', 'a.ts'], runner, () => true);
    expect(err).not.toHaveBeenCalledWith(PARTIAL_STAGING_WARNING);
  });

  it('does not emit it when the no-target failure was swallowed (nothing formatted)', () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const runner: FmtRunner = () => ({ status: 1, stdout: '', stderr: NO_TARGET_MARKER });
    main(['x.md'], runner, () => true);
    expect(err).not.toHaveBeenCalled();
  });
});

describe('lefthookPatchPresent', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('is false outside a git repository (advisory never gates)', () => {
    dir = mkdtempSync(join(tmpdir(), 'fmt-guard-nogit-'));
    expect(lefthookPatchPresent(dir)).toBe(false);
  });

  it('is true when the patch exists under the resolved git dir', () => {
    dir = mkdtempSync(join(tmpdir(), 'fmt-guard-git-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    mkdirSync(join(dir, '.git', 'info'), { recursive: true });
    writeFileSync(join(dir, '.git', LEFTHOOK_UNSTAGED_PATCH), 'diff --git a/x b/x\n');
    expect(lefthookPatchPresent(dir)).toBe(true);
  });

  it('is false in a git repo with no saved patch', () => {
    dir = mkdtempSync(join(tmpdir(), 'fmt-guard-git-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    expect(lefthookPatchPresent(dir)).toBe(false);
  });

  it('finds the patch from inside a worktree — it lives in the git COMMON dir', () => {
    // Regression: `git rev-parse --git-dir` inside a worktree resolves to
    // .git/worktrees/<name>, where lefthook never writes. The fast-track/drain
    // paths all run in worktrees, so a --git-dir lookup left the advisory dead
    // exactly where it is needed. Must resolve --git-common-dir.
    dir = mkdtempSync(join(tmpdir(), 'fmt-guard-wt-'));
    const mainRepo = join(dir, 'repo');
    mkdirSync(mainRepo, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: mainRepo });
    execFileSync(
      'git',
      [
        '-c',
        'user.email=t@t.io',
        '-c',
        'user.name=t',
        'commit',
        '-q',
        '--allow-empty',
        '-m',
        'root',
      ],
      { cwd: mainRepo },
    );
    const wt = join(dir, 'wt');
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'feat', wt], { cwd: mainRepo });

    expect(lefthookPatchPresent(wt)).toBe(false);
    writeFileSync(join(mainRepo, '.git', LEFTHOOK_UNSTAGED_PATCH), 'diff --git a/x b/x\n');
    expect(lefthookPatchPresent(wt)).toBe(true);
  });
});

describe('resolveOxfmt', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('prefers the cwd-local node_modules/.bin/oxfmt when present', () => {
    dir = mkdtempSync(join(tmpdir(), 'fmt-guard-'));
    const bin = join(dir, 'node_modules', '.bin');
    mkdirSync(bin, { recursive: true });
    const local = join(bin, 'oxfmt');
    writeFileSync(local, '#!/bin/sh\n');
    expect(existsSync(local)).toBe(true);
    expect(resolveOxfmt(dir)).toBe(local);
  });

  it('falls back to bare `oxfmt` on PATH when no local binary exists', () => {
    dir = mkdtempSync(join(tmpdir(), 'fmt-guard-'));
    expect(resolveOxfmt(dir)).toBe('oxfmt');
  });
});
