// @tests: parallel-agent-dispatch-for-research-jobs
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTasks, parseArgs, run, type SpawnAgentLike } from '../fanout';

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'research-fanout-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const NOW = new Date('2026-07-01T14:22:33.000Z');

function okSpawn(headline = 'answer'): SpawnAgentLike {
  return vi.fn(async () => ({
    exitCode: 0,
    stdout: `Findings body.\n\n\`\`\`json\n{"status":"answered","headline":"${headline}"}\n\`\`\``,
    timedOut: false,
  }));
}

describe('parseArgs', () => {
  it('defaults: max 4, timeout 900000, no flags', () => {
    const a = parseArgs([]);
    expect(a).toMatchObject({
      max: 4,
      timeoutMs: 900_000,
      synthesize: false,
      dryRun: false,
      json: false,
      inlineTasks: [],
    });
  });

  it('collects repeated --task and parses flags', () => {
    const a = parseArgs([
      '--task',
      'q1',
      '--task',
      'q2',
      '--max',
      '2',
      '--timeout',
      '1000',
      '--synthesize',
      '--dry-run',
      '--json',
      '--tasks',
      't.json',
    ]);
    expect(a.inlineTasks).toEqual(['q1', 'q2']);
    expect(a).toMatchObject({
      max: 2,
      timeoutMs: 1000,
      synthesize: true,
      dryRun: true,
      json: true,
      tasksFile: 't.json',
    });
  });

  it('throws on unknown flag', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/unknown flag/);
  });

  it('rejects a flag as a consumed value', () => {
    expect(() => parseArgs(['--task', '--synthesize'])).toThrow(/--task requires a value/);
    expect(() => parseArgs(['--tasks'])).toThrow(/--tasks requires a value/);
  });
});

describe('loadTasks', () => {
  it('namespaces inline tasks as cli-task-<n> and concatenates after the file', () => {
    writeFileSync(
      join(cwd, 't.json'),
      JSON.stringify({ tasks: [{ id: 'task-1', question: 'from file' }] }),
      'utf8',
    );
    const tasks = loadTasks(parseArgs(['--tasks', 't.json', '--task', 'inline q']), cwd);
    expect(tasks.map((t) => t.id)).toEqual(['task-1', 'cli-task-1']);
  });

  it('throws on duplicate ids', () => {
    writeFileSync(
      join(cwd, 't.json'),
      JSON.stringify({
        tasks: [
          { id: 'a', question: 'q' },
          { id: 'a', question: 'q2' },
        ],
      }),
      'utf8',
    );
    expect(() => loadTasks(parseArgs(['--tasks', 't.json']), cwd)).toThrow(/duplicate task id/);
  });

  it('throws when no tasks are given', () => {
    expect(() => loadTasks(parseArgs([]), cwd)).toThrow(/no tasks/);
  });
});

describe('run', () => {
  it('all-ok: writes findings + INDEX + manifest, exits 0', async () => {
    const spawn = okSpawn();
    const code = await run(['--task', 'q1', '--task', 'q2'], {
      cwd,
      now: () => NOW,
      spawnAgentImpl: spawn,
    });
    expect(code).toBe(0);
    const batch = join(cwd, '.noldor', 'research', '2026-07-01-142233');
    expect(existsSync(join(batch, 'cli-task-1.findings.md'))).toBe(true);
    expect(existsSync(join(batch, 'INDEX.md'))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(batch, 'manifest.json'), 'utf8'));
    expect(manifest.results).toHaveLength(2);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('a rejected spawn fails only its task — batch completes, exit 1', async () => {
    let call = 0;
    const spawn: SpawnAgentLike = vi.fn(async () => {
      call++;
      if (call === 1) throw new Error('spawn-failed: ENOENT');
      return {
        exitCode: 0,
        stdout: 'ok\n```json\n{"status":"answered","headline":"h"}\n```',
        timedOut: false,
      };
    });
    const code = await run(['--task', 'q1', '--task', 'q2'], {
      cwd,
      now: () => NOW,
      spawnAgentImpl: spawn,
    });
    expect(code).toBe(1);
    const manifest = JSON.parse(
      readFileSync(join(cwd, '.noldor', 'research', '2026-07-01-142233', 'manifest.json'), 'utf8'),
    );
    const statuses = manifest.results.map((r: { spawnStatus: string }) => r.spawnStatus).toSorted();
    expect(statuses[0]).toMatch(/^error: spawn-failed/);
    expect(statuses[1]).toBe('ok');
  });

  it('unparseable stdout: raw preserved, exit 1', async () => {
    const spawn: SpawnAgentLike = vi.fn(async () => ({
      exitCode: 0,
      stdout: 'no fence here',
      timedOut: false,
    }));
    const code = await run(['--task', 'q1'], { cwd, now: () => NOW, spawnAgentImpl: spawn });
    expect(code).toBe(1);
    const findings = readFileSync(
      join(cwd, '.noldor', 'research', '2026-07-01-142233', 'cli-task-1.findings.md'),
      'utf8',
    );
    expect(findings).toContain('no fence here');
  });

  it('dry-run lists tasks and spawns nothing', async () => {
    const spawn = okSpawn();
    const code = await run(['--task', 'q1', '--dry-run'], {
      cwd,
      now: () => NOW,
      spawnAgentImpl: spawn,
    });
    expect(code).toBe(0);
    expect(spawn).not.toHaveBeenCalled();
    expect(existsSync(join(cwd, '.noldor', 'research'))).toBe(false);
  });

  it('--synthesize with >=2 ok findings writes SYNTHESIS.md via one extra spawn', async () => {
    const spawn = okSpawn();
    const code = await run(['--task', 'q1', '--task', 'q2', '--synthesize'], {
      cwd,
      now: () => NOW,
      spawnAgentImpl: spawn,
    });
    expect(code).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(existsSync(join(cwd, '.noldor', 'research', '2026-07-01-142233', 'SYNTHESIS.md'))).toBe(
      true,
    );
  });

  it('synthesis failure degrades to warning — exit stays 0', async () => {
    let call = 0;
    const spawn: SpawnAgentLike = vi.fn(async () => {
      call++;
      if (call === 3) return { exitCode: 1, stdout: '', timedOut: false };
      return {
        exitCode: 0,
        stdout: 'ok\n```json\n{"status":"answered","headline":"h"}\n```',
        timedOut: false,
      };
    });
    const code = await run(['--task', 'q1', '--task', 'q2', '--synthesize'], {
      cwd,
      now: () => NOW,
      spawnAgentImpl: spawn,
    });
    expect(code).toBe(0);
    expect(existsSync(join(cwd, '.noldor', 'research', '2026-07-01-142233', 'SYNTHESIS.md'))).toBe(
      false,
    );
  });
});
