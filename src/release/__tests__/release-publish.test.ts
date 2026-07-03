// @tests: registry-distribution-for-the-noldor-package
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_REGISTRY,
  awaitPublish,
  isVersionOnRegistry,
  readPkgIdentity,
} from '../release-publish.js';
import type { ExecFn } from '../release-publish.js';

/** Exec fake that fails `failures` times (E404), then resolves; records calls. */
function fakeExec(failures: number): {
  exec: ExecFn;
  calls: () => number;
  lastArgs: () => unknown[];
} {
  let n = 0;
  let last: unknown[] = [];
  const exec: ExecFn = async (cmd, cmdArgs, env) => {
    n += 1;
    last = [cmd, cmdArgs, env];
    if (n <= failures) throw new Error('npm ERR! code E404');
    return { stdout: '"0.5.0"\n' };
  };
  return { exec, calls: () => n, lastArgs: () => last };
}

describe('isVersionOnRegistry', () => {
  it('probes `npm view <pkg>@<version>` against the default registry', async () => {
    const fake = fakeExec(0);
    await expect(
      isVersionOnRegistry({ pkgName: 'noldor', version: '0.5.0', exec: fake.exec }),
    ).resolves.toBe(true);
    expect(fake.lastArgs()).toEqual([
      'npm',
      ['view', 'noldor@0.5.0', 'version', '--json', '--registry', DEFAULT_REGISTRY],
      undefined,
    ]);
  });

  it('returns false when npm exits non-zero (version not published yet)', async () => {
    const fake = fakeExec(99);
    await expect(
      isVersionOnRegistry({ pkgName: 'noldor', version: '0.5.0', exec: fake.exec }),
    ).resolves.toBe(false);
  });

  it('honours a configured registry', async () => {
    const fake = fakeExec(0);
    await isVersionOnRegistry({
      pkgName: 'noldor',
      version: '0.5.0',
      registry: 'https://registry.example.test',
      exec: fake.exec,
    });
    expect(fake.lastArgs()[1]).toContain('https://registry.example.test');
  });
});

describe('awaitPublish', () => {
  it('resolves on the first poll when the version is already visible', async () => {
    const fake = fakeExec(0);
    const res = await awaitPublish({
      pkgName: 'noldor',
      version: '0.5.0',
      exec: fake.exec,
      pollMs: 1,
      timeoutMs: 1000,
    });
    expect(res.ok).toBe(true);
    expect(fake.calls()).toBe(1);
  });

  it('retries while npm 404s and resolves once the version appears', async () => {
    const fake = fakeExec(2);
    const res = await awaitPublish({
      pkgName: 'noldor',
      version: '0.5.0',
      exec: fake.exec,
      pollMs: 1,
      timeoutMs: 1000,
    });
    expect(res.ok).toBe(true);
    expect(fake.calls()).toBe(3);
  });

  it('throws on timeout, naming publish.yml and the recovery commands', async () => {
    const fake = fakeExec(Number.POSITIVE_INFINITY);
    await expect(
      awaitPublish({
        pkgName: 'noldor',
        version: '0.5.0',
        exec: fake.exec,
        pollMs: 5,
        timeoutMs: 25,
      }),
    ).rejects.toThrow(/publish\.yml[\s\S]*pnpm release --resume/);
  });

  it('reads poll tuning from env overrides when explicit options are absent', async () => {
    const fake = fakeExec(Number.POSITIVE_INFINITY);
    await expect(
      awaitPublish({
        pkgName: 'noldor',
        version: '0.5.0',
        exec: fake.exec,
        env: { NOLDOR_PUBLISH_TIMEOUT_MS: '25', NOLDOR_PUBLISH_POLL_MS: '5' },
      }),
    ).rejects.toThrow(/Timed out/);
  });
});

describe('readPkgIdentity', () => {
  it('reads name + version from package.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-publish-'));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'testpkg', version: '0.4.1' }),
      'utf8',
    );
    expect(readPkgIdentity(dir)).toEqual({ name: 'testpkg', version: '0.4.1' });
  });

  it('throws when name or version is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-publish-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'testpkg' }), 'utf8');
    expect(() => readPkgIdentity(dir)).toThrow(/name and version/);
  });
});
