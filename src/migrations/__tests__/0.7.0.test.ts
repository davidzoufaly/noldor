// @tests: make-noldor-agent-agnostic
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migration_0_7_0 } from '../0.7.0.js';

function fakeConsumer(crLanes: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig070-'));
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  writeFileSync(
    join(dir, '.noldor', 'config.json'),
    JSON.stringify({ crLanes, other: 1 }, null, 2),
  );
  return dir;
}
const readCfg = (dir: string): { crLanes?: Record<string, string[]>; other?: number } =>
  JSON.parse(readFileSync(join(dir, '.noldor', 'config.json'), 'utf8'));

describe('migration 0.7.0 — crLanes values → role-refs', () => {
  it('rewrites subagent->reviewer and verify->verifier, preserving other keys', () => {
    const dir = fakeConsumer({ code: ['subagent', 'verify'], spec: ['subagent'] });
    migration_0_7_0.migrate(dir, {} as never);
    const c = readCfg(dir);
    expect(c.crLanes).toEqual({ code: ['reviewer', 'verifier'], spec: ['reviewer'] });
    expect(c.other).toBe(1);
  });

  it('dryRun reports the step without writing', () => {
    const dir = fakeConsumer({ code: ['subagent'] });
    const steps = migration_0_7_0.dryRun(dir, {} as never);
    expect(steps.length).toBe(1);
    expect(readCfg(dir).crLanes).toEqual({ code: ['subagent'] }); // untouched
  });

  it('is idempotent — a second migrate is a no-op (already canonical)', () => {
    const dir = fakeConsumer({ code: ['subagent'] });
    migration_0_7_0.migrate(dir, {} as never);
    const steps = migration_0_7_0.migrate(dir, {} as never);
    expect(steps.length).toBe(0);
    expect(readCfg(dir).crLanes).toEqual({ code: ['reviewer'] });
  });

  it('no-op when there is no crLanes block', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig070-'));
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    writeFileSync(join(dir, '.noldor', 'config.json'), JSON.stringify({ other: 1 }));
    expect(migration_0_7_0.migrate(dir, {} as never)).toEqual([]);
  });

  it('leaves non-legacy lane values untouched (manual/codex/standalone)', () => {
    const dir = fakeConsumer({ code: ['manual', 'codex', 'reviewer'] });
    const steps = migration_0_7_0.migrate(dir, {} as never);
    expect(steps.length).toBe(0);
    expect(readCfg(dir).crLanes).toEqual({ code: ['manual', 'codex', 'reviewer'] });
  });
});
