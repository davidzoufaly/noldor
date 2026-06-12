import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  autonomousConfigSchema,
  loadConfig,
  loadConfigSync,
  noldorConfigSchema,
  resolveSessionTtlHours,
  DEFAULT_SESSION_TTL_HOURS,
} from '../config.js';

describe('agents block', () => {
  it('parses an agents block and leaves it optional', () => {
    const parsed = noldorConfigSchema.parse({
      agents: { default: 'claude', roles: { reviewer: { runner: 'codex' } } },
    });
    expect(parsed.agents?.roles.reviewer?.runner).toBe('codex');
    expect(noldorConfigSchema.parse({}).agents).toBeUndefined();
  });
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cfg-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('returns null when file is absent', async () => {
    expect(await loadConfig(join(dir, 'absent.json'))).toBeNull();
  });
  it('parses a valid config', async () => {
    const path = join(dir, 'config.json');
    await writeFile(
      path,
      JSON.stringify({
        crLanes: { spec: ['subagent'], plan: ['subagent', 'manual'], code: ['subagent'] },
        autonomous: { skipLanePicker: true, onFailure: 'prompt', requireHumanPrApproval: false },
      }),
      'utf8',
    );
    const cfg = await loadConfig(path);
    expect(cfg?.crLanes?.spec).toEqual(['subagent']);
    expect(cfg?.autonomous?.onFailure).toBe('prompt');
  });
  it('applies defaults to autonomous when partially set', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ autonomous: {} }), 'utf8');
    const cfg = await loadConfig(path);
    expect(cfg?.autonomous?.skipLanePicker).toBe(false);
    expect(cfg?.autonomous?.onFailure).toBe('prompt');
  });
  it('rejects invalid lane in crLanes', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ crLanes: { spec: ['bogus'] } }), 'utf8');
    await expect(loadConfig(path)).rejects.toThrow();
  });
  it('rejects empty crLanes array', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ crLanes: { spec: [] } }), 'utf8');
    await expect(loadConfig(path)).rejects.toThrow();
  });
  it('parses the optional gate.sessionTtlHours block', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ gate: { sessionTtlHours: 6 } }), 'utf8');
    const cfg = await loadConfig(path);
    expect(cfg?.gate?.sessionTtlHours).toBe(6);
  });
  it('rejects a non-positive gate.sessionTtlHours', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ gate: { sessionTtlHours: 0 } }), 'utf8');
    await expect(loadConfig(path)).rejects.toThrow();
  });
});

describe('loadConfigSync', () => {
  it('returns null when file is absent', () => {
    expect(loadConfigSync(join(dir, 'absent.json'))).toBeNull();
  });
  it('parses a valid config synchronously', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ gate: { sessionTtlHours: 12 } }), 'utf8');
    expect(loadConfigSync(path)?.gate?.sessionTtlHours).toBe(12);
  });
  it('throws on a malformed config (strict, mirrors loadConfig)', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ gate: { sessionTtlHours: -1 } }), 'utf8');
    expect(() => loadConfigSync(path)).toThrow();
  });
});

describe('resolveSessionTtlHours', () => {
  it('returns the configured value when gate.sessionTtlHours is set', () => {
    expect(resolveSessionTtlHours({ gate: { sessionTtlHours: 6 } })).toBe(6);
  });
  it('falls back to the default when the gate block is absent', () => {
    expect(resolveSessionTtlHours({})).toBe(DEFAULT_SESSION_TTL_HOURS);
  });
  it('falls back to the default when config is null', () => {
    expect(resolveSessionTtlHours(null)).toBe(DEFAULT_SESSION_TTL_HOURS);
  });
  it('DEFAULT_SESSION_TTL_HOURS is 24', () => {
    expect(DEFAULT_SESSION_TTL_HOURS).toBe(24);
  });
});

describe('autonomous.watch rails schema', () => {
  it('defaults interval/caps and accepts notifyCommand', () => {
    const parsed = autonomousConfigSchema.parse({ watch: {} });
    expect(parsed.watch).toEqual({
      intervalMinutes: 30,
      maxFeaturesPerDay: 10,
      maxConsecutiveFailures: 3,
    });
    const withCmd = autonomousConfigSchema.parse({ watch: { notifyCommand: 'true' } });
    expect(withCmd.watch?.notifyCommand).toBe('true');
  });

  it('keeps watch optional and rejects non-positive rails', () => {
    expect(autonomousConfigSchema.parse({}).watch).toBeUndefined();
    expect(() => autonomousConfigSchema.parse({ watch: { intervalMinutes: 0 } })).toThrow();
  });
});
