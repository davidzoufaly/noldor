import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// @tests: noldor-package-lift

const BIN = resolve(__dirname, '../../../bin/noldor.mjs');

function run(args: string[], cwd?: string): string {
  return execFileSync('node', [BIN, ...args], { encoding: 'utf8', cwd });
}

describe('noldor CLI', () => {
  it('prints the package.json version on --version', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8')) as {
      version: string;
    };
    expect(run(['--version']).trim()).toBe(`noldor v${pkg.version}`);
  });

  it('--help lists command groups', () => {
    const out = run(['--help']);
    expect(out).toContain('Usage: noldor');
    expect(out).toContain('garden');
    expect(out).toContain('cr');
    expect(out).toContain('triage');
    expect(out).toContain('init');
    expect(out).toContain('doctor');
  });

  it('unknown group exits non-zero', () => {
    expect(() => run(['no-such-group'])).toThrow();
  });

  it('garden --help shows garden subcommands', () => {
    const out = run(['garden', '--help']);
    expect(out).toContain('detect');
    expect(out).toContain('receipt');
    expect(out).toContain('sdd-report');
  });

  it('autonomous --help shows run + queue-drain subcommands', () => {
    const out = run(['autonomous', '--help']);
    expect(out).toContain('run');
    expect(out).toContain('queue-drain');
  });

  it('subcommand --help prints usage without dispatching (no real drain)', () => {
    // Regression: `autonomous run --help` used to fall through to queue-drain.ts
    // and launch the real drain. The guard must short-circuit to usage + exit 0.
    const out = run(['autonomous', 'run', '--help']);
    expect(out).toContain('Usage: noldor autonomous run');
    expect(out).toContain('Drain a source autonomously');
  });

  it('subcommand -h short flag prints usage and exits 0', () => {
    const out = run(['autonomous', 'watch', '-h']);
    expect(out).toContain('Usage: noldor autonomous watch');
  });

  it('--help after a real flag still short-circuits (mid-args, not just leading)', () => {
    // Distinguishes this guard from a naive `sub === '--help'` check: the flag
    // can trail real args and must still print usage instead of dispatching.
    const out = run(['autonomous', 'run', '--source', 'roadmap', '--help']);
    expect(out).toContain('Usage: noldor autonomous run');
  });

  it('release --help documents the --resume flag', () => {
    const out = run(['release', '--help']);
    expect(out).toContain('Usage: noldor release');
    expect(out).toContain('--resume');
  });

  it('release run --help short-circuits before any release logic', () => {
    // Acceptance: the help guard at src/cli/index.ts:75 must keep printing
    // usage (now naming --resume) without dispatching into release/index.ts.
    const out = run(['release', 'run', '--help']);
    expect(out).toContain('Usage: noldor release run');
    expect(out).toContain('--resume');
  });

  it('leaf command dispatches with no subcommand (doctor)', () => {
    // doctor is a real leaf command now (template-sync check); assert it
    // dispatches and reports sync status rather than the old stub message.
    const out = run(['doctor']);
    expect(out).toContain('in sync');
  });

  it('leaf command dispatches with flag in sub slot (init --update)', () => {
    // Run in an isolated temp dir: `init --update` does real work now (copies
    // templates + stamps consumer.frameworkVersion), so running it in the repo
    // root would mutate the live .noldor/config.json and template-managed docs.
    const dir = mkdtempSync(join(tmpdir(), 'noldor-init-'));
    try {
      mkdirSync(join(dir, '.noldor'), { recursive: true });
      writeFileSync(join(dir, '.noldor/config.json'), JSON.stringify({ consumer: { name: 'x' } }));
      expect(() => run(['init', '--update'], dir)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init --update does NOT advance an existing framework anchor', () => {
    // Regression: a behind consumer (anchored 0.2.0) re-pulling templates via
    // `--update` must keep its anchor — advancing it here would skip the
    // migration chain and silently mark the tree current. Anchor advancement is
    // `noldor upgrade`'s job.
    const dir = mkdtempSync(join(tmpdir(), 'noldor-init-'));
    try {
      mkdirSync(join(dir, '.noldor'), { recursive: true });
      writeFileSync(
        join(dir, '.noldor/config.json'),
        JSON.stringify({ consumer: { name: 'x', frameworkVersion: '0.2.0' } }),
      );
      run(['init', '--update'], dir);
      const raw = JSON.parse(readFileSync(join(dir, '.noldor/config.json'), 'utf8'));
      expect(raw.consumer.frameworkVersion).toBe('0.2.0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
