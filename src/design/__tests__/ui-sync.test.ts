// @tests: pendev-ui-design-phase
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blobIdOfWorktreeFile, receiptRelPath } from '../ui-capture.js';
import { main, renderSurfaceReport, validateBaselineFile } from '../ui-sync-cli.js';

describe('renderSurfaceReport', () => {
  it('prints verdict, detail and the edit instruction per surface', () => {
    const out = renderSurfaceReport({
      surface: 'dashboard',
      status: 'stale',
      uiCommit: 'a'.repeat(40),
      baselineCommit: 'b'.repeat(40),
      detail: 'UI newer than baseline',
    });
    expect(out).toContain('dashboard');
    expect(out).toContain('stale');
    expect(out).toContain('edit docs/design/ui/baseline/dashboard.pen');
  });
  it('an indeterminate row says the check could not run, never "no action"', () => {
    // `no action` is what this command prints for a healthy surface, so using
    // it here would report an unchecked surface as clean.
    const out = renderSurfaceReport({
      surface: 'app',
      status: 'indeterminate',
      detail: 'git show failed',
    });
    expect(out).toContain('the check could not run');
    expect(out).not.toContain('no action');
  });

  it('uninitialized instructs bootstrap-create', () => {
    const out = renderSurfaceReport({
      surface: 'app',
      status: 'uninitialized',
      detail: 'no baseline',
    });
    expect(out).toContain('create docs/design/ui/baseline/app.pen');
  });
});

describe('renderSurfaceReport — capture remediation', () => {
  it('points a capture-remediated row at design capture, never at "no action"', () => {
    // This command is what the freshness detail tells operators to run, so a
    // row it reports as `no action` is a dead end.
    const out = renderSurfaceReport({
      surface: 'app',
      status: 'unverified',
      remediation: 'capture',
      detail: 'baseline at/after UI but no capture has vouched for it',
    });
    expect(out).toContain('design capture --surface app');
    expect(out).not.toContain('no action');
  });

  it('keeps the by-hand pencil instruction for a legacy stale row', () => {
    const out = renderSurfaceReport({
      surface: 'app',
      status: 'stale',
      remediation: 'ui-sync',
      uiCommit: 'abcdef1234',
      detail: 'UI newer than baseline',
    });
    expect(out).toContain('pencil-capable session');
    expect(out).not.toContain('design capture');
  });
});

describe('validateBaselineFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ui-sync-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails on missing file', () => {
    expect(validateBaselineFile(join(tmpDir, 'nope.pen'), { staged: true })).toEqual({
      ok: false,
      reason: 'missing',
    });
  });
  it('fails on empty file and on unstaged change', () => {
    const empty = join(tmpDir, 'empty.pen');
    writeFileSync(empty, '', 'utf8');
    expect(validateBaselineFile(empty, { staged: true })).toEqual({ ok: false, reason: 'empty' });

    const full = join(tmpDir, 'full.pen');
    writeFileSync(full, 'pen-bytes', 'utf8');
    expect(validateBaselineFile(full, { staged: false })).toEqual({
      ok: false,
      reason: 'not staged',
    });
  });
  it('passes on non-empty staged file with the completes-at-commit notice', () => {
    const full = join(tmpDir, 'full.pen');
    writeFileSync(full, 'pen-bytes', 'utf8');
    const v = validateBaselineFile(full, { staged: true });
    expect(v.ok).toBe(true);
    expect(v.notice).toMatch(/completes .*commit/i);
  });
});

describe('ui-sync main — a surface the freshness check could not evaluate', () => {
  let cwd: string;
  let epoch = 1000;

  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd, stdio: 'pipe' });
  };
  const write = (rel: string, body: string): void => {
    const abs = join(cwd, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, 'utf8');
  };
  const commit = (msg: string): void => {
    epoch += 100;
    git('add', '-A');
    execFileSync('git', ['commit', '-q', '-m', msg], {
      cwd,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: `@${epoch} +0000`,
        GIT_COMMITTER_DATE: `@${epoch} +0000`,
      },
    });
  };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'ui-sync-main-'));
    epoch = 1000;
    git('init', '-q');
    git('config', 'user.email', 't@e');
    git('config', 'user.name', 't');
    write(
      '.noldor/config.json',
      JSON.stringify({
        consumer: {
          name: 'x',
          repoUrl: 'https://example.com/x',
          lockstepPackages: ['x'],
          e2ePrefix: 'e2e',
          samplesPath: 'samples',
          packagePrefix: '@x/',
          appPathPrefix: 'apps/',
          uiPaths: ['src/app/**'],
        },
      }),
    );
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('exits 0 and says the surface went unchecked, instead of claiming nothing pending', async () => {
    // An indeterminate row has nothing for this command to stage, so it must
    // not exit 1 and send the operator to a pencil session — and it must not be
    // swallowed into the plain "nothing pending" line either, which is what a
    // reader would take as "checked, all clear".
    write('src/app/page.tsx', 'ui');
    commit('feat: ui');
    write('docs/design/ui/baseline/app.pen', 'pen');
    commit('docs: baseline');
    const blob = blobIdOfWorktreeFile(cwd, 'docs/design/ui/baseline/app.pen');
    write(
      receiptRelPath('app'),
      JSON.stringify({ capturedAt: '2026-08-29T00:00:00.000Z', baselineBlob: blob, command: 'c' }),
    );
    commit('chore: capture');
    write(receiptRelPath('app'), 'not json at all');
    commit('chore: corrupt receipt');

    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      lines.push(a.map(String).join(' '));
    });
    try {
      expect(await main([], cwd)).toBe(0);
    } finally {
      spy.mockRestore();
    }
    const out = lines.join('\n');
    expect(out).toContain('app: indeterminate');
    expect(out).toContain('the check could not run');
    expect(out).toMatch(/1 surface\(s\) could not be checked/);
  });
});
