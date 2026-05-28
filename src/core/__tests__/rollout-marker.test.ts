import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRolloutMarker, isPostRollout } from '../rollout-marker';

describe('rollout marker', () => {
  it('returns null when file absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfm-'));
    expect(readRolloutMarker(dir)).toBeNull();
  });
  it('reads SHA from .noldor/rollout-marker', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfm-'));
    mkdirSync(join(dir, '.noldor'));
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), 'abc1234567890\n');
    expect(readRolloutMarker(dir)).toBe('abc1234567890');
  });
  it('isPostRollout returns false when no marker', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfm-'));
    expect(isPostRollout('abc123', dir)).toBe(false);
  });
  it('isPostRollout returns true when commit is after the rollout marker', () => {
    // Set up a minimal git repo with two commits so we can test ancestry
    const dir = mkdtempSync(join(tmpdir(), 'qfm-git-'));
    execSync('git init -q', { cwd: dir });
    execSync('git config user.email test@test.test', { cwd: dir });
    execSync('git config user.name test', { cwd: dir });
    writeFileSync(join(dir, 'a.txt'), 'first');
    execSync('git add a.txt', { cwd: dir });
    execSync('git commit -q -m "first"', { cwd: dir });
    const firstSha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, 'b.txt'), 'second');
    execSync('git add b.txt', { cwd: dir });
    execSync('git commit -q -m "second"', { cwd: dir });
    const secondSha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    // Write first commit SHA as the rollout marker
    mkdirSync(join(dir, '.noldor'));
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), firstSha + '\n');
    // Second commit is after the marker (first is an ancestor of second)
    expect(isPostRollout(secondSha, dir)).toBe(true);
    // First commit itself is not strictly "after" — it IS the marker
    // merge-base --is-ancestor considers A ancestor of A (exit 0), so this is true
    expect(isPostRollout(firstSha, dir)).toBe(true);
  });
  it('isPostRollout returns false when commit predates the rollout marker', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfm-git2-'));
    execSync('git init -q', { cwd: dir });
    execSync('git config user.email test@test.test', { cwd: dir });
    execSync('git config user.name test', { cwd: dir });
    writeFileSync(join(dir, 'a.txt'), 'first');
    execSync('git add a.txt', { cwd: dir });
    execSync('git commit -q -m "first"', { cwd: dir });
    const firstSha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, 'b.txt'), 'second');
    execSync('git add b.txt', { cwd: dir });
    execSync('git commit -q -m "second"', { cwd: dir });
    const secondSha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    // Write second commit SHA as rollout marker; first commit predates it
    mkdirSync(join(dir, '.noldor'));
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), secondSha + '\n');
    expect(isPostRollout(firstSha, dir)).toBe(false);
  });
});
