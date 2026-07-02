// @tests: release-sweep-process-hardening
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enforceReviewReceipt } from '../noldor-enforce-review-receipt';

/**
 * Create a repo with an initial commit and a second commit carrying the given trailers.
 * Sets rollout-marker to the initial commit so the second commit is post-rollout.
 */
function repoWithPostRolloutCommit(trailers: string): {
  dir: string;
  tree: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'qfrr-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t.t', { cwd: dir });
  execSync('git config user.name t', { cwd: dir });
  mkdirSync(join(dir, '.noldor'));
  // Initial commit (becomes the rollout marker)
  writeFileSync(join(dir, 'a'), 'x');
  execSync('git add a', { cwd: dir });
  execSync('git commit -q -m "init"', { cwd: dir });
  const initSha = execSync('git rev-parse HEAD', {
    cwd: dir,
    encoding: 'utf8',
  }).trim();
  writeFileSync(join(dir, '.noldor', 'rollout-marker'), initSha + '\n');
  // Post-rollout commit with the desired message (trailers in last paragraph)
  writeFileSync(join(dir, 'b'), 'y');
  execSync('git add b', { cwd: dir });
  // Write commit message to a temp file to avoid shell quoting issues
  const msgFile = join(dir, 'CMSG');
  writeFileSync(msgFile, `fix: x\n\n${trailers}`);
  execSync(`git commit -q -F "${msgFile}"`, { cwd: dir });
  const tree = execSync('git rev-parse HEAD^{tree}', {
    cwd: dir,
    encoding: 'utf8',
  }).trim();
  return { dir, tree };
}

describe('enforceReviewReceipt', () => {
  it('soft mode: passes when no rollout marker', () => {
    // Repo with no .noldor/rollout-marker — soft mode
    const dir = mkdtempSync(join(tmpdir(), 'qfrr-'));
    execSync('git init -q', { cwd: dir });
    execSync('git config user.email t@t.t', { cwd: dir });
    execSync('git config user.name t', { cwd: dir });
    mkdirSync(join(dir, '.noldor'));
    writeFileSync(join(dir, 'a'), 'x');
    execSync('git add a', { cwd: dir });
    execSync('git commit -q -m "fix: x\n\nNoldor-Path: fast-track"', {
      cwd: dir,
    });
    expect(enforceReviewReceipt({ cwd: dir }).ok).toBe(true);
  });

  it('passes when trailer tree-hash matches HEAD^{tree}', () => {
    // First create the commit, get its tree, then amend with correct hash
    const dir = mkdtempSync(join(tmpdir(), 'qfrr-'));
    execSync('git init -q', { cwd: dir });
    execSync('git config user.email t@t.t', { cwd: dir });
    execSync('git config user.name t', { cwd: dir });
    mkdirSync(join(dir, '.noldor'));
    writeFileSync(join(dir, 'a'), 'x');
    execSync('git add a', { cwd: dir });
    execSync('git commit -q -m "init"', { cwd: dir });
    const initSha = execSync('git rev-parse HEAD', {
      cwd: dir,
      encoding: 'utf8',
    }).trim();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), initSha + '\n');
    // Create the post-rollout commit
    writeFileSync(join(dir, 'b'), 'y');
    execSync('git add b', { cwd: dir });
    execSync('git commit -q -m "fix: placeholder"', { cwd: dir });
    const tree = execSync('git rev-parse HEAD^{tree}', {
      cwd: dir,
      encoding: 'utf8',
    }).trim();
    // Amend with correct tree hash in trailers
    const msgFile = join(dir, 'CMSG');
    writeFileSync(msgFile, `fix: reviewed\n\nNoldor-Path: fast-track\nNoldor-Reviewed: ${tree}`);
    execSync(`git commit --amend -q -F "${msgFile}"`, { cwd: dir });
    expect(enforceReviewReceipt({ cwd: dir }).ok).toBe(true);
  });

  it('fails when trailer tree-hash does not match', () => {
    const { dir } = repoWithPostRolloutCommit(
      'Noldor-Path: fast-track\nNoldor-Reviewed: 0000000000000000000000000000000000000000\n',
    );
    expect(enforceReviewReceipt({ cwd: dir }).ok).toBe(false);
  });

  it('passes for micro-chore (no review required)', () => {
    const { dir } = repoWithPostRolloutCommit('Noldor-Path: micro-chore\n');
    expect(enforceReviewReceipt({ cwd: dir }).ok).toBe(true);
  });

  it('passes for release-automation', () => {
    const { dir } = repoWithPostRolloutCommit('Noldor-Path: release-automation\n');
    expect(enforceReviewReceipt({ cwd: dir }).ok).toBe(true);
  });

  it('fails when path requires review but Noldor-Reviewed trailer absent', () => {
    const { dir } = repoWithPostRolloutCommit('Noldor-Path: fast-track\n');
    expect(enforceReviewReceipt({ cwd: dir }).ok).toBe(false);
  });

  it('passes when Noldor-Path-Override is present (escape hatch wins over Path)', () => {
    const { dir } = repoWithPostRolloutCommit(
      'Noldor-Path: fast-track\nNoldor-Path-Override: release-sweep blocker\n',
    );
    expect(enforceReviewReceipt({ cwd: dir }).ok).toBe(true);
  });

  it('passes when Noldor-Reviewed-Subagent trailer matches HEAD tree (multi-reviewer gate)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfrr-'));
    execSync('git init -q', { cwd: dir });
    execSync('git config user.email t@t.t', { cwd: dir });
    execSync('git config user.name t', { cwd: dir });
    mkdirSync(join(dir, '.noldor'));
    writeFileSync(join(dir, 'a'), 'x');
    execSync('git add a', { cwd: dir });
    execSync('git commit -q -m "init"', { cwd: dir });
    const initSha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), initSha + '\n');
    writeFileSync(join(dir, 'b'), 'y');
    execSync('git add b', { cwd: dir });
    execSync('git commit -q -m "fix: placeholder"', { cwd: dir });
    const tree = execSync('git rev-parse HEAD^{tree}', { cwd: dir, encoding: 'utf8' }).trim();
    const msgFile = join(dir, 'CMSG');
    writeFileSync(
      msgFile,
      `fix: reviewed\n\nNoldor-Path: fast-track\nNoldor-Reviewed-Subagent: ${tree}`,
    );
    execSync(`git commit --amend -q -F "${msgFile}"`, { cwd: dir });
    expect(enforceReviewReceipt({ cwd: dir }).ok).toBe(true);
  });

  it('fails when Noldor-Reviewed-Subagent tree-hash does not match', () => {
    const { dir } = repoWithPostRolloutCommit(
      'Noldor-Path: fast-track\nNoldor-Reviewed-Subagent: 0000000000000000000000000000000000000000\n',
    );
    expect(enforceReviewReceipt({ cwd: dir }).ok).toBe(false);
  });
});
