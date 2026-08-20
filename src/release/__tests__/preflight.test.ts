// @tests: release-sweep-process-hardening
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readSession, writeSession } from '../../core/session.js';
import { readGardenReceipt, writeGardenReceipt } from '../../garden/garden-receipt.js';
import { blockingIds, recordOverrides, runPreflight } from '../preflight.js';
import { SAFE_FIXES } from '../preflight-fix.js';
import { writeReleaseState } from '../release-state.js';
import type { PreflightRow } from '../preflight-types.js';

const HOUR_MS = 3_600_000;

/** A git repo with a src/ commit, a .noldor/ dir, and no origin remote. */
function repo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'preflight-run-'));
  execFileSync('git', ['init', '-q'], { cwd });
  execFileSync('git', ['config', 'user.email', 't@e'], { cwd });
  execFileSync('git', ['config', 'user.name', 't'], { cwd });
  mkdirSync(join(cwd, '.noldor'), { recursive: true });
  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(join(cwd, 'src/app.ts'), 'export const a = 1;\n', 'utf8');
  execFileSync('git', ['add', '-A'], { cwd });
  execFileSync('git', ['commit', '-q', '-m', 'src'], {
    cwd,
    env: { ...process.env, GIT_AUTHOR_DATE: '@2000 +0000', GIT_COMMITTER_DATE: '@2000 +0000' },
  });
  return cwd;
}

const byId = (rows: PreflightRow[], id: string): PreflightRow => {
  const row = rows.find((r) => r.id === id);
  if (row === undefined) throw new Error(`no row for ${id}`);
  return row;
};

const run = (cwd: string, over: Partial<Parameters<typeof runPreflight>[0]> = {}) =>
  runPreflight({
    cwd,
    scanPaths: ['src'],
    nowMs: 0,
    fixes: [],
    log: () => {},
    ...over,
  });

describe('runPreflight', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = repo();
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns exactly one row per registered check, ids unique', async () => {
    const rows = await run(cwd);
    expect(rows.length).toBe(16);
    expect(new Set(rows.map((r) => r.id)).size).toBe(16);
  });

  it('populates detail on every row, including ok and skipped ones', async () => {
    const rows = await run(cwd);
    for (const row of rows) {
      expect(row.detail.length).toBeGreaterThan(0);
    }
  });

  it('gives every blocking and warn row a non-empty fix line', async () => {
    const rows = await run(cwd);
    for (const row of rows) {
      if (row.status === 'blocking' || row.status === 'warn') {
        expect(row.fix, `${row.id} has no fix`).toBeTruthy();
      }
    }
  });

  /**
   * The core regression test for this feature: four independent gates broken at
   * once must all be reported by ONE call. The old ladder threw on the first,
   * costing a full release re-run per blocker.
   */
  it('reports four simultaneously-broken gates in a single pass', async () => {
    writeSession(cwd, {
      path: 'specs-only-attach',
      parent: 'p',
      startedAt: new Date(0).toISOString(),
      markerVersion: 2,
    });
    writeReleaseState(cwd, {
      version: '9.9.9',
      previousTag: 'v9.9.8',
      date: '2026-01-01',
      startedAt: new Date(0).toISOString(),
    });
    // No garden receipt → garden-receipt blocks. Not on main → branch blocks.
    execFileSync('git', ['checkout', '-q', '-b', 'feat/x'], { cwd });

    const rows = await run(cwd);
    const blocking = blockingIds(rows);
    for (const id of ['session-marker', 'release-state', 'branch', 'garden-receipt'] as const) {
      expect(blocking, `${id} should be blocking`).toContain(id);
    }
  });

  it('mutates nothing when fixes is empty, even with fixable blockers present', async () => {
    writeSession(cwd, { path: 'micro-chore', startedAt: new Date(0).toISOString() });
    const rows = await run(cwd, { nowMs: 999 * HOUR_MS });
    expect(byId(rows, 'session-marker').status).toBe('blocking');
    // The marker is stale AND fixable, but report-only must leave it on disk.
    expect(readSession(cwd)).not.toBeNull();
  });

  it('removes a stale marker under --fix and reports ok in the same call', async () => {
    writeSession(cwd, { path: 'micro-chore', startedAt: new Date(0).toISOString() });
    const rows = await run(cwd, { nowMs: 999 * HOUR_MS, fixes: SAFE_FIXES });
    expect(readSession(cwd)).toBeNull();
    // Pass 2 re-reads from disk, so the removal is visible in the report — this
    // is what a single-row re-probe of a frozen snapshot could not deliver.
    expect(byId(rows, 'session-marker').status).toBe('ok');
    expect(existsSync(join(cwd, '.noldor/session.json'))).toBe(false);
  });

  it('leaves a live (non-stale) marker in place under --fix', async () => {
    writeSession(cwd, { path: 'micro-chore', startedAt: new Date(0).toISOString() });
    const rows = await run(cwd, { nowMs: HOUR_MS, fixes: SAFE_FIXES });
    expect(readSession(cwd)).not.toBeNull();
    expect(byId(rows, 'session-marker').status).toBe('blocking');
  });

  it('never removes a feature-path marker under --fix, however old', async () => {
    // isSessionStale only treats micro-chore / release-sweep as stale-eligible,
    // so a fast-track session can never be auto-deleted — losing one costs the
    // operator real work.
    writeSession(cwd, {
      path: 'fast-track',
      slug: 's',
      startedAt: new Date(0).toISOString(),
    });
    const rows = await run(cwd, { nowMs: 99_999 * HOUR_MS, fixes: SAFE_FIXES });
    expect(readSession(cwd)).not.toBeNull();
    expect(byId(rows, 'session-marker').status).toBe('blocking');
  });

  it('echoes each applied fix through the injected log', async () => {
    writeSession(cwd, { path: 'micro-chore', startedAt: new Date(0).toISOString() });
    const logged: string[] = [];
    await run(cwd, {
      nowMs: 999 * HOUR_MS,
      fixes: SAFE_FIXES,
      log: (m) => logged.push(m),
    });
    expect(logged.join('\n')).toMatch(/removed stale session marker/);
  });

  it('reports the garden receipt as ok once it postdates the latest commit', async () => {
    writeGardenReceipt({ headSha: 'a'.repeat(40), timestamp: 3000 }, cwd);
    const rows = await run(cwd);
    expect(byId(rows, 'garden-receipt').status).toBe('ok');
  });

  /**
   * Evaluation must not mutate the repo. The sdd-report row regenerates the
   * report to compare it, and an in-place variant used to do that even when
   * earlier rows were already blocking — so `pnpm release` from a dirty tree
   * rewrote a tracked file and then aborted, leaving unexplained drift.
   */
  it('leaves docs/sdd-report.md byte-identical while evaluating', async () => {
    const report = join(cwd, 'docs/sdd-report.md');
    mkdirSync(join(cwd, 'docs'), { recursive: true });
    writeFileSync(report, '# SDD report\n\nhand-written sentinel\n', 'utf8');
    const before = readFileSync(report, 'utf8');
    await run(cwd);
    expect(readFileSync(report, 'utf8')).toBe(before);
  });

  it('writes no overrides.log during evaluation, even with a skip-var set', async () => {
    const original = process.env.RELEASE_SKIP_GATE_COMPLIANCE;
    process.env.RELEASE_SKIP_GATE_COMPLIANCE = '1';
    try {
      const rows = await run(cwd);
      const row = byId(rows, 'gate-compliance');
      expect(row.status).toBe('skipped');
      expect(row.override).toBe('RELEASE_SKIP_GATE_COMPLIANCE=1');
      // Read-only: --preflight releases nothing, so it records no audit state.
      expect(existsSync(join(cwd, '.noldor/overrides.log'))).toBe(false);
    } finally {
      if (original === undefined) delete process.env.RELEASE_SKIP_GATE_COMPLIANCE;
      else process.env.RELEASE_SKIP_GATE_COMPLIANCE = original;
    }
  });

  /**
   * `--fix` must never claim a remedy it did not perform. `autoStampOnCleanDetect`
   * logs "receipt NOT auto-stamped" on failure, which contains the substring
   * "auto-stamped" — so the old `msg.includes('auto-stamped')` success check
   * reported every detect failure as a successful stamp.
   */
  it('does not claim a garden re-stamp when detect is not clean', async () => {
    // No .noldor/config.json and no graph in this fixture, so `garden detect`
    // exits non-zero — the stamp must be declined AND unreported.
    const logged: string[] = [];
    const rows = await run(cwd, { fixes: ['garden-receipt'], log: (m) => logged.push(m) });
    expect(logged.join('\n')).not.toMatch(/stamped the garden receipt/);
    expect(byId(rows, 'garden-receipt').status).toBe('blocking');
    expect(readGardenReceipt(cwd)).toBeNull();
  });

  it('tags an override row once even when the fix pass evaluates it twice', async () => {
    // garden-receipt is in SAFE_FIXES, so pass 1 and pass 2 both evaluate it.
    // Logging inside the probe would double-append; the tag is idempotent.
    const original = process.env.RELEASE_SKIP_GARDEN_GATE;
    process.env.RELEASE_SKIP_GARDEN_GATE = '1';
    try {
      const rows = await run(cwd, { fixes: SAFE_FIXES });
      expect(recordOverrides(rows, cwd).filter((o) => o.startsWith('RELEASE_SKIP_GARDEN'))).toEqual(
        ['RELEASE_SKIP_GARDEN_GATE=1'],
      );
    } finally {
      if (original === undefined) delete process.env.RELEASE_SKIP_GARDEN_GATE;
      else process.env.RELEASE_SKIP_GARDEN_GATE = original;
    }
  });
});

describe('blockingIds', () => {
  it('returns an empty array for a green report', () => {
    expect(
      blockingIds([
        { id: 'branch', status: 'ok', detail: 'd' },
        { id: 'npm-name', status: 'warn', detail: 'd', fix: 'f' },
        { id: 'cr-gate', status: 'skipped', detail: 'd' },
      ]),
    ).toEqual([]);
  });

  it('does not treat warn as blocking', () => {
    // A warn must never abort a release — an unreachable registry is not a
    // reason to refuse to ship.
    expect(blockingIds([{ id: 'npm-name', status: 'warn', detail: 'd', fix: 'f' }])).toEqual([]);
  });

  it('lists blocking ids in report order', () => {
    expect(
      blockingIds([
        { id: 'branch', status: 'blocking', detail: 'd', fix: 'f' },
        { id: 'gh-auth', status: 'ok', detail: 'd' },
        { id: 'cr-gate', status: 'blocking', detail: 'd', fix: 'f' },
      ]),
    ).toEqual(['branch', 'cr-gate']);
  });
});

describe('SAFE_FIXES', () => {
  it('is exactly the three guarded remedies', () => {
    expect([...SAFE_FIXES].sort()).toEqual(['garden-receipt', 'origin-sync', 'session-marker']);
  });

  it('applies the ref-moving origin-sync remedy first', () => {
    // Load-bearing ordering: a garden-receipt that only goes stale BECAUSE of
    // the fast-forward is caught only if its evaluation happens after the merge.
    expect(SAFE_FIXES[0]).toBe('origin-sync');
  });
});
