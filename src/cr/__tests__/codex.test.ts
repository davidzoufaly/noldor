// @tests: noldor
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../codex.js';

function makeRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'cr-codex-cli-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd });
  spawnSync('git', ['config', 'user.email', 'a@b'], { cwd });
  spawnSync('git', ['config', 'user.name', 'a'], { cwd });
  writeFileSync(join(cwd, 'a.ts'), 'export const x = 1\n');
  spawnSync('git', ['add', '.'], { cwd });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd });
  return cwd;
}

const passing = JSON.stringify({ blockers: [], suggestions: [], summary: 'ok' });
const blocker = JSON.stringify({
  blockers: [{ file: 'a.ts', message: 'bug', line: null, severity: null, suggestion: null }],
  suggestions: [],
  summary: 'no',
});

describe('runCli', () => {
  it('gate lane writes trailer when codex returns zero blockers', async () => {
    const cwd = makeRepo();
    const code = await runCli({
      argv: [],
      cwd,
      spawn: async () => ({ stdout: passing, exitCode: 0 }),
    });
    expect(code).toBe(0);
    const msg = spawnSync('git', ['show', '-s', '--format=%B', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    }).stdout;
    expect(msg).toMatch(/Noldor-Reviewed-Codex: [a-f0-9]{40}/);
  });

  it('gate lane: blocker output → no trailer, exit 1', async () => {
    const cwd = makeRepo();
    const code = await runCli({
      argv: [],
      cwd,
      spawn: async () => ({ stdout: blocker, exitCode: 0 }),
    });
    expect(code).toBe(1);
    const msg = spawnSync('git', ['show', '-s', '--format=%B', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    }).stdout;
    expect(msg).not.toMatch(/Noldor-Reviewed-Codex/);
  });

  it('--dry-run never writes a trailer even on pass', async () => {
    const cwd = makeRepo();
    const code = await runCli({
      argv: ['--dry-run'],
      cwd,
      spawn: async () => ({ stdout: passing, exitCode: 0 }),
    });
    expect(code).toBe(0);
    const msg = spawnSync('git', ['show', '-s', '--format=%B', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    }).stdout;
    expect(msg).not.toMatch(/Noldor-Reviewed-Codex/);
    const dir = join(cwd, '.noldor', 'cr-records');
    expect(existsSync(dir) ? readdirSync(dir).length : 0).toBe(0);
  });

  it('gate lane skips when trailer already present and --rerun absent', async () => {
    const cwd = makeRepo();
    // First run lands the trailer
    await runCli({ argv: [], cwd, spawn: async () => ({ stdout: passing, exitCode: 0 }) });
    // Second run without --rerun → should skip
    let spawnCount = 0;
    const code = await runCli({
      argv: [],
      cwd,
      spawn: async () => {
        spawnCount++;
        return { stdout: passing, exitCode: 0 };
      },
    });
    expect(code).toBe(0);
    expect(spawnCount).toBe(0);
  });

  it('gate lane re-runs when --rerun is passed', async () => {
    const cwd = makeRepo();
    await runCli({ argv: [], cwd, spawn: async () => ({ stdout: passing, exitCode: 0 }) });
    let spawnCount = 0;
    const code = await runCli({
      argv: ['--rerun'],
      cwd,
      spawn: async () => {
        spawnCount++;
        return { stdout: passing, exitCode: 0 };
      },
    });
    expect(code).toBe(0);
    expect(spawnCount).toBe(1);
  });

  it('--working writes a working- prefixed sidecar, no trailer', async () => {
    const cwd = makeRepo();
    const code = await runCli({
      argv: ['--working'],
      cwd,
      spawn: async () => ({ stdout: passing, exitCode: 0 }),
    });
    expect(code).toBe(0);
    const dir = join(cwd, '.noldor', 'cr-records');
    const files = existsSync(dir) ? readdirSync(dir) : [];
    expect(files.some((f: string) => f.startsWith('working-'))).toBe(true);
    const msg = spawnSync('git', ['show', '-s', '--format=%B', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    }).stdout;
    expect(msg).not.toMatch(/Noldor-Reviewed-Codex/);
  });

  it('positional <sha> never amends', async () => {
    const cwd = makeRepo();
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).stdout.trim();
    const code = await runCli({
      argv: [head],
      cwd,
      spawn: async () => ({ stdout: passing, exitCode: 0 }),
    });
    expect(code).toBe(0);
    const msg = spawnSync('git', ['show', '-s', '--format=%B', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    }).stdout;
    expect(msg).not.toMatch(/Noldor-Reviewed-Codex/);
  });
});
