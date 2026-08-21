// @tests: framework-pr-flow-agent-auto-merge
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { evaluatePrePush, type PrePushInput } from '../noldor-pre-push.js';
import { readStdinWithTimeout, recordReleasePush } from '../noldor-pre-push.js';

// Resolved once, absolutely: `runHook` spawns with `cwd` set to a scratch tmpdir
// OUTSIDE this repo, so `npx tsx` cannot see `node_modules/.bin` and silently
// fetches tsx from the registry instead — which made these tests fail on any
// runner with a cold npx cache. Same idiom as the other CLI-spawning suites
// (src/design/__tests__/archive-cli.test.ts).
const TSX = join(process.cwd(), 'node_modules/.bin/tsx');

describe('evaluatePrePush', () => {
  it('allows push to feature branch', () => {
    const input: PrePushInput = {
      remoteName: 'origin',
      refLines: ['refs/heads/feature-x abc refs/heads/feature-x def'],
      env: {},
    };
    expect(evaluatePrePush(input)).toEqual({ ok: true });
  });

  it('allows push to tags', () => {
    const input: PrePushInput = {
      remoteName: 'origin',
      refLines: ['refs/tags/v0.5.0 abc refs/tags/v0.5.0 def'],
      env: {},
    };
    expect(evaluatePrePush(input)).toEqual({ ok: true });
  });

  it('allows push to non-origin remote even for main', () => {
    const input: PrePushInput = {
      remoteName: 'fork',
      refLines: ['refs/heads/main abc refs/heads/main def'],
      env: {},
    };
    expect(evaluatePrePush(input)).toEqual({ ok: true });
  });

  it('blocks push to origin/main without override', () => {
    const input: PrePushInput = {
      remoteName: 'origin',
      refLines: ['refs/heads/main abc refs/heads/main def'],
      env: {},
    };
    const result = evaluatePrePush(input);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/blocked by Noldor PR flow/);
  });

  it('allows push to origin/main with NOLDOR_RELEASE_PUSH=1', () => {
    const input: PrePushInput = {
      remoteName: 'origin',
      refLines: ['refs/heads/main abc refs/heads/main def'],
      env: { NOLDOR_RELEASE_PUSH: '1' },
    };
    expect(evaluatePrePush(input)).toEqual({ ok: true, override: 'release' });
  });

  it('blocks push when one of multiple refs is origin/main', () => {
    const input: PrePushInput = {
      remoteName: 'origin',
      refLines: [
        'refs/heads/feature-x abc refs/heads/feature-x def',
        'refs/heads/main abc refs/heads/main def',
      ],
      env: {},
    };
    const result = evaluatePrePush(input);
    expect(result.ok).toBe(false);
  });

  it('blocks "git push origin feature-x:main" (local=feature, REMOTE=main)', () => {
    const input: PrePushInput = {
      remoteName: 'origin',
      refLines: ['refs/heads/feature-x abc refs/heads/main def'],
      env: {},
    };
    const result = evaluatePrePush(input);
    expect(result.ok).toBe(false);
  });

  it('allows "git push origin main:feature-x" (local=main, REMOTE=feature) — destination is not main', () => {
    const input: PrePushInput = {
      remoteName: 'origin',
      refLines: ['refs/heads/main abc refs/heads/feature-x def'],
      env: {},
    };
    expect(evaluatePrePush(input)).toEqual({ ok: true });
  });
});

describe('recordReleasePush', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'pp-test-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('creates .noldor/ + writes a receipt line', () => {
    recordReleasePush({ cwd, iso: '2026-05-15T10:00:00Z', sha: 'abc123', version: '0.5.0' });
    const logPath = join(cwd, '.noldor', 'release-pushes.log');
    expect(existsSync(logPath)).toBe(true);
    const content = readFileSync(logPath, 'utf8');
    expect(content).toBe('2026-05-15T10:00:00Z abc123 0.5.0\n');
  });

  it('appends across multiple calls', () => {
    recordReleasePush({ cwd, iso: '2026-05-15T10:00:00Z', sha: 'abc123', version: '0.5.0' });
    recordReleasePush({ cwd, iso: '2026-05-16T11:00:00Z', sha: 'def456', version: '0.5.1' });
    const content = readFileSync(join(cwd, '.noldor', 'release-pushes.log'), 'utf8');
    expect(content).toBe('2026-05-15T10:00:00Z abc123 0.5.0\n2026-05-16T11:00:00Z def456 0.5.1\n');
  });
});

describe('readStdinWithTimeout', () => {
  it('resolves with stdin contents when end fires before deadline', async () => {
    const stream = Readable.from(['refs/heads/x abc refs/heads/x def\n']);
    const result = await readStdinWithTimeout(stream, 100);
    expect(result).toEqual({
      ok: true,
      data: 'refs/heads/x abc refs/heads/x def\n',
    });
  });

  it('rejects with timed-out marker when no end event within deadline', async () => {
    const stream = new Readable({ read() {} });
    const result = await readStdinWithTimeout(stream, 50);
    expect(result).toEqual({ ok: false, reason: 'timeout' });
  });

  it('rejects with stream-error marker when stream emits error before end', async () => {
    const stream = new Readable({ read() {} });
    const promise = readStdinWithTimeout(stream, 500);
    queueMicrotask(() => stream.emit('error', new Error('upstream broke')));
    const result = await promise;
    expect(result).toEqual({ ok: false, reason: 'stream-error' });
  });
});

// ---------------------------------------------------------------------------
// Orchestration: the hook end-to-end over real commit objects.
//
// Subprocess rather than a direct `main()` call: these drive the real
// entrypoint with real stdin against real repositories.
// ---------------------------------------------------------------------------

function sh(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-prepush-orch-'));
  sh(dir, ['init', '-q']);
  sh(dir, ['config', 'user.email', 't@example.com']);
  sh(dir, ['config', 'user.name', 't']);
  mkdirSync(join(dir, '.git/info'), { recursive: true });
  writeFileSync(join(dir, '.git/info/exclude'), '.noldor/\n');
  writeFileSync(join(dir, 'README.md'), 'seed\n');
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '--no-verify', '-m', 'docs: seed']);
  return dir;
}

function addCode(dir: string, name: string, message: string): string {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, `src/${name}.ts`), `export const ${name} = 1;\n`);
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '--no-verify', '-m', message]);
  return sh(dir, ['rev-parse', 'HEAD']);
}

function runHook(
  dir: string,
  refLines: string,
  opts: { remote?: string; env?: Record<string, string> } = {},
): { status: number; stderr: string } {
  const entry = join(process.cwd(), 'src/hooks/noldor-pre-push.ts');
  const r = spawnSync(TSX, [entry, opts.remote ?? 'origin'], {
    cwd: dir,
    encoding: 'utf8',
    input: refLines,
    env: { ...process.env, ...opts.env },
  });
  return { status: r.status ?? 1, stderr: r.stderr ?? '' };
}

const ZEROES = '0'.repeat(40);

describe('pre-push orchestration', () => {
  it('rejects a direct origin/main push', () => {
    const dir = scratch();
    const sha = addCode(dir, 'a', 'feat: silent change');
    const r = runHook(dir, `refs/heads/main ${sha} refs/heads/main ${ZEROES}\n`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Direct push to origin/main is blocked');
  });

  it('passes a feature push regardless of commit-body shape (bodies are free-form)', () => {
    const dir = scratch();
    const sha = addCode(dir, 'a', 'feat: silent change');
    expect(runHook(dir, `refs/heads/f ${sha} refs/heads/f ${ZEROES}\n`).status).toBe(0);
  });

  it('exits 2 on a malformed ref line', () => {
    const dir = scratch();
    const r = runHook(dir, 'refs/heads/f abc refs/heads/f\n');
    expect(r.status).toBe(2);
  });

  it('writes the release receipt under the release override', () => {
    const dir = scratch();
    const sha = addCode(dir, 'a', 'feat: release push');
    const r = runHook(dir, `refs/heads/main ${sha} refs/heads/main ${ZEROES}\n`, {
      env: { NOLDOR_RELEASE_PUSH: '1' },
    });
    expect(r.status).toBe(0);
    expect(existsSync(join(dir, '.noldor/release-pushes.log'))).toBe(true);
  });
});
