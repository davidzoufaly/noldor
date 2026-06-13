import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downWorktree } from '../down-worktree.js';

describe('downWorktree', () => {
  it('SIGKILLs each pid group, tolerates dead pids, removes the file', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'down-'));
    mkdirSync(join(cwd, '.noldor'), { recursive: true });
    writeFileSync(join(cwd, '.noldor', 'dev-foo.pids'), 'web 4242 5174\napi 4243 5274\n');
    const kills: number[] = [];
    const killImpl = vi.fn((pid: number) => {
      if (pid === -4243) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      kills.push(pid);
    });
    const r = await downWorktree({ slug: 'foo', cwd }, { killImpl } as never);
    expect(kills).toContain(-4242);
    expect(r.reaped).toBe(2);
    expect(existsSync(join(cwd, '.noldor', 'dev-foo.pids'))).toBe(false);
  });
  it('--remove invokes git removal', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'down-'));
    const gitImpl = vi.fn(async () => {});
    await downWorktree({ slug: 'foo', cwd, remove: true }, { killImpl: vi.fn(), gitImpl } as never);
    expect(gitImpl).toHaveBeenCalled();
  });
  it('--remove deletes the custom branch when provided, not feat/<slug>', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'down-'));
    const gitArgs: string[][] = [];
    const gitImpl = vi.fn(async (args: string[]) => {
      gitArgs.push(args);
    });
    await downWorktree({ slug: 'foo', cwd, remove: true, branch: 'custom/x' }, {
      killImpl: vi.fn(),
      gitImpl,
    } as never);
    expect(gitArgs).toContainEqual(['branch', '-D', 'custom/x']);
  });
  it('skips the group SIGKILL when the leader pid is already gone', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'down-'));
    mkdirSync(join(cwd, '.noldor'), { recursive: true });
    writeFileSync(join(cwd, '.noldor', 'dev-foo.pids'), 'web 4242 5174\n');
    const groupKills: number[] = [];
    const killImpl = vi.fn((pid: number, signal: NodeJS.Signals | 0) => {
      if (signal === 0) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }); // leader gone
      groupKills.push(pid);
    });
    const r = await downWorktree({ slug: 'foo', cwd }, { killImpl } as never);
    expect(groupKills).toHaveLength(0); // never sent the group SIGKILL
    expect(r.reaped).toBe(1); // still counted the line
  });
});
