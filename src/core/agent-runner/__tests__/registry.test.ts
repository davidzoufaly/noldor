// @tests: make-noldor-agent-agnostic
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
