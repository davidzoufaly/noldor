import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { evaluatePrePush, type PrePushInput } from '../noldor-pre-push.js';
import { readStdinWithTimeout, recordReleasePush } from '../noldor-pre-push.js';

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
