// @tests: noldor
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  INSTALL_MARKER,
  LOCKFILE,
  REPAIR,
  checkInstallFreshness,
} from '../check-install-freshness.js';

const LOCK = "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      pngjs: 7.0.0\n";

/**
 * A consumer repo root. `lock` omitted means no lockfile; `installed` omitted
 * means node_modules exists without pnpm's marker; `nodeModules: false` means
 * nothing was ever installed.
 */
function consumer(opts: { lock?: string; installed?: string; nodeModules?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'install-freshness-'));
  if (opts.lock !== undefined) writeFileSync(join(dir, LOCKFILE), opts.lock);
  if (opts.nodeModules !== false) mkdirSync(join(dir, 'node_modules'), { recursive: true });
  if (opts.installed !== undefined) {
    const marker = join(dir, INSTALL_MARKER);
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, opts.installed);
  }
  return dir;
}

describe('checkInstallFreshness', () => {
  it('passes a tree installed from the lockfile on disk', () => {
    const r = checkInstallFreshness(consumer({ lock: LOCK, installed: LOCK }));
    expect(r.status).toBe('ok');
    expect(r.advisory).toBe(false);
  });

  it('reports stale when the lockfile changed after the install', () => {
    const pulled = `${LOCK}      pixelmatch: 6.0.0\n`;
    const r = checkInstallFreshness(consumer({ lock: pulled, installed: LOCK }));
    expect(r.status).toBe('stale');
    expect(r.advisory).toBe(false);
    expect(r.detail).toContain(REPAIR);
  });

  it('reports not-installed when node_modules is absent entirely', () => {
    const r = checkInstallFreshness(consumer({ lock: LOCK, nodeModules: false }));
    expect(r.status).toBe('not-installed');
    expect(r.advisory).toBe(false);
    expect(r.detail).toContain(REPAIR);
  });

  it('stays silent on a repo with no pnpm lockfile', () => {
    const r = checkInstallFreshness(consumer({ installed: LOCK }));
    expect(r.status).toBe('no-lockfile');
    expect(r.advisory).toBe(true);
  });

  it('warns without failing when the install carries no readable marker', () => {
    const r = checkInstallFreshness(consumer({ lock: LOCK }));
    expect(r.status).toBe('unverified');
    expect(r.advisory).toBe(true);
    expect(r.detail).toContain(INSTALL_MARKER);
  });

  it('does not fail a repo whose marker is a directory it cannot read', () => {
    const dir = consumer({ lock: LOCK });
    mkdirSync(join(dir, INSTALL_MARKER), { recursive: true });
    const r = checkInstallFreshness(dir);
    expect(r.status).toBe('unverified');
    expect(r.advisory).toBe(true);
  });
});
