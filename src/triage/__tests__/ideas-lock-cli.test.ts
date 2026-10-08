// @tests: memory-intake-lessons-learned-pipeline
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isAlive } from '../../core/pid-lock.js';
import { main } from '../ideas-lock-cli.js';
import { main as retro } from '../retro-cli.js';

let repo: string;

function lockPath(): string {
  return join(repo, '.git', 'noldor-ideas.lock');
}

function holder(): { pid: number; holdUntil?: string } {
  return JSON.parse(readFileSync(lockPath(), 'utf8')) as { pid: number; holdUntil?: string };
}

function ideasLock(...argv: string[]): Promise<number> {
  return main(argv, { cwd: repo, waitMs: 300 });
}

beforeEach(async () => {
  repo = realpathSync(await mkdtemp(join(tmpdir(), 'ideas-lock-')));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
});

afterEach(async () => {
  await ideasLock('release');
  await rm(repo, { recursive: true, force: true });
});

describe('noldor triage ideas-lock', () => {
  it('acquire holds the lock under a live process until release ends it', async () => {
    expect(await ideasLock('acquire', '--minutes', '5')).toBe(0);
    const held = holder();
    expect(isAlive(held.pid)).toBe(true);
    expect(Date.parse(held.holdUntil ?? '') - Date.now()).toBeGreaterThan(4 * 60_000);

    expect(await ideasLock('release')).toBe(0);
    expect(existsSync(lockPath())).toBe(false);
    await vi.waitFor(() => expect(isAlive(held.pid)).toBe(false));
  });

  it('a second acquire waits out its bound and leaves the first hold alone', async () => {
    expect(await ideasLock('acquire')).toBe(0);
    const first = holder();
    expect(await ideasLock('acquire')).toBe(1);
    expect(holder()).toEqual(first);
  });

  it('retro cannot write while a hold is taken, and writes once it is released', async () => {
    const notes = join(repo, 'notes.txt');
    writeFileSync(notes, 'lesson: a trap\n');
    const args = ['--slug', 'some-slug', '--pr', '7', '--file', notes];
    expect(await ideasLock('acquire')).toBe(0);
    expect(await retro(args, { cwd: repo, today: '2026-10-08' })).toBe(1);
    expect(existsSync(join(repo, 'ideas.md'))).toBe(false);

    expect(await ideasLock('release')).toBe(0);
    expect(await retro(args, { cwd: repo, today: '2026-10-08' })).toBe(0);
    expect(readFileSync(join(repo, 'ideas.md'), 'utf8')).toContain(
      '- a trap (some-slug, PR #7, 2026-10-08)',
    );
  }, 15_000);

  it('release leaves a lock that is not a hold in place', async () => {
    writeFileSync(lockPath(), JSON.stringify({ pid: process.pid, startedAt: 'now' }));
    expect(await ideasLock('release')).toBe(1);
    expect(holder().pid).toBe(process.pid);
    await rm(lockPath());
  });

  it('release with nothing held is a no-op success', async () => {
    expect(await ideasLock('release')).toBe(0);
  });

  it.each([
    [[]],
    [['hold']],
    [['acquire', '--minutes', '0']],
    [['acquire', '--minutes', '121']],
    [['acquire', '--minutes']],
    [['release', '--now']],
  ])('refuses %j as usage', async (argv) => {
    expect(await ideasLock(...argv)).toBe(2);
    expect(existsSync(lockPath())).toBe(false);
  });
});
