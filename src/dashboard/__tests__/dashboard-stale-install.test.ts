// @tests: project-tracking-dashboard
/**
 * The stale-install watchdog: a dashboard whose own package directory is pruned
 * by a dependency upgrade keeps answering `/health` and `/identity` out of
 * memory while every file-reading route 500s, so `planPort` reuses the zombie
 * forever. `watchInstall` is what notices — and it also notices an upgrade that
 * leaves the old files in place, where every route keeps working but serves the
 * old code from memory.
 *
 * A real temp directory stands in for the install root — the thing under test is
 * an on-disk existence check, so shimming the filesystem would test the shim.
 * Only the clock is faked.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installedVersion, watchInstall } from '../server.js';

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

describe('watchInstall — upgrade in place', () => {
  let stop: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
  });

  it('reports the old and new version once the installed version changes', () => {
    let version = '1.13.0';
    const upgraded: Array<[string, string]> = [];
    stop = watchInstall({
      root: tmpdir(),
      intervalMs: 100,
      readVersion: () => version,
      onVanished: () => {},
      onUpgraded: (from, to) => upgraded.push([from, to]),
    });

    vi.advanceTimersByTime(300);
    expect(upgraded).toEqual([]);

    version = '1.14.0';
    vi.advanceTimersByTime(1000);

    expect(upgraded).toEqual([['1.13.0', '1.14.0']]);
  });

  it('ignores a tick where the version cannot be read (mid-reinstall)', () => {
    let version: string | undefined = '1.13.0';
    const upgraded: Array<[string, string]> = [];
    stop = watchInstall({
      root: tmpdir(),
      intervalMs: 100,
      readVersion: () => version,
      onVanished: () => {},
      onUpgraded: (from, to) => upgraded.push([from, to]),
    });

    version = undefined;
    vi.advanceTimersByTime(500);

    expect(upgraded).toEqual([]);
  });
});

describe('installedVersion', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'noldor-version-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writePkg(at: string, version: string): void {
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, 'package.json'), JSON.stringify({ name: '@scope/pkg', version }));
  }

  it("reads the version the project's node_modules resolves, not the running copy's", () => {
    const packageRoot = join(dir, 'store', 'pkg@1.13.0');
    const projectRoot = join(dir, 'project');
    writePkg(packageRoot, '1.13.0');
    writePkg(join(projectRoot, 'node_modules', '@scope', 'pkg'), '1.14.0');

    expect(installedVersion(projectRoot, packageRoot)).toBe('1.14.0');
  });

  it('falls back to the running package when the project does not install it (self-host)', () => {
    writePkg(dir, '1.13.0');

    expect(installedVersion(dir, dir)).toBe('1.13.0');
  });

  it('returns undefined when no package.json can be read', () => {
    expect(installedVersion(dir, dir)).toBeUndefined();
  });
});
