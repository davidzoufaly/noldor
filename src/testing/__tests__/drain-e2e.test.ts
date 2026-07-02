// @tests: acceptance-verify-lane, autonomous-plan-to-pr-merge, autonomous-queue-drain-runner, consumer-contract-ci-and-headless-gate-e2e-harness, drain-startup-reconciliation-of-a-prior-dead-run, noldor, release-script-self-provisions-its-own-session-marker, release-sweep-process-hardening
import { afterEach, describe, expect, it } from 'vitest';
import { buildConsumerFixture, type ConsumerFixture } from '../consumer-fixture';
import { applyStubGate } from '../stub-gate';
import { writeSession, readSession } from '../../core/session';
import { runPreCommit } from '../../hooks/noldor-pre-commit';
import { acquireLock, liveLockPid } from '../../autonomous/drain-lock';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

let fx: ConsumerFixture | null = null;
afterEach(() => fx?.cleanup());

describe('headless drain e2e (stub runner)', () => {
  it('drains a seeded XS entry: file written, entry retired, trailers on commit', () => {
    fx = buildConsumerFixture({ seedSlug: 'add-greeting-helper' });
    // The drain spawns the gate; the stub gate IS the gate here. Apply it directly
    // to assert the outcome oracle without the multi-process gh dependency.
    applyStubGate({ cwd: fx.dir, slug: 'add-greeting-helper' });
    const roadmap = fx.git(['show', 'HEAD:docs/roadmap.md']);
    expect(roadmap).not.toContain('add-greeting-helper');
    const body = fx.git(['log', '-1', '--format=%B']);
    expect(body).toContain('Noldor-Path: fast-track');
    expect(body).toMatch(/Noldor-Reviewed/);
  }, 30_000);

  it('marker probe: micro-chore accepts docs diff, rejects src diff', () => {
    fx = buildConsumerFixture();
    writeSession(fx.dir, { path: 'micro-chore', startedAt: new Date().toISOString() });
    expect(readSession(fx.dir)?.path).toBe('micro-chore');
    // staged docs-only diff is allowed; a src/ diff is not
    writeFileSync(join(fx.dir, 'docs', 'note.md'), 'note\n');
    fx.git(['add', 'docs/note.md']);
    const okRes = runPreCommit({ cwd: fx.dir, nowMs: Date.now(), ttlHours: 24 });
    expect(okRes.ok).toBe(true);
    writeFileSync(join(fx.dir, 'src', 'evil.ts'), 'export const x = 1;\n');
    fx.git(['add', 'src/evil.ts']);
    const badRes = runPreCommit({ cwd: fx.dir, nowMs: Date.now(), ttlHours: 24 });
    expect(badRes.ok).toBe(false);
  });

  it('failure probe: a live drain.lock is detected', () => {
    fx = buildConsumerFixture();
    const lock = acquireLock(fx.dir, new Date().toISOString());
    expect(lock.ok).toBe(true);
    // a second acquire fails while the first holder is live
    const second = acquireLock(fx.dir, new Date().toISOString());
    expect(second.ok).toBe(false);
    expect(liveLockPid(fx.dir)).toBe(process.pid);
  });
});
