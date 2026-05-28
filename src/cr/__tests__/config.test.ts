import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';

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
});
