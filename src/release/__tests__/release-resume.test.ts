// @tests: pnpm-release-resume
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNoInProgressRelease, resumeRelease } from '../index.js';
import { writeReleaseState } from '../release-state.js';

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
