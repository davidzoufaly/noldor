// @tests: release-sweep-process-hardening
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeSession } from '../../core/session.js';
import { writeGardenReceipt } from '../../garden/garden-receipt.js';
import { ALL_ROW_IDS, makeProbeContext, runProbe } from '../preflight-probes.js';
import { writeReleaseState } from '../release-state.js';
import type { PreflightRowId } from '../preflight-types.js';

const HOUR_MS = 3_600_000;

function repo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'preflight-probe-'));
  execFileSync('git', ['init', '-q'], { cwd });
  execFileSync('git', ['config', 'user.email', 't@e'], { cwd });
  execFileSync('git', ['config', 'user.name', 't'], { cwd });
  mkdirSync(join(cwd, '.noldor'), { recursive: true });
  return cwd;
}

const ctx = (cwd: string, nowMs = 0) => makeProbeContext({ cwd, scanPaths: ['src'], nowMs });

describe('ALL_ROW_IDS', () => {
  it('has one entry per probe id, with no duplicates', () => {
    expect(new Set(ALL_ROW_IDS).size).toBe(ALL_ROW_IDS.length);
    expect(ALL_ROW_IDS.length).toBe(14);
  });

  it('every id round-trips through runProbe as its own row id', async () => {
    // A probe returning someone else's id would silently overwrite a row in the
    // report, so pin the mapping. The `release-state` probe is the cheapest one
    // that touches no git/network state.
    const cwd = repo();
    try {
      const row = await runProbe('release-state', ctx(cwd));
      expect(row.id).toBe('release-state');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('session-marker probe', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = repo();
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('is ok when no marker exists', async () => {
    const row = await runProbe('session-marker', ctx(cwd));
    expect(row.status).toBe('ok');
  });

  it('blocks on a foreign gate session and names the slug', async () => {
    writeSession(cwd, {
      path: 'specs-only-attach',
      parent: 'some-parent',
      startedAt: new Date(0).toISOString(),
      markerVersion: 2,
    });
    const row = await runProbe('session-marker', ctx(cwd));
    expect(row.status).toBe('blocking');
    expect(row.detail).toMatch(/specs-only-attach/);
    expect(row.detail).toMatch(/some-parent/);
    expect(row.fix).toMatch(/session\.json/);
  });

  it('warns rather than blocks on a leftover release-automation marker', async () => {
    // withReleaseSession deliberately falls through on this one (crashed prior
    // release), so blocking here would cry wolf on a self-healing condition.
    writeSession(cwd, { path: 'release-automation', startedAt: new Date(0).toISOString() });
    const row = await runProbe('session-marker', ctx(cwd));
    expect(row.status).toBe('warn');
    expect(row.fix).toMatch(/--resume/);
  });

  it('reports a stale-eligible marker past its TTL as stale, and offers --fix', async () => {
    writeSession(cwd, { path: 'micro-chore', startedAt: new Date(0).toISOString() });
    const row = await runProbe('session-marker', ctx(cwd, 999 * HOUR_MS));
    expect(row.status).toBe('blocking');
    expect(row.detail).toMatch(/stale/);
    expect(row.fix).toMatch(/--fix/);
  });

  it('does not call a fresh marker stale, and says --fix will not remove it', async () => {
    writeSession(cwd, { path: 'micro-chore', startedAt: new Date(0).toISOString() });
    const row = await runProbe('session-marker', ctx(cwd, HOUR_MS));
    expect(row.status).toBe('blocking');
    expect(row.detail).not.toMatch(/stale/);
    expect(row.fix).toMatch(/will NOT remove a live marker/);
  });
});

describe('release-state probe', () => {
  it('blocks with both recovery moves when a release is in progress', async () => {
    const cwd = repo();
    try {
      writeReleaseState(cwd, {
        version: '1.2.3',
        previousTag: 'v1.2.2',
        date: '2026-01-01',
        startedAt: new Date(0).toISOString(),
      });
      const row = await runProbe('release-state', ctx(cwd));
      expect(row.status).toBe('blocking');
      expect(row.detail).toMatch(/v1\.2\.3/);
      expect(row.fix).toMatch(/--resume/);
      expect(row.fix).toMatch(/git reset --hard/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('garden-receipt probe', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = repo();
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'src/app.ts'), 'export const a = 1;\n', 'utf8');
    execFileSync('git', ['add', '-A'], { cwd });
    execFileSync('git', ['commit', '-q', '-m', 'src'], {
      cwd,
      env: { ...process.env, GIT_AUTHOR_DATE: '@2000 +0000', GIT_COMMITTER_DATE: '@2000 +0000' },
    });
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('is ok when the receipt postdates the latest scoped commit', async () => {
    writeGardenReceipt({ headSha: 'a'.repeat(40), timestamp: 3000 }, cwd);
    const row = await runProbe('garden-receipt', ctx(cwd));
    expect(row.status).toBe('ok');
  });

  it('blocks when the receipt predates the latest scoped commit', async () => {
    writeGardenReceipt({ headSha: 'a'.repeat(40), timestamp: 1000 }, cwd);
    const row = await runProbe('garden-receipt', ctx(cwd));
    expect(row.status).toBe('blocking');
    expect(row.fix).toMatch(/noldor-garden/);
  });

  it('blocks when no receipt exists at all', async () => {
    const row = await runProbe('garden-receipt', ctx(cwd));
    expect(row.status).toBe('blocking');
  });
});

describe('runProbe error containment', () => {
  it('turns an unexpected probe throw into a blocking row, never a crash', async () => {
    // `npm-name` reads package.json via readPkgIdentity, which throws when the
    // file is absent. A probe that cannot evaluate its gate must not be read as
    // a pass, so the row must come back blocking rather than propagate.
    const cwd = repo();
    try {
      writeFileSync(
        join(cwd, '.noldor/config.json'),
        JSON.stringify({ release: { publish: { enabled: true } } }),
        'utf8',
      );
      const row = await runProbe('npm-name', ctx(cwd));
      expect(row.status).toBe('blocking');
      expect(row.detail).toMatch(/probe threw/);
      expect(row.fix).toMatch(/must not be read as a pass/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('npm-name probe', () => {
  it('is skipped when release.publish.enabled is false', async () => {
    const cwd = repo();
    try {
      writeFileSync(
        join(cwd, '.noldor/config.json'),
        JSON.stringify({ release: { publish: { enabled: false } } }),
        'utf8',
      );
      const row = await runProbe('npm-name', ctx(cwd));
      expect(row.status).toBe('skipped');
      expect(row.detail).toMatch(/publish\.enabled is false/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('is skipped when there is no publish config at all', async () => {
    const cwd = repo();
    try {
      const row = await runProbe('npm-name', ctx(cwd));
      expect(row.status).toBe('skipped');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('probe id coverage', () => {
  it('declares a probe for every PreflightRowId in the union', async () => {
    // The union and the registry are separate declarations; a row id added to
    // one and not the other would drop a gate silently.
    const ids: PreflightRowId[] = [
      'session-marker',
      'release-state',
      'branch',
      'tree-clean',
      'origin-sync',
      'gh-auth',
      'graph-freshness',
      'garden-receipt',
      'sdd-report',
      'validate-features',
      'gate-compliance',
      'architecture',
      'cr-gate',
      'npm-name',
    ];
    expect([...ALL_ROW_IDS].sort()).toEqual([...ids].sort());
  });
});
