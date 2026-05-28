import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectAllowlistDrift } from '../allowlist-drift.js';

// @tests: noldor

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'allowlist-drift-'));
  spawnSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

function addCommit(dir: string, msg: string, files: Record<string, string> = {}): string {
  // Create each file in the working tree
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(dir, relPath);
    // Ensure parent dirs exist (simple single-level support)
    const parts = relPath.split('/');
    if (parts.length > 1) {
      mkdirSync(join(dir, parts.slice(0, -1).join('/')), { recursive: true });
    }
    writeFileSync(fullPath, content);
  }
  if (Object.keys(files).length === 0) {
    // Need at least one file change
    writeFileSync(join(dir, `${Date.now()}.txt`), msg);
  }
  spawnSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  spawnSync('git', ['commit', '-m', msg], { cwd: dir, stdio: 'ignore' });
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' });
  return r.stdout.trim();
}

describe('detectAllowlistDrift', () => {
  let repo: string;

  beforeEach(() => {
    repo = makeRepo();
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('returns no findings when there are no micro-chore commits', async () => {
    addCommit(repo, 'feat(foo): normal commit', { 'some-code.ts': 'export const x = 1;' });

    const findings = await detectAllowlistDrift({ cwd: repo });
    expect(findings).toHaveLength(0);
  });

  it('returns no findings for micro-chore commit with only allowlisted files', async () => {
    addCommit(repo, 'docs(garden): update doc\n\nNoldor-Path: micro-chore', {
      'docs/notes.md': '# Notes\n',
    });

    const findings = await detectAllowlistDrift({ cwd: repo });
    expect(findings).toHaveLength(0);
  });

  it('flags micro-chore commit that contains non-allowlisted files', async () => {
    addCommit(repo, 'chore(garden): micro-chore with code\n\nNoldor-Path: micro-chore', {
      'src/index.ts': 'export const x = 1;',
    });

    const findings = await detectAllowlistDrift({ cwd: repo });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.reason).toBe('non-allowlisted-files');
    expect(findings[0]!.offendingFiles.length).toBeGreaterThan(0);
  });

  it('flags micro-chore commit with mix of allowed and non-allowed files', async () => {
    addCommit(repo, 'chore: mixed micro-chore\n\nNoldor-Path: micro-chore', {
      'docs/something.md': '# doc\n',
      'src/bad-code.ts': 'const x = 1;',
    });

    const findings = await detectAllowlistDrift({ cwd: repo });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.offendingFiles).toContain('src/bad-code.ts');
  });

  it('ignores commits that have Noldor-Path but not micro-chore', async () => {
    addCommit(repo, 'feat(foo): fast-track commit\n\nNoldor-Path: fast-track', {
      'src/index.ts': 'export const x = 1;',
    });

    const findings = await detectAllowlistDrift({ cwd: repo });
    expect(findings).toHaveLength(0);
  });

  it('ignores bad micro-chore commits reachable only from another branch', async () => {
    const marker = addCommit(repo, 'chore: rollout marker', { 'README.md': '# Readme\n' });
    mkdirSync(join(repo, '.noldor'), { recursive: true });
    writeFileSync(join(repo, '.noldor', 'rollout-marker'), `${marker}\n`);
    addCommit(repo, 'feat(main): normal post-rollout commit', {
      'src/main.ts': 'export const main = true;\n',
    });

    spawnSync('git', ['checkout', '-b', 'side', marker], { cwd: repo, stdio: 'ignore' });
    addCommit(repo, 'chore: bad micro-chore\n\nNoldor-Path: micro-chore', {
      'src/bad-side.ts': 'export const bad = true;\n',
    });
    spawnSync('git', ['checkout', 'main'], { cwd: repo, stdio: 'ignore' });

    const findings = await detectAllowlistDrift({ cwd: repo });
    expect(findings).toHaveLength(0);
  });
});
