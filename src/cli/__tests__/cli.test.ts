import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// @tests: noldor-package-lift

const BIN = resolve(__dirname, '../../../bin/noldor.mjs');

function run(args: string[]): string {
  return execFileSync('node', [BIN, ...args], { encoding: 'utf8' });
}

describe('noldor CLI', () => {
  it('prints version on --version', () => {
    expect(run(['--version']).trim()).toBe('noldor v0');
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

  it('leaf command dispatches with no subcommand (doctor)', () => {
    // doctor is a real leaf command now (template-sync check); assert it
    // dispatches and reports sync status rather than the old stub message.
    const out = run(['doctor']);
    expect(out).toContain('in sync');
  });

  it('leaf command dispatches with flag in sub slot (init --update stub)', () => {
    // init stub writes to stderr; capture combined output via execFileSync's
    // default behavior (stderr flows through). Just assert it doesn't throw
    // (exit 0).
    expect(() => run(['init', '--update'])).not.toThrow();
  });
});
