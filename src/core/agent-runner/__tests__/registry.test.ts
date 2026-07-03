// @tests: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, drain-startup-reconciliation-of-a-prior-dead-run, make-noldor-agent-agnostic, parallel-agent-dispatch-for-research-jobs
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_ROLES, agentsConfigSchema } from '../types';
import { loadAgentsConfig, resolveRunner, spawnAgent } from '../registry';

function tmpConfig(agents?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-registry-'));
  mkdirSync(join(dir, '.noldor'));
  const body = agents === undefined ? {} : { agents };
  writeFileSync(join(dir, '.noldor', 'config.json'), JSON.stringify(body), 'utf8');
  return dir;
}

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stdinEnded = '';
  stdin = {
    on: vi.fn(),
    end: (s?: string) => {
      this.stdinEnded = s ?? '';
    },
  };
  killed: string | null = null;
  kill(sig: string) {
    this.killed = sig;
    this.emit('close', null);
  }
}

function fakeSpawn() {
  const calls: Array<{ bin: string; argv: string[]; opts: Record<string, unknown> }> = [];
  let child: FakeChild | undefined;
  const impl = vi.fn((bin: string, argv: string[], opts: Record<string, unknown>) => {
    calls.push({ bin, argv, opts });
    child = new FakeChild();
    return child as never;
  });
  return { impl, calls, child: () => child! };
}

describe('loadAgentsConfig', () => {
  it('defaults when file or block missing', () => {
    expect(loadAgentsConfig(mkdtempSync(join(tmpdir(), 'noldor-empty-')))).toEqual(
      agentsConfigSchema.parse({}),
    );
    expect(loadAgentsConfig(tmpConfig())).toEqual(agentsConfigSchema.parse({}));
  });
  it('throws loudly on a malformed agents block', () => {
    expect(() => loadAgentsConfig(tmpConfig({ default: 'gemini' }))).toThrow();
  });
});

describe('resolveRunner', () => {
  const cfg = agentsConfigSchema.parse({
    default: 'claude',
    roles: { polish: { runner: 'opencode', model: 'ollama/x' } },
  });
  it('uses role config when present', () => {
    expect(resolveRunner('polish', cfg)).toEqual({ runner: 'opencode', model: 'ollama/x' });
  });
  it('falls back to default', () => {
    expect(resolveRunner('reviewer', cfg)).toEqual({ runner: 'claude' });
  });
  it('researcher is a declared role that defaults to claude', () => {
    expect(AGENT_ROLES).toContain('researcher');
    expect(resolveRunner('researcher', agentsConfigSchema.parse({}))).toEqual({
      runner: 'claude',
    });
  });
});

describe('spawnAgent', () => {
  it('claude default: canonical argv, prompt on argv, stdin ignored, event written', async () => {
    const dir = tmpConfig();
    const f = fakeSpawn();
    const p = spawnAgent(
      'hello',
      { role: 'implementer', cwd: dir, site: 't' },
      { spawnImpl: f.impl as never },
    );
    f.child().stdout.emit('data', Buffer.from('out'));
    f.child().emit('close', 0);
    const r = await p;
    expect(r).toEqual({ exitCode: 0, stdout: 'out', timedOut: false });
    expect(f.calls[0]!.bin).toBe('claude');
    expect(f.calls[0]!.argv).toEqual([
      '--print',
      'hello',
      '--disallowed-tools',
      'AskUserQuestion',
      '--permission-mode',
      'bypassPermissions',
    ]);
    expect((f.calls[0]!.opts.stdio as string[])[0]).toBe('ignore');
    const line = readFileSync(join(dir, '.noldor', 'agent-events.jsonl'), 'utf8').trim();
    expect(JSON.parse(line)).toMatchObject({
      runner: 'claude',
      role: 'implementer',
      site: 't',
      exitCode: 0,
    });
  });

  it('runner pin wins over role config; codex prompt goes to stdin', async () => {
    const dir = tmpConfig({ roles: { 'second-opinion': { runner: 'opencode' } } });
    const f = fakeSpawn();
    const p = spawnAgent(
      'judge',
      { role: 'second-opinion', runner: 'codex', schemaPath: '/s.json', cwd: dir },
      { spawnImpl: f.impl as never },
    );
    f.child().emit('close', 0);
    await p;
    expect(f.calls[0]!.bin).toBe('codex');
    expect(f.calls[0]!.argv).toContain('--output-schema');
    expect((f.calls[0]!.opts.stdio as string[])[0]).toBe('pipe');
    expect(f.child().stdinEnded).toBe('judge');
  });

  it('capability mismatch: schemaPath on a non-schema runner rejects before spawning', async () => {
    const dir = tmpConfig({ roles: { 'second-opinion': { runner: 'opencode' } } });
    const f = fakeSpawn();
    await expect(
      spawnAgent(
        'x',
        { role: 'second-opinion', schemaPath: '/s.json', cwd: dir },
        { spawnImpl: f.impl as never },
      ),
    ).rejects.toThrow(/capability-mismatch.*opencode/);
    expect(f.impl).not.toHaveBeenCalled();
  });

  it('timeout SIGKILLs and resolves timedOut', async () => {
    vi.useFakeTimers();
    const dir = tmpConfig();
    const f = fakeSpawn();
    const p = spawnAgent(
      'slow',
      { role: 'implementer', cwd: dir, timeoutMs: 50 },
      { spawnImpl: f.impl as never },
    );
    vi.advanceTimersByTime(60);
    const r = await p;
    expect(r.timedOut).toBe(true);
    expect(f.child().killed).toBe('SIGKILL');
    vi.useRealTimers();
  });

  it('spawns detached, surfaces pgid via onSpawn, group-kills the process group on timeout', async () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true as never);
    const dir = tmpConfig();
    const child = new FakeChild();
    (child as unknown as { pid: number }).pid = 4242;
    const calls: Array<Record<string, unknown>> = [];
    const impl = vi.fn((_bin: string, _argv: string[], opts: Record<string, unknown>) => {
      calls.push(opts);
      return child as never;
    });
    const seen: number[] = [];
    const p = spawnAgent(
      'slow',
      { role: 'implementer', cwd: dir, timeoutMs: 50, onSpawn: (pgid) => seen.push(pgid) },
      { spawnImpl: impl as never },
    );
    expect(calls[0]!.detached).toBe(true);
    expect(seen).toEqual([4242]);
    vi.advanceTimersByTime(60); // fire timeout → group-kill
    child.emit('close', null); // group-kill is mocked (no real signal) → settle the promise
    const r = await p;
    expect(r.timedOut).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGKILL');
    expect(child.killed).toBeNull(); // group-kill succeeded → no direct child.kill fallback
    killSpy.mockRestore();
    vi.useRealTimers();
  });

  it('spawn error rejects with spawn-failed', async () => {
    const dir = tmpConfig();
    const f = fakeSpawn();
    const p = spawnAgent('x', { role: 'implementer', cwd: dir }, { spawnImpl: f.impl as never });
    f.child().emit('error', new Error('ENOENT'));
    await expect(p).rejects.toThrow(/spawn-failed: ENOENT/);
  });

  it('opencode role with model builds --model argv', async () => {
    const dir = tmpConfig({ roles: { polish: { runner: 'opencode', model: 'ollama/x' } } });
    const f = fakeSpawn();
    const p = spawnAgent('p', { role: 'polish', cwd: dir }, { spawnImpl: f.impl as never });
    f.child().emit('close', 0);
    await p;
    expect(f.calls[0]!.bin).toBe('opencode');
    expect(f.calls[0]!.argv).toEqual([
      'run',
      'p',
      '--dangerously-skip-permissions',
      '--model',
      'ollama/x',
    ]);
    expect(existsSync(join(dir, '.noldor', 'agent-events.jsonl'))).toBe(true);
  });
});

describe('agent-event vocabulary (spawned/exited pairing + runId)', () => {
  function pidChild(pid: number): FakeChild {
    const child = new FakeChild();
    (child as unknown as { pid: number }).pid = pid;
    return child;
  }
  function readRows(dir: string): Array<Record<string, unknown>> {
    return readFileSync(join(dir, '.noldor', 'agent-events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  }

  it('writes a spawned and an exited row sharing one spawnId, with pid and slug', async () => {
    const dir = tmpConfig();
    const child = pidChild(7777);
    const impl = vi.fn(() => child as never);
    const p = spawnAgent(
      'hello',
      { role: 'implementer', cwd: dir, site: 'drain.spawnGate', slug: 'my-slug' },
      { spawnImpl: impl as never },
    );
    child.emit('close', 0);
    await p;
    const rows = readRows(dir);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      event: 'spawned',
      runner: 'claude',
      role: 'implementer',
      site: 'drain.spawnGate',
      slug: 'my-slug',
      pid: 7777,
    });
    expect(rows[1]).toMatchObject({ event: 'exited', exitCode: 0, slug: 'my-slug' });
    expect(typeof rows[0]!.spawnId).toBe('string');
    expect(rows[1]!.spawnId).toBe(rows[0]!.spawnId);
    expect(rows[0]!.exitCode).toBeUndefined();
    expect(rows[0]!.durationMs).toBeUndefined();
  });

  it('stamps runId from opts.env.NOLDOR_RUN_ID on both rows', async () => {
    const dir = tmpConfig();
    const child = pidChild(4001);
    const impl = vi.fn(() => child as never);
    const p = spawnAgent(
      'x',
      { role: 'implementer', cwd: dir, env: { NOLDOR_RUN_ID: 'opts-run' } },
      { spawnImpl: impl as never },
    );
    child.emit('close', 0);
    await p;
    const rows = readRows(dir);
    expect(rows[0]).toMatchObject({ event: 'spawned', runId: 'opts-run' });
    expect(rows[1]).toMatchObject({ event: 'exited', runId: 'opts-run' });
  });

  it('falls back to process.env.NOLDOR_RUN_ID (nested-spawn transport, spec D1)', async () => {
    vi.stubEnv('NOLDOR_RUN_ID', 'ambient-run');
    try {
      const dir = tmpConfig();
      const child = pidChild(4002);
      const impl = vi.fn(() => child as never);
      const p = spawnAgent('x', { role: 'implementer', cwd: dir }, { spawnImpl: impl as never });
      child.emit('close', 0);
      await p;
      const rows = readRows(dir);
      expect(rows[0]).toMatchObject({ event: 'spawned', runId: 'ambient-run' });
      expect(rows[1]).toMatchObject({ event: 'exited', runId: 'ambient-run' });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('mints a fresh spawnId per call (no cross-spawn pairing)', async () => {
    const dir = tmpConfig();
    const a = pidChild(5001);
    const b = pidChild(5002);
    const children = [a, b];
    const impl = vi.fn(() => children.shift() as never);
    const pa = spawnAgent('a', { role: 'implementer', cwd: dir }, { spawnImpl: impl as never });
    a.emit('close', 0);
    await pa;
    const pb = spawnAgent('b', { role: 'implementer', cwd: dir }, { spawnImpl: impl as never });
    b.emit('close', 0);
    await pb;
    const rows = readRows(dir);
    expect(rows).toHaveLength(4);
    expect(rows[0]!.spawnId).toBe(rows[1]!.spawnId);
    expect(rows[2]!.spawnId).toBe(rows[3]!.spawnId);
    expect(rows[0]!.spawnId).not.toBe(rows[2]!.spawnId);
  });
});

describe('verifier role', () => {
  it('is a registered role and resolves to the default runner when unmapped', () => {
    expect(AGENT_ROLES).toContain('verifier');
    const cfg = agentsConfigSchema.parse({});
    expect(resolveRunner('verifier', cfg)).toEqual({ runner: 'claude' });
  });

  it('can be remapped via agents.roles like any role', () => {
    const cfg = agentsConfigSchema.parse({ roles: { verifier: { runner: 'opencode' } } });
    expect(resolveRunner('verifier', cfg)).toEqual({ runner: 'opencode' });
  });
});
