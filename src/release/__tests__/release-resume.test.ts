// @tests: pnpm-release-resume
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNoInProgressRelease, resumeRelease } from '../index.js';
import { readReleaseState, writeReleaseState } from '../release-state.js';

const STATE = {
  version: '0.4.1',
  previousTag: 'v0.4.0',
  date: '2026-07-02',
  startedAt: '2026-07-02T10:00:00.000Z',
};

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

/**
 * Scratch repo shaped like a consumer mid-release: the full release surface
 * exists and is committed clean; package.json already carries the bumped
 * version (the interruption happened AFTER the mutation phase). `.gitignore`
 * hides the state file and the fake-gh scaffolding from the shape check,
 * exactly as the real repo gitignores `.noldor/`.
 */
function seedReleaseRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'release-resume-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd });
  git(cwd, ['config', 'user.email', 'test@example.com']);
  git(cwd, ['config', 'user.name', 'Test User']);
  writeFileSync(join(cwd, '.gitignore'), '.noldor/\nfake-bin/\ngh-log.txt\ngh-release-created\n');
  writeFileSync(
    join(cwd, 'package.json'),
    `${JSON.stringify({ name: 'testpkg', version: '0.4.1' }, null, 2)}\n`,
  );
  writeFileSync(join(cwd, 'CHANGELOG.md'), '# Changelog\n');
  mkdirSync(join(cwd, 'docs/features'), { recursive: true });
  mkdirSync(join(cwd, 'docs/noldor'), { recursive: true });
  writeFileSync(join(cwd, 'docs/release-notes.md'), '## v0.4.1 — 2026-07-02\n\n- resume ladder\n');
  writeFileSync(join(cwd, 'docs/sdd-report.md'), '# SDD report\n');
  writeFileSync(join(cwd, 'docs/features/foo.md'), 'introduced: TBD\n');
  writeFileSync(join(cwd, 'docs/noldor/bar.md'), 'noldor page\n');
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-q', '-m', 'seed']);
  return cwd;
}

const RESUME_OPTS = { lockstepPackages: ['package.json'], name: 'testpkg' };

/** Bare file remote wired up as `origin`, primed with the current main. */
function addBareOrigin(cwd: string): string {
  const bare = mkdtempSync(join(tmpdir(), 'release-resume-origin-'));
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: bare });
  git(cwd, ['remote', 'add', 'origin', bare]);
  git(cwd, ['push', '-q', 'origin', 'main']);
  return bare;
}

/**
 * PATH-stubbed `gh` that records every invocation to a log file. `release
 * view` fails until a `release create` has run (marker file), mirroring the
 * real API surface, so the view-then-create rung behaves realistically.
 */
function fakeGh(
  cwd: string,
  opts: { releaseExists: boolean },
): { env: { PATH: string }; logFile: string } {
  const binDir = join(cwd, 'fake-bin');
  mkdirSync(binDir, { recursive: true });
  const logFile = join(cwd, 'gh-log.txt');
  const marker = join(cwd, 'gh-release-created');
  if (opts.releaseExists) writeFileSync(marker, '');
  const script = [
    '#!/bin/sh',
    `echo "$@" >> ${logFile}`,
    'if [ "$1" = "release" ] && [ "$2" = "view" ]; then',
    `  [ -f ${marker} ] && exit 0`,
    '  exit 1',
    'fi',
    `if [ "$1" = "release" ] && [ "$2" = "create" ]; then touch ${marker}; fi`,
    'exit 0',
    '',
  ].join('\n');
  writeFileSync(join(binDir, 'gh'), script);
  chmodSync(join(binDir, 'gh'), 0o755);
  return { env: { PATH: `${binDir}:${process.env.PATH ?? ''}` }, logFile };
}

/**
 * PATH-stubbed `npm` for the publish rung, sharing fakeGh's fake-bin dir (call
 * fakeGh first — its env.PATH already covers this shim). `visible: true` →
 * every `npm view` exits 0 (version on registry); `visible: false` → always
 * exits 1, so the rung's awaitPublish must time out. The log lives inside the
 * gitignored fake-bin/ so a re-run's shape check never sees it as dirty.
 */
function fakeNpm(cwd: string, opts: { visible: boolean }): { logFile: string } {
  const binDir = join(cwd, 'fake-bin');
  mkdirSync(binDir, { recursive: true });
  const logFile = join(binDir, 'npm-log.txt');
  const script = [
    '#!/bin/sh',
    `echo "$@" >> ${logFile}`,
    opts.visible ? 'exit 0' : 'exit 1',
    '',
  ].join('\n');
  writeFileSync(join(binDir, 'npm'), script);
  chmodSync(join(binDir, 'npm'), 0o755);
  return { logFile };
}

/** Opt the scratch repo into the publish rung (`.noldor/` is gitignored). */
function enablePublish(cwd: string): void {
  mkdirSync(join(cwd, '.noldor'), { recursive: true });
  writeFileSync(
    join(cwd, '.noldor', 'config.json'),
    JSON.stringify({ release: { publish: { enabled: true } } }, null, 2),
  );
}

describe('assertNoInProgressRelease', () => {
  it('passes silently when no release state exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-resume-'));
    expect(() => assertNoInProgressRelease(dir)).not.toThrow();
  });

  it('aborts naming --resume and the discard recipe when a release is in progress', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-resume-'));
    writeReleaseState(dir, STATE);
    const call = (): void => assertNoInProgressRelease(dir);
    expect(call).toThrow(/In-progress release v0\.4\.1/);
    expect(call).toThrow(/pnpm release --resume/);
    expect(call).toThrow(/git reset --hard && rm \.noldor\/release-state\.json/);
  });
});

describe('resumeRelease — verification rungs', () => {
  it('aborts when there is no state file', async () => {
    const cwd = seedReleaseRepo();
    await expect(resumeRelease(cwd, RESUME_OPTS)).rejects.toThrow(/Nothing to resume/);
  });

  it('aborts off the main branch', async () => {
    const cwd = seedReleaseRepo();
    git(cwd, ['checkout', '-q', '-b', 'feature']);
    writeReleaseState(cwd, STATE);
    await expect(resumeRelease(cwd, RESUME_OPTS)).rejects.toThrow(/currently on feature/);
  });

  it('aborts when package.json no longer matches the state version', async () => {
    const cwd = seedReleaseRepo();
    writeReleaseState(cwd, { ...STATE, version: '9.9.9' });
    await expect(resumeRelease(cwd, RESUME_OPTS)).rejects.toThrow(/Version mismatch/);
  });

  it('aborts when dirty paths fall outside the release surface', async () => {
    const cwd = seedReleaseRepo();
    appendFileSync(join(cwd, 'CHANGELOG.md'), '\n## v0.4.1\n');
    writeFileSync(join(cwd, 'src-stray.ts'), 'export {};\n');
    writeReleaseState(cwd, STATE);
    await expect(resumeRelease(cwd, RESUME_OPTS)).rejects.toThrow(
      /outside the release surface: src-stray\.ts/,
    );
  });
});

describe('resumeRelease — commit + tag rungs', () => {
  it('commits the dirty release surface and tags it', async () => {
    const cwd = seedReleaseRepo();
    addBareOrigin(cwd);
    const { env } = fakeGh(cwd, { releaseExists: true });
    appendFileSync(join(cwd, 'CHANGELOG.md'), '\n## v0.4.1\n');
    appendFileSync(join(cwd, 'docs/features/foo.md'), 'introduced: v0.4.1\n');
    writeReleaseState(cwd, STATE);
    await resumeRelease(cwd, { ...RESUME_OPTS, env });
    expect(git(cwd, ['log', '-1', '--format=%s']).trim()).toBe('chore(release): v0.4.1');
    expect(git(cwd, ['status', '--porcelain']).trim()).toBe('');
    expect(git(cwd, ['tag', '--list', 'v0.4.1']).trim()).toBe('v0.4.1');
  });

  it('skips the commit rung when HEAD already carries the release subject', async () => {
    const cwd = seedReleaseRepo();
    appendFileSync(join(cwd, 'CHANGELOG.md'), '\n## v0.4.1\n');
    git(cwd, ['add', '.']);
    git(cwd, ['commit', '-q', '-m', 'chore(release): v0.4.1']);
    addBareOrigin(cwd);
    const { env } = fakeGh(cwd, { releaseExists: true });
    writeReleaseState(cwd, STATE);
    const before = git(cwd, ['rev-list', '--count', 'HEAD']).trim();
    await resumeRelease(cwd, { ...RESUME_OPTS, env });
    expect(git(cwd, ['rev-list', '--count', 'HEAD']).trim()).toBe(before);
    expect(git(cwd, ['tag', '--list', 'v0.4.1']).trim()).toBe('v0.4.1');
  });

  it('skips the tag rung when the tag already exists', async () => {
    const cwd = seedReleaseRepo();
    git(cwd, ['tag', '-a', 'v0.4.1', '-m', 'v0.4.1']);
    const tagTarget = git(cwd, ['rev-parse', 'v0.4.1^{}']).trim();
    addBareOrigin(cwd);
    const { env } = fakeGh(cwd, { releaseExists: true });
    appendFileSync(join(cwd, 'CHANGELOG.md'), '\n## v0.4.1\n');
    writeReleaseState(cwd, STATE);
    await resumeRelease(cwd, { ...RESUME_OPTS, env });
    expect(git(cwd, ['log', '-1', '--format=%s']).trim()).toBe('chore(release): v0.4.1');
    // Pre-existing tag untouched — still points at the seed commit.
    expect(git(cwd, ['rev-parse', 'v0.4.1^{}']).trim()).toBe(tagTarget);
  });
});

describe('resumeRelease — push + gh-release rungs', () => {
  it('pushes, creates the GitHub Release, and clears the state file', async () => {
    const cwd = seedReleaseRepo();
    addBareOrigin(cwd);
    const { env, logFile } = fakeGh(cwd, { releaseExists: false });
    appendFileSync(join(cwd, 'CHANGELOG.md'), '\n## v0.4.1\n');
    writeReleaseState(cwd, STATE);
    await resumeRelease(cwd, { ...RESUME_OPTS, env });
    const head = git(cwd, ['rev-parse', 'HEAD']).trim();
    expect(git(cwd, ['rev-parse', 'origin/main']).trim()).toBe(head);
    const ghLog = readFileSync(logFile, 'utf8');
    expect(ghLog).toContain('release view v0.4.1');
    expect(ghLog).toContain(
      'release create v0.4.1 --notes-file /tmp/testpkg-release-notes-v0.4.1.md --latest --title v0.4.1',
    );
    expect(readReleaseState(cwd)).toBeNull();
  });

  it('re-running over a re-armed state file skips every rung (idempotent ladder)', async () => {
    // Models `--resume` after a resume that died before clearing state (the
    // spec's "twice in a row" acceptance case): the second walk must be a
    // pure no-op — no second commit, no re-tag, no re-push, no second create.
    const cwd = seedReleaseRepo();
    addBareOrigin(cwd);
    const { env, logFile } = fakeGh(cwd, { releaseExists: false });
    appendFileSync(join(cwd, 'CHANGELOG.md'), '\n## v0.4.1\n');
    writeReleaseState(cwd, STATE);
    await resumeRelease(cwd, { ...RESUME_OPTS, env });
    const head = git(cwd, ['rev-parse', 'HEAD']).trim();
    writeReleaseState(cwd, STATE);
    await resumeRelease(cwd, { ...RESUME_OPTS, env });
    expect(git(cwd, ['rev-parse', 'HEAD']).trim()).toBe(head);
    const creates = readFileSync(logFile, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('release create'));
    expect(creates).toHaveLength(1);
    expect(readReleaseState(cwd)).toBeNull();
  });

  it('skips the gh rung when the release already exists', async () => {
    const cwd = seedReleaseRepo();
    addBareOrigin(cwd);
    const { env, logFile } = fakeGh(cwd, { releaseExists: true });
    appendFileSync(join(cwd, 'CHANGELOG.md'), '\n## v0.4.1\n');
    writeReleaseState(cwd, STATE);
    await resumeRelease(cwd, { ...RESUME_OPTS, env });
    expect(readFileSync(logFile, 'utf8')).not.toContain('release create');
    expect(readReleaseState(cwd)).toBeNull();
  });
});

describe('resumeRelease — publish rung (rung 7)', () => {
  it('never invokes npm when release.publish is not enabled', async () => {
    const cwd = seedReleaseRepo();
    addBareOrigin(cwd);
    const { env } = fakeGh(cwd, { releaseExists: true });
    const { logFile } = fakeNpm(cwd, { visible: true });
    appendFileSync(join(cwd, 'CHANGELOG.md'), '\n## v0.4.1\n');
    writeReleaseState(cwd, STATE);
    await resumeRelease(cwd, { ...RESUME_OPTS, env });
    expect(existsSync(logFile)).toBe(false);
    expect(readReleaseState(cwd)).toBeNull();
  });

  it('skips rung 7 when the version is already on the registry, then clears state', async () => {
    const cwd = seedReleaseRepo();
    enablePublish(cwd);
    addBareOrigin(cwd);
    const { env } = fakeGh(cwd, { releaseExists: true });
    const { logFile } = fakeNpm(cwd, { visible: true });
    appendFileSync(join(cwd, 'CHANGELOG.md'), '\n## v0.4.1\n');
    writeReleaseState(cwd, STATE);
    await resumeRelease(cwd, { ...RESUME_OPTS, env });
    expect(readFileSync(logFile, 'utf8')).toContain('view testpkg@0.4.1 version --json');
    expect(readReleaseState(cwd)).toBeNull();
  });

  it('leaves the state file behind when the version never becomes visible', async () => {
    const cwd = seedReleaseRepo();
    enablePublish(cwd);
    addBareOrigin(cwd);
    const { env } = fakeGh(cwd, { releaseExists: true });
    fakeNpm(cwd, { visible: false });
    appendFileSync(join(cwd, 'CHANGELOG.md'), '\n## v0.4.1\n');
    writeReleaseState(cwd, STATE);
    const opts = {
      ...RESUME_OPTS,
      env: { ...env, NOLDOR_PUBLISH_TIMEOUT_MS: '60', NOLDOR_PUBLISH_POLL_MS: '20' },
    };
    await expect(resumeRelease(cwd, opts)).rejects.toThrow(/publish\.yml/);
    expect(readReleaseState(cwd)).not.toBeNull();
  });
});
