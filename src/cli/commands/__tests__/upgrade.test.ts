// @tests: version-aware-upgrade-and-migration-chain
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Migration } from '../../../migrations/types.js';
import { runUpgrade } from '../upgrade.js';

let dir: string;
function git(...args: string[]): void {
  execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'noldor-up-'));
  git('init');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  writeFileSync(
    join(dir, '.noldor/config.json'),
    JSON.stringify({ consumer: { name: 'x', frameworkVersion: '0.2.0' } }, null, 2),
  );
  writeFileSync(join(dir, 'sample.txt'), 'oldKey\n');
  git('add', '.');
  git('commit', '-m', 'init');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const m030: Migration = {
  from: '0.2.0',
  to: '0.3.0',
  description: 'rewrite',
  dryRun(cwd) {
    const b = readFileSync(join(cwd, 'sample.txt'), 'utf8');
    return [{ path: 'sample.txt', before: b, after: b.replace('oldKey', 'newKey') }];
  },
  migrate(cwd) {
    const steps = this.dryRun(cwd, {} as never);
    writeFileSync(join(cwd, steps[0].path), steps[0].after);
    return steps;
  },
};

describe('runUpgrade', () => {
  it('dry-run reports steps, writes nothing, leaves anchor', () => {
    const r = runUpgrade({
      cwd: dir,
      migrations: [m030],
      installed: '0.3.0',
      dryRun: true,
      force: false,
    });
    expect(r.applied).toBe(false);
    expect(r.steps).toBe(1);
    expect(readFileSync(join(dir, 'sample.txt'), 'utf8')).toBe('oldKey\n');
  });

  it('apply lands steps + advances anchor', () => {
    const r = runUpgrade({
      cwd: dir,
      migrations: [m030],
      installed: '0.3.0',
      dryRun: false,
      force: false,
    });
    expect(r.applied).toBe(true);
    expect(readFileSync(join(dir, 'sample.txt'), 'utf8')).toBe('newKey\n');
    const raw = JSON.parse(readFileSync(join(dir, '.noldor/config.json'), 'utf8'));
    expect(raw.consumer.frameworkVersion).toBe('0.3.0');
  });

  it('no-op when already current', () => {
    const r = runUpgrade({
      cwd: dir,
      migrations: [m030],
      installed: '0.2.0',
      dryRun: false,
      force: false,
    });
    expect(r.steps).toBe(0);
    expect(r.applied).toBe(false);
  });

  it('bootstraps the anchor when --from equals installed on an unset tree (fresh adopt via init --update)', () => {
    // No frameworkVersion anchor (init --update never stamps it).
    writeFileSync(
      join(dir, '.noldor/config.json'),
      JSON.stringify({ consumer: { name: 'x' } }, null, 2),
    );
    git('add', '.');
    git('commit', '-m', 'drop anchor');
    const r = runUpgrade({
      cwd: dir,
      migrations: [m030],
      installed: '0.5.0',
      from: '0.5.0',
      dryRun: false,
      force: false,
    });
    expect(r.steps).toBe(0);
    expect(r.applied).toBe(true);
    const raw = JSON.parse(readFileSync(join(dir, '.noldor/config.json'), 'utf8'));
    expect(raw.consumer.frameworkVersion).toBe('0.5.0');
  });

  it('does NOT rewrite an already-set current anchor (empty chain stays a no-op)', () => {
    const r = runUpgrade({
      cwd: dir,
      migrations: [m030],
      installed: '0.2.0', // equals the on-disk anchor from beforeEach
      dryRun: false,
      force: false,
    });
    expect(r.steps).toBe(0);
    expect(r.applied).toBe(false);
    expect(r.report).toContain('nothing to do');
  });

  it('refuses on a dirty tree without force', () => {
    writeFileSync(join(dir, 'dirty.txt'), 'x');
    expect(() =>
      runUpgrade({ cwd: dir, migrations: [m030], installed: '0.3.0', dryRun: false, force: false }),
    ).toThrow(/dirty/);
  });
});
