import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPreCommit, logOverride } from '../noldor-pre-commit';

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qfpc-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t.t', { cwd: dir });
  execSync('git config user.name t', { cwd: dir });
  mkdirSync(join(dir, '.noldor'));
  return dir;
}

describe('noldor pre-commit', () => {
  // Shared clock for the pre-existing cases: within 24h of the release-sweep
  // fixtures' startedAt (2026-05-17T08:00) so they stay fresh under the new
  // required staleness inputs. micro-chore fixtures use `startedAt: 'x'` → NaN →
  // never stale; release-automation is not stale-eligible.
  const NOW = Date.parse('2026-05-17T09:00:00.000Z');
  const TTL = 24;

  it('soft mode: passes everything when no rollout marker', () => {
    const dir = setupRepo();
    // No .noldor/rollout-marker — soft mode should pass regardless
    mkdirSync(join(dir, 'packages', 'web', 'src'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'web', 'src', 'foo.ts'), 'x');
    execSync('git add packages/web/src/foo.ts', { cwd: dir });
    expect(runPreCommit({ cwd: dir, nowMs: NOW, ttlHours: TTL }).ok).toBe(true);
  });

  it('passes when session is fast-track (no allowlist check)', () => {
    const dir = setupRepo();
    writeFileSync(
      join(dir, '.noldor', 'session.json'),
      JSON.stringify({ path: 'fast-track', startedAt: 'x' }),
    );
    writeFileSync(join(dir, 'a.ts'), 'x');
    execSync('git add a.ts', { cwd: dir });
    expect(runPreCommit({ cwd: dir, nowMs: NOW, ttlHours: TTL }).ok).toBe(true);
  });

  it('passes when session is micro-chore and diff matches allowlist', () => {
    const dir = setupRepo();
    writeFileSync(
      join(dir, '.noldor', 'session.json'),
      JSON.stringify({ path: 'micro-chore', startedAt: 'x' }),
    );
    writeFileSync(join(dir, 'README.md'), 'x');
    execSync('git add README.md', { cwd: dir });
    expect(runPreCommit({ cwd: dir, nowMs: NOW, ttlHours: TTL }).ok).toBe(true);
  });

  it('fails when session is micro-chore but diff escapes allowlist', () => {
    const dir = setupRepo();
    writeFileSync(
      join(dir, '.noldor', 'session.json'),
      JSON.stringify({ path: 'micro-chore', startedAt: 'x' }),
    );
    mkdirSync(join(dir, 'packages', 'web', 'src'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'web', 'src', 'foo.ts'), 'x');
    execSync('git add packages/web/src/foo.ts', { cwd: dir });
    const r = runPreCommit({ cwd: dir, nowMs: NOW, ttlHours: TTL });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/allowlist/);
  });

  it('fails post-rollout when no session and diff includes code (hard wall)', () => {
    const dir = setupRepo();
    // Simulate post-rollout: write a marker pointing at a real commit, then make HEAD a descendant.
    writeFileSync(join(dir, 'a'), 'init');
    execSync('git add a && git commit -q -m init', { cwd: dir });
    const initSha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), initSha + '\n');
    mkdirSync(join(dir, 'packages', 'web', 'src'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'web', 'src', 'foo.ts'), 'x');
    execSync('git add packages/web/src/foo.ts', { cwd: dir });
    execSync('git commit -q -m "post-rollout"', { cwd: dir }); // need HEAD past marker
    writeFileSync(join(dir, 'packages', 'web', 'src', 'bar.ts'), 'x');
    execSync('git add packages/web/src/bar.ts', { cwd: dir });
    const r = runPreCommit({ cwd: dir, nowMs: NOW, ttlHours: TTL });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/\/gate|allowlist/);
  });

  it('fails post-rollout when no session even if diff is allowlisted', () => {
    const dir = setupRepo();
    writeFileSync(join(dir, 'a'), 'init');
    execSync('git add a && git commit -q -m init', { cwd: dir });
    const initSha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), initSha + '\n');
    writeFileSync(join(dir, 'b'), 'x');
    execSync('git add b && git commit -q -m "post-rollout"', { cwd: dir });
    writeFileSync(join(dir, 'README.md'), 'x');
    execSync('git add README.md', { cwd: dir });
    const r = runPreCommit({ cwd: dir, nowMs: NOW, ttlHours: TTL });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/\/gate/);
  });

  it('admits release-sweep session when staged paths match RELEASE_SWEEP_GLOBS', () => {
    const dir = setupRepo();
    writeFileSync(
      join(dir, '.noldor', 'session.json'),
      JSON.stringify({ path: 'release-sweep', startedAt: '2026-05-17T08:00:00.000Z' }),
    );
    mkdirSync(join(dir, 'graphify-out'), { recursive: true });
    writeFileSync(join(dir, 'graphify-out', 'graph.json'), '{}');
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'sdd-report.md'), 'x');
    execSync('git add graphify-out/graph.json docs/sdd-report.md', { cwd: dir });
    expect(runPreCommit({ cwd: dir, nowMs: NOW, ttlHours: TTL })).toEqual({ ok: true });
  });

  it('rejects release-sweep session when a staged path escapes RELEASE_SWEEP_GLOBS', () => {
    const dir = setupRepo();
    writeFileSync(
      join(dir, '.noldor', 'session.json'),
      JSON.stringify({ path: 'release-sweep', startedAt: '2026-05-17T08:00:00.000Z' }),
    );
    mkdirSync(join(dir, 'graphify-out'));
    writeFileSync(join(dir, 'graphify-out', 'graph.json'), '{}');
    mkdirSync(join(dir, 'packages', 'engine', 'src'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'engine', 'src', 'foo.ts'), 'x');
    execSync('git add graphify-out/graph.json packages/engine/src/foo.ts', { cwd: dir });
    const r = runPreCommit({ cwd: dir, nowMs: NOW, ttlHours: TTL });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('release-sweep diff includes files outside allowlist');
  });

  it('admits release-automation session post-rollout when staged paths are the real release-commit spread', () => {
    const dir = setupRepo();
    // Establish post-rollout state: real init commit, marker points at its SHA, then advance HEAD past it.
    writeFileSync(join(dir, 'init'), 'init');
    execSync('git add init && git commit -q -m init', { cwd: dir });
    const initSha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), initSha + '\n');
    writeFileSync(join(dir, 'past-marker'), 'x');
    execSync('git add past-marker && git commit -q -m "past-marker"', { cwd: dir });

    // release-automation session marker (matches what withReleaseSession writes).
    writeFileSync(
      join(dir, '.noldor', 'session.json'),
      JSON.stringify({ path: 'release-automation', startedAt: '2026-05-22T00:00:00Z' }),
    );

    // Stage the real release-commit spread (mirror packages/noldor/src/release/index.ts:249-256).
    writeFileSync(join(dir, 'CHANGELOG.md'), 'changes\n');
    mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'release-notes.md'), 'notes\n');
    writeFileSync(join(dir, 'docs', 'features', 'sample.md'), '---\nname: x\n---\n');
    mkdirSync(join(dir, 'docs', 'noldor'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'noldor', 'sample.md'), 'x\n');
    writeFileSync(join(dir, 'package.json'), '{"name":"x","version":"0.5.2"}');
    execSync(
      'git add CHANGELOG.md docs/release-notes.md docs/features/sample.md docs/noldor/sample.md package.json',
      { cwd: dir },
    );

    expect(runPreCommit({ cwd: dir, nowMs: NOW, ttlHours: TTL })).toEqual({ ok: true });
  });

  it('rejects in post-rollout when release-automation session is absent (regression guard for the marker contract)', () => {
    const dir = setupRepo();
    writeFileSync(join(dir, 'init'), 'init');
    execSync('git add init && git commit -q -m init', { cwd: dir });
    const initSha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), initSha + '\n');
    writeFileSync(join(dir, 'past-marker'), 'x');
    execSync('git add past-marker && git commit -q -m "past-marker"', { cwd: dir });
    // No session.json written — simulates the pre-withReleaseSession regression
    // where the release script committed without provisioning a marker.
    writeFileSync(join(dir, 'CHANGELOG.md'), 'changes\n');
    execSync('git add CHANGELOG.md', { cwd: dir });
    const r = runPreCommit({ cwd: dir, nowMs: NOW, ttlHours: TTL });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/\/gate/);
  });

  describe('staleness expiry', () => {
    const TTL = 24;
    const STARTED = '2026-05-17T08:00:00.000Z';
    const FRESH = Date.parse('2026-05-17T09:00:00.000Z'); // +1h
    const STALE = Date.parse('2026-05-18T09:00:00.000Z'); // +25h

    it('rejects a stale micro-chore session with the stale reason (not the allowlist reason)', () => {
      const dir = setupRepo();
      writeFileSync(
        join(dir, '.noldor', 'session.json'),
        JSON.stringify({ path: 'micro-chore', startedAt: STARTED }),
      );
      writeFileSync(join(dir, 'README.md'), 'x'); // allowlisted — would pass if fresh
      execSync('git add README.md', { cwd: dir });
      const r = runPreCommit({ cwd: dir, nowMs: STALE, ttlHours: TTL });
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/stale/);
      expect(r.reason).not.toMatch(/allowlist/);
    });

    it('a fresh micro-chore outside the allowlist still fails with the allowlist reason', () => {
      const dir = setupRepo();
      writeFileSync(
        join(dir, '.noldor', 'session.json'),
        JSON.stringify({ path: 'micro-chore', startedAt: STARTED }),
      );
      mkdirSync(join(dir, 'packages', 'web', 'src'), { recursive: true });
      writeFileSync(join(dir, 'packages', 'web', 'src', 'foo.ts'), 'x');
      execSync('git add packages/web/src/foo.ts', { cwd: dir });
      const r = runPreCommit({ cwd: dir, nowMs: FRESH, ttlHours: TTL });
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/allowlist/);
    });

    it('rejects a stale release-sweep session with the stale reason', () => {
      const dir = setupRepo();
      writeFileSync(
        join(dir, '.noldor', 'session.json'),
        JSON.stringify({ path: 'release-sweep', startedAt: STARTED }),
      );
      mkdirSync(join(dir, 'graphify-out'), { recursive: true });
      writeFileSync(join(dir, 'graphify-out', 'graph.json'), '{}');
      execSync('git add graphify-out/graph.json', { cwd: dir });
      const r = runPreCommit({ cwd: dir, nowMs: STALE, ttlHours: TTL });
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/stale/);
    });

    it('NOLDOR_PATH_OVERRIDE bypasses staleness (override wins)', () => {
      const dir = setupRepo();
      writeFileSync(
        join(dir, '.noldor', 'session.json'),
        JSON.stringify({ path: 'micro-chore', startedAt: STARTED }),
      );
      writeFileSync(join(dir, 'README.md'), 'x');
      execSync('git add README.md', { cwd: dir });
      const r = runPreCommit({
        cwd: dir,
        pathOverride: 'shipping anyway',
        nowMs: STALE,
        ttlHours: TTL,
      });
      expect(r).toEqual({ ok: true, overrideReason: 'shipping anyway' });
    });

    it('a stale fast-track is unaffected (no allowlist branch — passes)', () => {
      const dir = setupRepo();
      writeFileSync(
        join(dir, '.noldor', 'session.json'),
        JSON.stringify({ path: 'fast-track', startedAt: STARTED }),
      );
      writeFileSync(join(dir, 'a.ts'), 'x');
      execSync('git add a.ts', { cwd: dir });
      // No rollout marker → soft mode → ok:true regardless of age (fast-track is not stale-eligible).
      expect(runPreCommit({ cwd: dir, nowMs: STALE, ttlHours: TTL }).ok).toBe(true);
    });
  });

  describe('NOLDOR_PATH_OVERRIDE bypass', () => {
    it('releases the micro-chore allowlist when pathOverride is set', () => {
      const dir = setupRepo();
      writeFileSync(
        join(dir, '.noldor', 'session.json'),
        JSON.stringify({ path: 'micro-chore', startedAt: 'x' }),
      );
      mkdirSync(join(dir, 'packages', 'web', 'src'), { recursive: true });
      writeFileSync(join(dir, 'packages', 'web', 'src', 'foo.ts'), 'x');
      execSync('git add packages/web/src/foo.ts', { cwd: dir });
      const r = runPreCommit({
        cwd: dir,
        pathOverride: 'stale micro-chore session',
        nowMs: NOW,
        ttlHours: TTL,
      });
      expect(r).toEqual({ ok: true, overrideReason: 'stale micro-chore session' });
    });

    it('releases the release-sweep allowlist when pathOverride is set', () => {
      const dir = setupRepo();
      writeFileSync(
        join(dir, '.noldor', 'session.json'),
        JSON.stringify({ path: 'release-sweep', startedAt: '2026-05-17T08:00:00.000Z' }),
      );
      mkdirSync(join(dir, 'packages', 'engine', 'src'), { recursive: true });
      writeFileSync(join(dir, 'packages', 'engine', 'src', 'foo.ts'), 'x');
      execSync('git add packages/engine/src/foo.ts', { cwd: dir });
      const r = runPreCommit({ cwd: dir, pathOverride: 'sweep escape', nowMs: NOW, ttlHours: TTL });
      expect(r).toEqual({ ok: true, overrideReason: 'sweep escape' });
    });

    it('releases the no-session hard wall post-rollout when pathOverride is set', () => {
      const dir = setupRepo();
      writeFileSync(join(dir, 'a'), 'init');
      execSync('git add a && git commit -q -m init', { cwd: dir });
      const initSha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
      writeFileSync(join(dir, '.noldor', 'rollout-marker'), initSha + '\n');
      writeFileSync(join(dir, 'past-marker'), 'x');
      execSync('git add past-marker && git commit -q -m "past-marker"', { cwd: dir });
      writeFileSync(join(dir, 'README.md'), 'x');
      execSync('git add README.md', { cwd: dir });
      const r = runPreCommit({
        cwd: dir,
        pathOverride: 'hook broken mid-migration',
        nowMs: NOW,
        ttlHours: TTL,
      });
      expect(r).toEqual({ ok: true, overrideReason: 'hook broken mid-migration' });
    });

    it('treats a whitespace-only pathOverride as unset (allowlist still blocks)', () => {
      const dir = setupRepo();
      writeFileSync(
        join(dir, '.noldor', 'session.json'),
        JSON.stringify({ path: 'micro-chore', startedAt: 'x' }),
      );
      mkdirSync(join(dir, 'packages', 'web', 'src'), { recursive: true });
      writeFileSync(join(dir, 'packages', 'web', 'src', 'foo.ts'), 'x');
      execSync('git add packages/web/src/foo.ts', { cwd: dir });
      const r = runPreCommit({ cwd: dir, pathOverride: '   ', nowMs: NOW, ttlHours: TTL });
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/allowlist/);
      expect(r.overrideReason).toBeUndefined();
    });

    it('leaves behavior unchanged when pathOverride is unset (regression guard)', () => {
      const dir = setupRepo();
      writeFileSync(
        join(dir, '.noldor', 'session.json'),
        JSON.stringify({ path: 'micro-chore', startedAt: 'x' }),
      );
      writeFileSync(join(dir, 'README.md'), 'x');
      execSync('git add README.md', { cwd: dir });
      const r = runPreCommit({ cwd: dir, nowMs: NOW, ttlHours: TTL });
      expect(r).toEqual({ ok: true });
    });
  });

  describe('logOverride breadcrumb', () => {
    it('appends a (pre-commit)-tagged line with the reason to .noldor/overrides.log', () => {
      const dir = setupRepo();
      logOverride(dir, 'stale micro-chore session');
      const log = readFileSync(join(dir, '.noldor', 'overrides.log'), 'utf8');
      expect(log).toMatch(/\tstale micro-chore session\t\(pre-commit\)\n$/);
    });

    it('does not throw when .noldor is missing (logging failure must not block the commit)', () => {
      const dir = mkdtempSync(join(tmpdir(), 'qfpc-nolog-'));
      // no .noldor directory created — appendFileSync will fail, must be swallowed
      expect(() => logOverride(dir, 'reason')).not.toThrow();
    });
  });
});
