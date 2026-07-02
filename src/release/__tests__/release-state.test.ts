// @tests: pnpm-release-resume
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearReleaseState, readReleaseState, writeReleaseState } from '../release-state.js';

const STATE = {
  version: '0.4.1',
  previousTag: 'v0.4.0',
  date: '2026-07-02',
  startedAt: '2026-07-02T10:00:00.000Z',
};

describe('release state persistence', () => {
  it('round-trips write → read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-state-'));
    writeReleaseState(dir, STATE);
    expect(readReleaseState(dir)).toEqual(STATE);
  });

  it('returns null when the state file is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-state-'));
    expect(readReleaseState(dir)).toBeNull();
  });

  it('creates .noldor/ when missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-state-'));
    writeReleaseState(dir, STATE);
    expect(existsSync(join(dir, '.noldor', 'release-state.json'))).toBe(true);
  });

  it('rejects a state file missing required fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-state-'));
    mkdirSync(join(dir, '.noldor'));
    writeFileSync(
      join(dir, '.noldor', 'release-state.json'),
      JSON.stringify({ version: '0.4.1' }),
      'utf8',
    );
    expect(() => readReleaseState(dir)).toThrow();
  });

  it('clear removes the file and tolerates absence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-state-'));
    writeReleaseState(dir, STATE);
    clearReleaseState(dir);
    expect(readReleaseState(dir)).toBeNull();
    expect(() => clearReleaseState(dir)).not.toThrow();
  });
});
