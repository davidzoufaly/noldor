import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditOverrides, auditOverrideTrailers } from '../override-audit.js';

// @tests: noldor

/** Initialise a minimal git repo in a temp dir and return its path. */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'override-audit-'));
  spawnSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], {
    cwd: dir,
    stdio: 'ignore',
  });
  spawnSync('git', ['config', 'user.name', 'Test'], {
    cwd: dir,
    stdio: 'ignore',
  });
  return dir;
}

/** Add a commit with the given message to the repo. */
function addCommit(dir: string, msg: string): string {
  const filePath = join(dir, `${Date.now()}-${Math.random()}.txt`);
  writeFileSync(filePath, msg);
  spawnSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  spawnSync('git', ['commit', '-m', msg], { cwd: dir, stdio: 'ignore' });
  const r = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: dir,
    encoding: 'utf8',
  });
  return r.stdout.trim();
}

/** Add a commit that touches exactly the given paths (relative to repo root). */
function commitTouchingPaths(dir: string, msg: string, paths: string[]): string {
  for (const rel of paths) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `${msg}-${rel}`);
  }
  spawnSync('git', ['add', ...paths], { cwd: dir, stdio: 'ignore' });
  spawnSync('git', ['commit', '-m', msg], { cwd: dir, stdio: 'ignore' });
  const r = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: dir,
    encoding: 'utf8',
  });
  return r.stdout.trim();
}

describe('auditOverrides', () => {
  let repo: string;

  beforeEach(() => {
    repo = makeRepo();
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('returns OK when there are zero overrides', () => {
    addCommit(repo, 'feat(foo): normal commit');
    addCommit(repo, 'fix(bar): another normal commit');

    const result = auditOverrides({ cwd: repo });
    expect(result.severity).toBe('OK');
    expect(result.count).toBe(0);
    expect(result.overrides).toHaveLength(0);
  });

  it('returns INFO when there are overrides but under threshold', () => {
    addCommit(repo, 'feat(foo): commit one');
    addCommit(repo, 'fix(bar): override commit\n\nNoldor-Path-Override: emergency fix needed');
    addCommit(repo, 'chore(baz): another normal');

    const result = auditOverrides({ cwd: repo, threshold: 3 });
    expect(result.severity).toBe('INFO');
    expect(result.count).toBe(1);
    expect(result.overrides).toHaveLength(1);
    expect(result.overrides[0]!.reason).toBe('emergency fix needed');
  });

  it('returns WARN when overrides exceed threshold', () => {
    for (let i = 0; i < 4; i++) {
      addCommit(repo, `fix(bar): override commit ${i}\n\nNoldor-Path-Override: reason ${i}`);
    }

    const result = auditOverrides({ cwd: repo, threshold: 3 });
    expect(result.severity).toBe('WARN');
    expect(result.count).toBe(4);
  });

  it('ignores release-automation commits', () => {
    addCommit(repo, 'chore(release): v1.0.0\n\nNoldor-Path: release-automation');
    // Should not be flagged as override even if someone accidentally added the override trailer
    addCommit(
      repo,
      'chore(release): v1.0.1\n\nNoldor-Path: release-automation\nNoldor-Path-Override: accidental',
    );

    // We exclude release-automation commits; the second one has both trailers
    // but override-audit should skip it
    const result = auditOverrides({ cwd: repo, threshold: 3 });
    expect(result.severity).toBe('OK');
    expect(result.count).toBe(0);
  });

  it('respects daysBack parameter — very distant future cutoff excludes all commits', () => {
    addCommit(repo, 'fix(bar): override\n\nNoldor-Path-Override: reason');

    // Use a negative daysBack to set since=future, so all commits are excluded.
    // We do this by patching: pass threshold=999 and daysBack=-1 which means
    // since = Date.now() + 86400000 (tomorrow). git --since=<future> returns nothing.
    const result = auditOverrides({ cwd: repo, daysBack: -1 });
    expect(result.count).toBe(0);
  });

  it('skips override commits whose only touched file is docs/sdd-report.md', () => {
    // A real override on a code change — keep
    commitTouchingPaths(
      repo,
      'fix(garden): legit override\n\nNoldor-Path-Override: emergency fix',
      ['packages/noldor/src/garden/foo.ts'],
    );
    // A drift-loop commit — skip
    commitTouchingPaths(
      repo,
      'chore(release): sdd-report drift\n\nNoldor-Path-Override: drift-only update',
      ['docs/sdd-report.md'],
    );

    const result = auditOverrides({ cwd: repo, threshold: 3 });
    expect(result.count).toBe(1);
    expect(result.overrides).toHaveLength(1);
    expect(result.overrides[0]!.reason).toBe('emergency fix');
  });

  it('does not skip override commits that touch sdd-report.md alongside other files', () => {
    // Drift-fix that also accidentally touched ideas.md — surface it
    commitTouchingPaths(repo, 'chore(release): sdd-report + tidy\n\nNoldor-Path-Override: mixed', [
      'docs/sdd-report.md',
      'ideas.md',
    ]);

    const result = auditOverrides({ cwd: repo, threshold: 3 });
    expect(result.count).toBe(1);
    expect(result.overrides).toHaveLength(1);
    expect(result.overrides[0]!.reason).toBe('mixed');
  });
});

describe('auditOverrideTrailers — artifact / code / autonomous phases', () => {
  it('counts Noldor-CR-Override-Codex-Artifact under artifact phase', () => {
    const commits = [{ trailers: { 'Noldor-CR-Override-Codex-Artifact': 'reason' } }];
    const r = auditOverrideTrailers(commits);
    expect(r.byPhase.artifact?.codex).toBe(1);
    expect(r.byPhase.code?.codex ?? 0).toBe(0);
    expect(r.total).toBe(1);
  });

  it('counts plain Noldor-CR-Override-Codex under code phase', () => {
    const commits = [{ trailers: { 'Noldor-CR-Override-Codex': 'reason' } }];
    const r = auditOverrideTrailers(commits);
    expect(r.byPhase.code?.codex).toBe(1);
    expect(r.total).toBe(1);
  });

  it('counts Noldor-Autonomous-Override under autonomous phase', () => {
    const commits = [{ trailers: { 'Noldor-Autonomous-Override': 'reason' } }];
    const r = auditOverrideTrailers(commits);
    expect(r.byPhase.autonomous?.autonomous).toBe(1);
    expect(r.total).toBe(1);
  });

  it('counts mixed trailers across multiple commits and lanes', () => {
    const commits: Array<{ trailers: Record<string, string> }> = [
      { trailers: { 'Noldor-CR-Override-Codex-Artifact': 'r1' } },
      { trailers: { 'Noldor-CR-Override-Subagent-Artifact': 'r2' } },
      { trailers: { 'Noldor-CR-Override-Codex': 'r3' } },
      { trailers: { 'Noldor-Autonomous-Override': 'r4' } },
      { trailers: { 'Noldor-CR-Override-Codex': 'r5' } },
    ];
    const r = auditOverrideTrailers(commits);
    expect(r.total).toBe(5);
    expect(r.byPhase.artifact?.codex).toBe(1);
    expect(r.byPhase.artifact?.subagent).toBe(1);
    expect(r.byPhase.code?.codex).toBe(2);
    expect(r.byPhase.autonomous?.autonomous).toBe(1);
  });

  it('ignores trailers that do not match any pattern', () => {
    const commits = [{ trailers: { 'Noldor-FD': 'some-slug', 'Some-Other-Trailer': 'x' } }];
    const r = auditOverrideTrailers(commits);
    expect(r.total).toBe(0);
    expect(r.byPhase).toEqual({});
  });

  it('handles commits with missing/undefined trailers gracefully', () => {
    const commits: Array<{ trailers?: Record<string, string> }> = [{ trailers: {} }, {}];
    const r = auditOverrideTrailers(commits);
    expect(r.total).toBe(0);
  });
});

import { auditReleasePushes } from '../override-audit.js';

describe('auditReleasePushes', () => {
  let cwd: string;
  beforeEach(() => {
    // A real git repo — tree-shape validation cross-checks each receipt SHA
    // against the canonical release-commit signature via `git show`.
    cwd = makeRepo();
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  /** Write `.noldor/release-pushes.log` with the given lines (no trailing-newline fuss). */
  function writeLog(dir: string, lines: string[]): void {
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    writeFileSync(
      join(dir, '.noldor', 'release-pushes.log'),
      lines.map((l) => `${l}\n`).join(''),
      'utf8',
    );
  }

  /** A commit touching both `package.json` and `docs/release-notes.md` — the canonical release shape. */
  function releaseShapedCommit(dir: string, version: string): string {
    return commitTouchingPaths(dir, `chore(release): v${version}`, [
      'package.json',
      'docs/release-notes.md',
    ]);
  }

  it('returns OK when log absent', () => {
    const result = auditReleasePushes({ cwd });
    expect(result.severity).toBe('OK');
    expect(result.count).toBe(0);
  });

  it('returns INFO when entries match release-shaped commits', () => {
    const sha = releaseShapedCommit(cwd, '0.5.0');
    writeLog(cwd, [`2026-05-15T10:00:00Z ${sha} 0.5.0`]);
    const result = auditReleasePushes({ cwd });
    expect(result.severity).toBe('INFO');
    expect(result.count).toBe(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ sha, version: '0.5.0', suspicious: false });
  });

  it('returns WARN and flags the entry when a receipt commit is not release-shaped', () => {
    const sha = commitTouchingPaths(cwd, 'feat(foo): not a release', ['src/foo.ts']);
    writeLog(cwd, [`2026-05-15T10:00:00Z ${sha} 0.5.0`]);
    const result = auditReleasePushes({ cwd });
    expect(result.severity).toBe('WARN');
    expect(result.count).toBe(1);
    expect(result.entries[0]).toMatchObject({ sha, suspicious: true });
  });

  it('returns WARN when a receipt SHA does not resolve to a commit', () => {
    writeLog(cwd, ['2026-05-15T10:00:00Z deadbeefdeadbeef 0.5.0']);
    const result = auditReleasePushes({ cwd });
    expect(result.severity).toBe('WARN');
    expect(result.entries[0]).toMatchObject({ suspicious: true });
  });

  it('flags only the suspicious entry in a mixed log', () => {
    const good = releaseShapedCommit(cwd, '0.5.0');
    const bad = commitTouchingPaths(cwd, 'feat(bar): not a release', ['src/bar.ts']);
    writeLog(cwd, [`2026-05-15T10:00:00Z ${good} 0.5.0`, `2026-05-16T11:00:00Z ${bad} 0.5.1`]);
    const result = auditReleasePushes({ cwd });
    expect(result.severity).toBe('WARN');
    expect(result.count).toBe(2);
    const byVersion = Object.fromEntries(result.entries.map((e) => [e.version, e.suspicious]));
    expect(byVersion['0.5.0']).toBe(false);
    expect(byVersion['0.5.1']).toBe(true);
  });

  it('returns WARN when log has malformed line', () => {
    writeLog(cwd, ['this-is-not-a-valid-line']);
    const result = auditReleasePushes({ cwd });
    expect(result.severity).toBe('WARN');
  });
});
