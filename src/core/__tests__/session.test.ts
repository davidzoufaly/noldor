// @tests: autonomous-plan-to-pr-merge, release-script-self-provisions-its-own-session-marker, release-sweep-process-hardening
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readSession,
  writeSession,
  clearSession,
  setAutonomous,
  touchSession,
  isSessionStale,
  SessionMarkerSchema,
  type SessionMarker,
} from '../session';

describe('session marker', () => {
  it('writes and reads round-trip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfs-'));
    mkdirSync(join(dir, '.noldor'));
    const marker: SessionMarker = {
      path: 'specs-only-new',
      slug: 'foo',
      parent: undefined,
      startedAt: '2026-05-10T00:00:00Z',
      markerVersion: 2,
    };
    writeSession(dir, marker);
    expect(readSession(dir)).toEqual(marker);
  });
  it('returns null when missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfs-'));
    expect(readSession(dir)).toBeNull();
  });
  it('clearSession deletes the file so readSession returns null afterwards', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfs-'));
    mkdirSync(join(dir, '.noldor'));
    const marker: SessionMarker = {
      path: 'fast-track',
      startedAt: '2026-05-10T00:00:00Z',
    };
    writeSession(dir, marker);
    expect(readSession(dir)).not.toBeNull();
    clearSession(dir);
    expect(readSession(dir)).toBeNull();
    // File should not exist on disk after clear
    expect(existsSync(join(dir, '.noldor', 'session.json'))).toBe(false);
  });
  it('clearSession is a no-op when file does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfs-'));
    // Should not throw
    expect(() => clearSession(dir)).not.toThrow();
  });
  it('accepts path: release-sweep', () => {
    const r = SessionMarkerSchema.safeParse({
      path: 'release-sweep',
      startedAt: '2026-05-17T08:00:00.000Z',
    });
    expect(r.success).toBe(true);
  });
  it('accepts path: release-automation', () => {
    const r = SessionMarkerSchema.safeParse({
      path: 'release-automation',
      startedAt: '2026-05-22T00:00:00.000Z',
    });
    expect(r.success).toBe(true);
  });
  it('round-trips the autonomous flag when set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfs-'));
    mkdirSync(join(dir, '.noldor'));
    const marker: SessionMarker = {
      path: 'specs-only-new',
      slug: 'foo',
      startedAt: '2026-05-25T00:00:00Z',
      autonomous: true,
      markerVersion: 2,
    };
    writeSession(dir, marker);
    expect(readSession(dir)).toEqual(marker);
  });
  it('autonomous field is optional (undefined readback when omitted)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfs-'));
    mkdirSync(join(dir, '.noldor'));
    writeSession(dir, {
      path: 'specs-only-new',
      slug: 'foo',
      startedAt: '2026-05-25T00:00:00Z',
      markerVersion: 2,
    });
    const back = readSession(dir);
    expect(back?.autonomous).toBeUndefined();
  });
  it('setAutonomous mutates existing marker to autonomous: true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfs-'));
    mkdirSync(join(dir, '.noldor'));
    writeSession(dir, {
      path: 'specs-only-new',
      slug: 'foo',
      startedAt: '2026-05-25T00:00:00Z',
      markerVersion: 2,
    });
    setAutonomous(dir);
    expect(readSession(dir)?.autonomous).toBe(true);
  });
  it('setAutonomous throws when no marker exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfs-'));
    expect(() => setAutonomous(dir)).toThrow(/session marker/);
  });
  it('touchSession rewrites startedAt to nowMs and preserves every other field', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfs-'));
    mkdirSync(join(dir, '.noldor'));
    writeSession(dir, {
      path: 'release-sweep',
      startedAt: '2026-05-17T08:00:00.000Z',
      autonomous: true,
    });
    const now = Date.parse('2026-05-18T09:30:00.000Z');
    touchSession(dir, now);
    expect(readSession(dir)).toEqual({
      path: 'release-sweep',
      startedAt: '2026-05-18T09:30:00.000Z',
      autonomous: true,
    });
  });
  it('touchSession is a no-op when no marker exists (never throws, writes nothing)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfs-'));
    expect(() => touchSession(dir, Date.parse('2026-05-18T09:30:00.000Z'))).not.toThrow();
    expect(existsSync(join(dir, '.noldor', 'session.json'))).toBe(false);
  });
});

describe('SessionMarker markerVersion field', () => {
  it('rejects specs-only-new without markerVersion (pre-flip stale marker)', () => {
    expect(() =>
      SessionMarkerSchema.parse({
        path: 'specs-only-new',
        slug: 'foo',
        startedAt: '2026-05-25T00:00:00Z',
      }),
    ).toThrow();
  });

  it('rejects specs-only-attach without markerVersion (pre-flip stale marker)', () => {
    expect(() =>
      SessionMarkerSchema.parse({
        path: 'specs-only-attach',
        parent: 'foo',
        startedAt: '2026-05-25T00:00:00Z',
      }),
    ).toThrow();
  });

  it('accepts specs-only-new with markerVersion: 2', () => {
    expect(() =>
      SessionMarkerSchema.parse({
        path: 'specs-only-new',
        slug: 'foo',
        startedAt: '2026-05-25T00:00:00Z',
        markerVersion: 2,
      }),
    ).not.toThrow();
  });

  it('accepts full-attach without markerVersion (no semantic conflict)', () => {
    expect(() =>
      SessionMarkerSchema.parse({
        path: 'full-attach',
        parent: 'foo',
        startedAt: '2026-05-25T00:00:00Z',
      }),
    ).not.toThrow();
  });

  it('rejects markerVersion values other than 2', () => {
    expect(() =>
      SessionMarkerSchema.parse({
        path: 'specs-only-new',
        slug: 'foo',
        startedAt: '2026-05-25T00:00:00Z',
        markerVersion: 1,
      }),
    ).toThrow();
    expect(() =>
      SessionMarkerSchema.parse({
        path: 'specs-only-new',
        slug: 'foo',
        startedAt: '2026-05-25T00:00:00Z',
        markerVersion: 3,
      }),
    ).toThrow();
  });
});

describe('isSessionStale', () => {
  const HOUR = 3_600_000;
  const NOW = Date.parse('2026-06-07T00:00:00.000Z');
  const TTL = 24;
  const at = (hoursAgo: number): string => new Date(NOW - hoursAgo * HOUR).toISOString();
  const marker = (path: SessionMarker['path'], startedAt: string): SessionMarker =>
    ({ path, startedAt }) as SessionMarker;

  it('micro-chore fresh (1h old) is not stale', () => {
    expect(isSessionStale(marker('micro-chore', at(1)), NOW, TTL)).toBe(false);
  });
  it('micro-chore stale (25h old) is stale', () => {
    expect(isSessionStale(marker('micro-chore', at(25)), NOW, TTL)).toBe(true);
  });
  it('release-sweep stale (25h old) is stale', () => {
    expect(isSessionStale(marker('release-sweep', at(25)), NOW, TTL)).toBe(true);
  });
  it('fast-track stale (25h old) is NOT eligible — never stale', () => {
    expect(isSessionStale(marker('fast-track', at(25)), NOW, TTL)).toBe(false);
  });
  it('full-new stale (25h old) is NOT eligible — never stale', () => {
    expect(isSessionStale(marker('full-new', at(25)), NOW, TTL)).toBe(false);
  });
  it('specs-only-attach stale (25h old) is NOT eligible — never stale', () => {
    expect(isSessionStale(marker('specs-only-attach', at(25)), NOW, TTL)).toBe(false);
  });
  it('release-automation stale (25h old) is NOT eligible — never stale', () => {
    expect(isSessionStale(marker('release-automation', at(25)), NOW, TTL)).toBe(false);
  });
  it('unparseable startedAt is never stale (no block on garbage)', () => {
    expect(isSessionStale(marker('micro-chore', 'x'), NOW, TTL)).toBe(false);
  });
  it('exactly at the TTL boundary is still fresh (strict >)', () => {
    expect(isSessionStale(marker('micro-chore', at(24)), NOW, TTL)).toBe(false);
  });
});

describe('SessionMarker enhancement field', () => {
  it('accepts enhancement field on specs-only-attach', () => {
    expect(() =>
      SessionMarkerSchema.parse({
        path: 'specs-only-attach',
        parent: 'noldor',
        enhancement: 'my-enhancement',
        startedAt: '2026-05-25T00:00:00Z',
        markerVersion: 2,
      }),
    ).not.toThrow();
  });

  it('accepts enhancement field on full-attach', () => {
    expect(() =>
      SessionMarkerSchema.parse({
        path: 'full-attach',
        parent: 'noldor',
        enhancement: 'my-enhancement',
        startedAt: '2026-05-25T00:00:00Z',
      }),
    ).not.toThrow();
  });

  it('allows enhancement to be absent', () => {
    expect(() =>
      SessionMarkerSchema.parse({
        path: 'full-attach',
        parent: 'noldor',
        startedAt: '2026-05-25T00:00:00Z',
      }),
    ).not.toThrow();
  });
});
