import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSession, writeSession } from '../../core/session';
import { withReleaseSession } from '../release-session';

describe('withReleaseSession', () => {
  it('writes a release-automation marker for the duration of work and clears it on success', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rs-'));
    mkdirSync(join(dir, '.noldor'));
    let observedDuringWork: ReturnType<typeof readSession> = null;
    await withReleaseSession(dir, async () => {
      observedDuringWork = readSession(dir);
    });
    expect(observedDuringWork).not.toBeNull();
    expect(observedDuringWork!.path).toBe('release-automation');
    expect(typeof observedDuringWork!.startedAt).toBe('string');
    expect(readSession(dir)).toBeNull();
  });

  it('clears the marker even when work throws', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rs-'));
    mkdirSync(join(dir, '.noldor'));
    await expect(
      withReleaseSession(dir, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(readSession(dir)).toBeNull();
  });

  it('crash-recovers when the existing marker is a stale release-automation marker', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rs-'));
    mkdirSync(join(dir, '.noldor'));
    writeSession(dir, {
      path: 'release-automation',
      startedAt: '2026-05-21T00:00:00Z',
    });
    let observedDuringWork: ReturnType<typeof readSession> = null;
    await withReleaseSession(dir, async () => {
      observedDuringWork = readSession(dir);
    });
    // Stale marker overwritten with fresh timestamp; cleared after work.
    expect(observedDuringWork).not.toBeNull();
    expect(observedDuringWork!.path).toBe('release-automation');
    expect(observedDuringWork!.startedAt).not.toBe('2026-05-21T00:00:00Z');
    expect(readSession(dir)).toBeNull();
  });

  it('refuses to run when the existing marker is from a different path (gate session)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rs-'));
    mkdirSync(join(dir, '.noldor'));
    writeSession(dir, { path: 'fast-track', startedAt: '2026-05-22T00:00:00Z' });
    await expect(
      withReleaseSession(dir, async () => {
        /* should never run */
      }),
    ).rejects.toThrow(/active \/?gate session/i);
    // Operator's gate session left intact — never overwritten.
    expect(readSession(dir)?.path).toBe('fast-track');
  });
});
