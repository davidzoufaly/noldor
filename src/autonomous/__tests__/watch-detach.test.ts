import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  binPathFrom,
  detachChildArgv,
  detachWatch,
  stripDetach,
  WATCH_LOG_REL,
  WATCH_PID_REL,
} from '../watch-detach.js';

describe('stripDetach', () => {
  it('removes every --detach token, preserves order + other flags', () => {
    expect(stripDetach(['--detach', '--interval', '5', '--once'])).toEqual([
      '--interval',
      '5',
      '--once',
    ]);
    expect(stripDetach(['--interval', '5', '--detach', '--detach'])).toEqual(['--interval', '5']);
  });

  it('is a no-op when --detach absent', () => {
    expect(stripDetach(['--once', '--json'])).toEqual(['--once', '--json']);
  });
});

describe('binPathFrom', () => {
  it('resolves the package bin two levels up from the module dir', () => {
    expect(binPathFrom('/pkg/src/autonomous')).toBe('/pkg/bin/noldor.mjs');
  });
});

describe('detachChildArgv', () => {
  it('builds the re-invocation argv sans --detach', () => {
    expect(detachChildArgv('/pkg/src/autonomous', ['--detach', '--interval', '5'])).toEqual([
      '/pkg/bin/noldor.mjs',
      'autonomous',
      'watch',
      '--interval',
      '5',
    ]);
  });
});

describe('detachWatch', () => {
  const dirs: string[] = [];
  const mkCwd = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'watch-detach-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    /* tmp dirs are left for the OS to reap; nothing live spawned */
  });

  it('spawns detached, writes the pidfile, returns paths (injected spawn)', () => {
    const cwd = mkCwd();
    let spawnedArgv: string[] | undefined;
    const fakeSpawn = ((_cmd: string, argv: readonly string[]) => {
      spawnedArgv = [...argv];
      return { pid: 4242, unref: () => {} };
    }) as unknown as typeof import('node:child_process').spawn;

    const res = detachWatch(cwd, '/pkg/src/autonomous', ['--detach', '--once'], {
      spawn: fakeSpawn,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    expect(res.pid).toBe(4242);
    expect(res.logPath).toBe(join(cwd, WATCH_LOG_REL));
    expect(res.pidPath).toBe(join(cwd, WATCH_PID_REL));
    expect(readFileSync(res.pidPath, 'utf8').trim()).toBe('4242');
    expect(spawnedArgv).toEqual(['/pkg/bin/noldor.mjs', 'autonomous', 'watch', '--once']);
  });

  it('refuses when a live drain lock is held (no second daemon)', () => {
    const cwd = mkCwd();
    mkdirSync(join(cwd, '.noldor'), { recursive: true });
    // Our own pid is alive by definition → simulates a running watcher.
    writeFileSync(
      join(cwd, '.noldor/drain.lock'),
      JSON.stringify({ pid: process.pid, startedAt: '' }),
      'utf8',
    );
    let spawned = false;
    const fakeSpawn = (() => {
      spawned = true;
      return { pid: 1, unref: () => {} };
    }) as unknown as typeof import('node:child_process').spawn;

    const res = detachWatch(cwd, '/pkg/src/autonomous', ['--detach'], { spawn: fakeSpawn });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.reason).toMatch(/already running/i);
    expect(res.pid).toBe(process.pid);
    expect(spawned).toBe(false);
    expect(existsSync(join(cwd, WATCH_PID_REL))).toBe(false);
  });
});
