// @tests: registry-distribution-for-the-noldor-package
import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BIN = resolve(__dirname, '../../../bin/noldor.mjs');

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/**
 * Minimal clean-main scratch repo with a bare file `origin` —
 * ensureCleanTreeOnMain fetches origin, so --local's guards need one.
 */
function seedRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'release-publish-cli-'));
  git(cwd, ['init', '-q', '-b', 'main']);
  git(cwd, ['config', 'user.email', 'test@example.com']);
  git(cwd, ['config', 'user.name', 'Test User']);
  writeFileSync(
    join(cwd, 'package.json'),
    `${JSON.stringify({ name: 'testpkg', version: '0.4.1' }, null, 2)}\n`,
  );
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-q', '-m', 'seed']);
  const bare = mkdtempSync(join(tmpdir(), 'release-publish-cli-origin-'));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: bare });
  git(cwd, ['remote', 'add', 'origin', bare]);
  git(cwd, ['push', '-q', 'origin', 'main']);
  return cwd;
}

function runPublish(cwd: string, args: string[]): { status: number | null; stderr: string } {
  const r = spawnSync('node', [BIN, 'release', 'publish', ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr };
}

describe('noldor release publish — guard rails', () => {
  it('--local refuses on a dirty tree', () => {
    const cwd = seedRepo();
    writeFileSync(join(cwd, 'stray.txt'), 'dirty\n');
    const r = runPublish(cwd, ['--local']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('not clean');
  });

  it('--local refuses when HEAD is not tagged v<version>', () => {
    const cwd = seedRepo();
    const r = runPublish(cwd, ['--local']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('not tagged v0.4.1');
  });

  it('--wait without a version prints usage and exits non-zero', () => {
    const cwd = seedRepo();
    const r = runPublish(cwd, ['--wait']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('usage: noldor release publish');
  });
});
