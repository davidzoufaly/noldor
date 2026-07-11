// @tests: noldor
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { decideFmtGuard, isNoTargetFailure, NO_TARGET_MARKER } from '../fmt-guard.js';
import { main, resolveOxfmt, type FmtRunner } from '../fmt-guard-cli.js';

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
