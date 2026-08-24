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

/** Run an invocation expected to fail, returning its exit code + stderr. */
function runFail(args: string[], cwd?: string): { status: number; stderr: string } {
  try {
    execFileSync('node', [BIN, ...args], { encoding: 'utf8', cwd, stdio: 'pipe' });
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    return { status: err.status ?? -1, stderr: err.stderr ?? '' };
  }
  throw new Error(`expected 'noldor ${args.join(' ')}' to exit non-zero`);
}

/** A consumer repo whose only interesting property is its framework anchor. */
function anchoredConsumer(anchor: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-skew-'));
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  writeFileSync(
    join(dir, '.noldor/config.json'),
    JSON.stringify({
      consumer: anchor === null ? { name: 'x' } : { name: 'x', frameworkVersion: anchor },
    }),
  );
  return dir;
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

  // A stale scaffolded hook naming a removed subcommand is the state that cannot
  // self-diagnose: the consumer sees a commit die on `Unknown subcommand`, which
  // reads as a framework bug. These assert the diagnosis lands at that exact
  // point, since nothing routes such a consumer to `doctor`.
  it('diagnoses a behind anchor on an unknown subcommand and names both recovery commands', () => {
    const dir = anchoredConsumer('1.3.0');
    try {
      const { status, stderr } = runFail(['validate', 'no-such-sub'], dir);
      expect(status).toBe(1);
      expect(stderr).toContain('Unknown subcommand: validate no-such-sub');
      expect(stderr).toContain('framework version skew');
      expect(stderr).toContain('1.3.0');
      expect(stderr).toContain('noldor upgrade');
      expect(stderr).toContain('noldor init --update');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('diagnoses a behind anchor on an unknown group too', () => {
    const dir = anchoredConsumer('1.3.0');
    try {
      const { stderr } = runFail(['no-such-group'], dir);
      expect(stderr).toContain('Unknown command: no-such-group');
      expect(stderr).toContain('framework version skew');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stays quiet about skew when the anchor matches the installed version', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8')) as {
      version: string;
    };
    const dir = anchoredConsumer(pkg.version);
    try {
      const { stderr } = runFail(['validate', 'no-such-sub'], dir);
      expect(stderr).toContain('Unknown subcommand: validate no-such-sub');
      expect(stderr).not.toContain('framework version skew');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still reports the unknown command when there is no consumer config to read', () => {
    // No `.noldor/config.json` at all: the anchor reads as unset, which is a
    // skew, but the `Unknown subcommand` line must survive regardless.
    const dir = mkdtempSync(join(tmpdir(), 'noldor-skew-bare-'));
    try {
      const { status, stderr } = runFail(['validate', 'no-such-sub'], dir);
      expect(status).toBe(1);
      expect(stderr).toContain('Unknown subcommand: validate no-such-sub');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  it('release --help lists the publish subcommand', () => {
    const out = run(['release', '--help']);
    expect(out).toContain('publish');
    expect(out).toContain('--verify-tarball');
  });

  it('release publish --help short-circuits before any publish logic', () => {
    const out = run(['release', 'publish', '--help']);
    expect(out).toContain('Usage: noldor release publish');
    expect(out).toContain('--wait');
  });

  it('leaf command dispatches with no subcommand (doctor)', () => {
    // doctor is a real leaf command now (template-sync check); assert it
    // dispatches and reports sync status rather than the old stub message.
    // doctor probes every *referenced* agent runner (`<bin> --version`) on PATH.
    // Self-host `.noldor/config.json` targets claude+codex+opencode, and CI boxes
    // ship none of them, so shim all three for hermeticity — a prepended shim dir
    // wins over any real install, so this is deterministic on dev boxes too.
    const dir = mkdtempSync(join(tmpdir(), 'noldor-doctor-'));
    try {
      for (const bin of ['claude', 'codex', 'opencode']) {
        writeFileSync(join(dir, bin), '#!/bin/sh\necho 1.0.0\n', { mode: 0o755 });
      }
      const out = execFileSync('node', [BIN, 'doctor'], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}` },
      });
      expect(out).toContain('in sync');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
