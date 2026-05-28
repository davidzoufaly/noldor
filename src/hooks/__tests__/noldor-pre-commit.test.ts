import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPreCommit } from '../noldor-pre-commit';

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qfpc-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t.t', { cwd: dir });
  execSync('git config user.name t', { cwd: dir });
  mkdirSync(join(dir, '.noldor'));
  return dir;
}

describe('noldor pre-commit', () => {
  it('soft mode: passes everything when no rollout marker', () => {
    const dir = setupRepo();
    // No .noldor/rollout-marker — soft mode should pass regardless
    mkdirSync(join(dir, 'packages', 'web', 'src'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'web', 'src', 'foo.ts'), 'x');
    execSync('git add packages/web/src/foo.ts', { cwd: dir });
    expect(runPreCommit({ cwd: dir }).ok).toBe(true);
  });

  it('passes when session is fast-track (no allowlist check)', () => {
    const dir = setupRepo();
    writeFileSync(
      join(dir, '.noldor', 'session.json'),
      JSON.stringify({ path: 'fast-track', startedAt: 'x' }),
    );
    writeFileSync(join(dir, 'a.ts'), 'x');
    execSync('git add a.ts', { cwd: dir });
    expect(runPreCommit({ cwd: dir }).ok).toBe(true);
  });

  it('passes when session is micro-chore and diff matches allowlist', () => {
    const dir = setupRepo();
    writeFileSync(
      join(dir, '.noldor', 'session.json'),
      JSON.stringify({ path: 'micro-chore', startedAt: 'x' }),
    );
    writeFileSync(join(dir, 'README.md'), 'x');
    execSync('git add README.md', { cwd: dir });
    expect(runPreCommit({ cwd: dir }).ok).toBe(true);
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
    const r = runPreCommit({ cwd: dir });
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
    const r = runPreCommit({ cwd: dir });
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
    const r = runPreCommit({ cwd: dir });
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
    expect(runPreCommit({ cwd: dir })).toEqual({ ok: true });
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
    const r = runPreCommit({ cwd: dir });
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

    expect(runPreCommit({ cwd: dir })).toEqual({ ok: true });
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
    const r = runPreCommit({ cwd: dir });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/\/gate/);
  });
});
