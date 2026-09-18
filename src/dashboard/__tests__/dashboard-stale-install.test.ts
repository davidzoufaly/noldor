// @tests: project-tracking-dashboard
/**
 * The stale-install watchdog: a dashboard whose own package directory is pruned
 * by a dependency upgrade keeps answering `/health` and `/identity` out of
 * memory while every file-reading route 500s, so `planPort` reuses the zombie
 * forever. `watchInstall` is what notices.
 *
 * A real temp directory stands in for the install root — the thing under test is
 * an on-disk existence check, so shimming the filesystem would test the shim.
 * Only the clock is faked.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watchInstall } from '../server.js';

describe('watchInstall', () => {
  let installDir: string;
  let root: string;
  let stop: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    installDir = mkdtempSync(join(tmpdir(), 'noldor-install-'));
    root = join(installDir, 'dist', 'dashboard', 'static', 'dist');
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
    rmSync(installDir, { recursive: true, force: true });
  });

  it('stays quiet while the install root is still on disk', () => {
    const vanished: string[] = [];
    stop = watchInstall({ root, intervalMs: 100, onVanished: (r) => vanished.push(r) });

    vi.advanceTimersByTime(1000);

    expect(existsSync(root)).toBe(true);
    expect(vanished).toEqual([]);
  });

  it('reports the missing root once the install is deleted', () => {
    const vanished: string[] = [];
    stop = watchInstall({ root, intervalMs: 100, onVanished: (r) => vanished.push(r) });

    vi.advanceTimersByTime(100);
    expect(vanished).toEqual([]);

    rmSync(installDir, { recursive: true, force: true });
    vi.advanceTimersByTime(100);

    expect(vanished).toEqual([root]);
  });

  it('reports a vanished install exactly once, not on every later tick', () => {
    const vanished: string[] = [];
    stop = watchInstall({ root, intervalMs: 100, onVanished: (r) => vanished.push(r) });

    rmSync(installDir, { recursive: true, force: true });
    vi.advanceTimersByTime(1000);

    expect(vanished).toEqual([root]);
  });

  it('reports nothing after the returned stop function runs', () => {
    const vanished: string[] = [];
    const cancel = watchInstall({ root, intervalMs: 100, onVanished: (r) => vanished.push(r) });

    cancel();
    rmSync(installDir, { recursive: true, force: true });
    vi.advanceTimersByTime(1000);

    expect(vanished).toEqual([]);
  });
});
