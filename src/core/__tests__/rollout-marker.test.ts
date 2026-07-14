// @tests: noldor, state-file-fail-open-hardening
import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readRolloutMarker,
  rolloutMarkerExists,
  isPostRollout,
  ensureRolloutMarker,
} from '../rollout-marker';

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

  it('isPostRollout fails CLOSED (enforce) on a present-but-corrupt marker', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfm-corrupt-'));
    execSync('git init -q', { cwd: dir });
    execSync('git config user.email test@test.test', { cwd: dir });
    execSync('git config user.name test', { cwd: dir });
    writeFileSync(join(dir, 'a.txt'), 'first');
    execSync('git add a.txt', { cwd: dir });
    execSync('git commit -q -m "first"', { cwd: dir });
    const head = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    // A garbage marker git cannot resolve → `merge-base --is-ancestor` exits 128.
    // Must NOT drop to soft mode (the old `status === 0` returned false = fail-open).
    mkdirSync(join(dir, '.noldor'));
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), 'deadbeefnotacommit\n');
    expect(isPostRollout(head, dir)).toBe(true);
  });

  it('isPostRollout enforces (true) on a present-but-EMPTY marker (torn write, zero bytes)', () => {
    // A whitespace/zero-byte marker collapses to null in readRolloutMarker, same
    // as absent — but it is a torn write, not a fresh repo, so it must enforce.
    const dir = mkdtempSync(join(tmpdir(), 'qfm-empty-'));
    mkdirSync(join(dir, '.noldor'));
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), '   \n');
    expect(isPostRollout('abc123', dir)).toBe(true);
  });

  it('rolloutMarkerExists: true for a present (even empty) file, false only when absent', () => {
    const absent = mkdtempSync(join(tmpdir(), 'qfm-absent-'));
    expect(rolloutMarkerExists(absent)).toBe(false);
    const present = mkdtempSync(join(tmpdir(), 'qfm-present-'));
    mkdirSync(join(present, '.noldor'));
    writeFileSync(join(present, '.noldor', 'rollout-marker'), '');
    expect(rolloutMarkerExists(present)).toBe(true);
  });

  describe('ensureRolloutMarker', () => {
    it('writes HEAD as the marker in a git repo without one', () => {
      const dir = mkdtempSync(join(tmpdir(), 'qfm-ensure-'));
      execSync('git init -q', { cwd: dir });
      execSync('git config user.email test@test.test', { cwd: dir });
      execSync('git config user.name test', { cwd: dir });
      writeFileSync(join(dir, 'a.txt'), 'first');
      execSync('git add a.txt', { cwd: dir });
      execSync('git commit -q -m "first"', { cwd: dir });
      const head = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();

      expect(ensureRolloutMarker(dir)).toBe('created');
      expect(readRolloutMarker(dir)).toBe(head);
      // HEAD itself is at-or-after the marker → enforcement arms immediately
      expect(isPostRollout(head, dir)).toBe(true);
    });

    it('no-ops when a marker already exists', () => {
      const dir = mkdtempSync(join(tmpdir(), 'qfm-ensure2-'));
      mkdirSync(join(dir, '.noldor'));
      writeFileSync(join(dir, '.noldor', 'rollout-marker'), 'existing\n');
      expect(ensureRolloutMarker(dir)).toBe('exists');
      expect(readRolloutMarker(dir)).toBe('existing');
    });

    it('skips outside a git repo (soft mode stays)', () => {
      const dir = mkdtempSync(join(tmpdir(), 'qfm-ensure3-'));
      expect(ensureRolloutMarker(dir)).toBe('skipped-no-git');
      expect(readRolloutMarker(dir)).toBeNull();
    });

    it('skips in a git repo with no commits yet', () => {
      const dir = mkdtempSync(join(tmpdir(), 'qfm-ensure4-'));
      execSync('git init -q', { cwd: dir });
      expect(ensureRolloutMarker(dir)).toBe('skipped-no-git');
      expect(readRolloutMarker(dir)).toBeNull();
    });
  });
});
