// @tests: pnpm-release-resume
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNoInProgressRelease } from '../index.js';
import { writeReleaseState } from '../release-state.js';

const STATE = {
  version: '0.4.1',
  previousTag: 'v0.4.0',
  date: '2026-07-02',
  startedAt: '2026-07-02T10:00:00.000Z',
};

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
