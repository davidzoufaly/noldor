import { describe, expect, it } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPreEditGuard, filePathFromPayload } from '../noldor-pre-edit-guard';

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qfpeg-'));
  mkdirSync(join(dir, '.noldor'));
  return dir;
}

/** Real git repo with one tracked file and an armed rollout marker. */
function setupGitRepo(): string {
  // realpath: macOS tmpdir is a /var → /private/var symlink and git reports
  // the resolved toplevel, so anchor the fixture on the resolved path.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'qfpeg-git-')));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email test@test.test', { cwd: dir });
  execSync('git config user.name test', { cwd: dir });
  writeFileSync(join(dir, 'tracked.ts'), 'export const x = 1;\n');
  execSync('git add tracked.ts', { cwd: dir });
  execSync('git commit -q -m "init"', { cwd: dir });
  mkdirSync(join(dir, '.noldor'));
  writeFileSync(join(dir, '.noldor', 'rollout-marker'), 'abc123\n');
  return dir;
}

describe('noldor pre-edit guard', () => {
  it('passes in soft mode when no rollout marker exists', () => {
    const dir = setupRepo();
    expect(runPreEditGuard({ cwd: dir, filePath: 'packages/web/src/foo.ts' }).ok).toBe(true);
  });

  it('passes post-rollout when a /gate session exists', () => {
    const dir = setupRepo();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), 'abc123\n');
    writeFileSync(
      join(dir, '.noldor', 'session.json'),
      JSON.stringify({ path: 'micro-chore', startedAt: 'x' }),
    );
    expect(runPreEditGuard({ cwd: dir, filePath: 'README.md' }).ok).toBe(true);
  });

  it('fails post-rollout without a session even for allowlisted files', () => {
    const dir = setupRepo();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), 'abc123\n');
    const r = runPreEditGuard({ cwd: dir, filePath: 'README.md' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/\/gate/);
  });

  it('blocks an absolute-path edit to a tracked file without a session', () => {
    const dir = setupGitRepo();
    const r = runPreEditGuard({ cwd: '/', filePath: join(dir, 'tracked.ts') });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/\/gate/);
  });

  it('resolves the session from the file repo, not the process cwd', () => {
    const dir = setupGitRepo();
    writeFileSync(
      join(dir, '.noldor', 'session.json'),
      JSON.stringify({ path: 'fast-track', startedAt: 'x' }),
    );
    // cwd points elsewhere entirely — the worktree case
    const r = runPreEditGuard({ cwd: tmpdir(), filePath: join(dir, 'tracked.ts') });
    expect(r.ok).toBe(true);
  });

  it('allows untracked files inside an armed repo (new-file scaffolding)', () => {
    const dir = setupGitRepo();
    expect(runPreEditGuard({ cwd: '/', filePath: join(dir, 'brand-new.ts') }).ok).toBe(true);
  });

  it('allows absolute paths outside any git repo (scratch, memory)', () => {
    const outside = mkdtempSync(join(tmpdir(), 'qfpeg-outside-'));
    writeFileSync(join(outside, 'note.md'), 'scratch\n');
    expect(runPreEditGuard({ cwd: '/', filePath: join(outside, 'note.md') }).ok).toBe(true);
  });
});

describe('filePathFromPayload', () => {
  it('prefers file_path, falls back to notebook_path then path', () => {
    expect(filePathFromPayload({ tool_input: { file_path: '/a' } })).toBe('/a');
    expect(filePathFromPayload({ tool_input: { notebook_path: '/b' } })).toBe('/b');
    expect(filePathFromPayload({ tool_input: { path: '/c' } })).toBe('/c');
    expect(filePathFromPayload({})).toBeUndefined();
  });
});

describe('PreToolUse stdin entrypoint (spawn-level)', () => {
  const ENTRY = join(process.cwd(), 'src/hooks/noldor-pre-edit-guard.ts');
  const TSX = join(process.cwd(), 'node_modules/.bin/tsx');

  function runHook(stdin: string): { status: number | null; stderr: string } {
    const r = spawnSync(TSX, [ENTRY], { input: stdin, encoding: 'utf8' });
    return { status: r.status, stderr: r.stderr };
  }

  it('exits 2 with a /gate message for a tracked file without a session', () => {
    const dir = setupGitRepo();
    const payload = JSON.stringify({
      cwd: dir,
      tool_input: { file_path: join(dir, 'tracked.ts') },
    });
    const r = runHook(payload);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/\/gate/);
  });

  it('exits 0 for an untracked file', () => {
    const dir = setupGitRepo();
    const payload = JSON.stringify({
      cwd: dir,
      tool_input: { file_path: join(dir, 'brand-new.ts') },
    });
    expect(runHook(payload).status).toBe(0);
  });

  it('exits 0 (fail-open) on malformed payload', () => {
    expect(runHook('not json at all').status).toBe(0);
  });
});
