// @tests: framework-script-test-migration-cleanup, specs-cr-gate-multi-reviewer
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const BIN = join(here, '..', '..', '..', 'bin', 'noldor.mjs');

function runValidate(cwd: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, 'validate', 'noldor-config'], {
    cwd,
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('noldor validate noldor-config', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'noldor-config-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('accepts a minimal valid .noldor/config.json', () => {
    mkdirSync(join(root, '.noldor'));
    writeFileSync(
      join(root, '.noldor', 'config.json'),
      JSON.stringify({ crLanes: { code: ['subagent'] } }),
    );
    const r = runValidate(root);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('.noldor/config.json valid');
  }, 30_000);

  it('rejects a malformed config with a readable error', () => {
    mkdirSync(join(root, '.noldor'));
    // crLanes lanes require at least one entry — zod .min(1) violation.
    writeFileSync(join(root, '.noldor', 'config.json'), JSON.stringify({ crLanes: { code: [] } }));
    const r = runValidate(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('.noldor/config.json INVALID:');
  }, 30_000);

  it('rejects a crLanes.spec / crLanes.plan set without the reviewer lane', () => {
    mkdirSync(join(root, '.noldor'));
    writeFileSync(
      join(root, '.noldor', 'config.json'),
      JSON.stringify({ crLanes: { spec: ['manual'], plan: ['manual'], code: ['verify'] } }),
    );
    const r = runValidate(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('.noldor/config.json INVALID:');
    expect(r.stderr).toContain('crLanes.spec / crLanes.plan');
    expect(r.stderr).toContain('must include the "reviewer" lane');
  }, 30_000);

  it('accepts a spec/plan lane set that includes reviewer (legacy name counts)', () => {
    mkdirSync(join(root, '.noldor'));
    writeFileSync(
      join(root, '.noldor', 'config.json'),
      JSON.stringify({ crLanes: { spec: ['manual', 'subagent'], plan: ['reviewer'] } }),
    );
    const r = runValidate(root);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('.noldor/config.json valid');
  }, 30_000);

  it('treats an absent config as OK (interactive mode only)', () => {
    const r = runValidate(root);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('absent (OK — interactive mode only)');
  }, 30_000);
});
