// @tests: test-suites-read-live-repo-state-shifting-full-suite-failures
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import setup, {
  SUITE_LOCK_FILE,
  acquireSuiteLock,
  releaseSuiteLock,
  suiteLockSkipReason,
  tryAcquire,
} from '../suite-lock.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const MODULE_URL = pathToFileURL(join(REPO_ROOT, 'src/testing/suite-lock.ts')).href;
const execFileAsync = promisify(execFile);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'suite-lock-'));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const lockIn = (root: string): string => join(root, SUITE_LOCK_FILE);
const self = { pid: process.pid, startedAt: '2026-09-24T10:00:00.000Z', worktree: '/work/self' };
const other = { pid: process.ppid, startedAt: '2026-09-24T09:00:00.000Z', worktree: '/work/other' };
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

function exitedPid(): number {
  const child = spawnSync(process.execPath, ['-e', '']);
  return child.pid;
}

function gitRepo(root: string): string {
  const repo = join(root, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  return repo;
}

function project(root: string, filenamePattern?: string[]) {
  return { config: { root, watch: false }, vitest: { filenamePattern } };
}

describe('tryAcquire', () => {
  it('publishes its payload when the lock is free', () => {
    expect(tryAcquire(lockIn(dir), self)).toEqual({ kind: 'acquired' });
    expect(readJson(lockIn(dir))).toEqual(self);
  });

  it('reports a live holder and leaves its lock untouched', () => {
    writeFileSync(lockIn(dir), JSON.stringify(other));
    expect(tryAcquire(lockIn(dir), self)).toEqual({ kind: 'held', holder: other });
    expect(readJson(lockIn(dir))).toEqual(other);
  });

  it('lets the process that already holds the lock straight through', () => {
    writeFileSync(lockIn(dir), JSON.stringify({ ...self, startedAt: 'earlier setup call' }));
    expect(tryAcquire(lockIn(dir), self)).toEqual({ kind: 'own' });
    expect(readJson(lockIn(dir))).toEqual({ ...self, startedAt: 'earlier setup call' });
  });

  it('reclaims a lock whose holder has exited', () => {
    writeFileSync(lockIn(dir), JSON.stringify({ ...other, pid: exitedPid() }));
    expect(tryAcquire(lockIn(dir), self)).toEqual({ kind: 'acquired' });
    expect(readJson(lockIn(dir))).toEqual(self);
  });

  it.each([
    ['an empty file', ''],
    ['text that is not JSON', 'not json'],
    ['JSON without a pid', '{"worktree":"/work/other"}'],
  ])('reclaims a lock whose payload is %s', (_shape, payload) => {
    writeFileSync(lockIn(dir), payload);
    expect(tryAcquire(lockIn(dir), self)).toEqual({ kind: 'acquired' });
    expect(readJson(lockIn(dir))).toEqual(self);
  });

  it('keeps a live holder whose payload lacks the display fields', () => {
    writeFileSync(lockIn(dir), JSON.stringify({ pid: process.ppid }));
    expect(tryAcquire(lockIn(dir), self)).toEqual({ kind: 'held', holder: { pid: process.ppid } });
  });

  it('reports a lock it cannot create instead of throwing', () => {
    const result = tryAcquire(join(dir, 'missing', SUITE_LOCK_FILE), self);
    expect(result.kind).toBe('failed');
  });

  it('leaves no staged or reclaimed file behind', () => {
    writeFileSync(lockIn(dir), JSON.stringify({ ...other, pid: exitedPid() }));
    tryAcquire(lockIn(dir), self);
    tryAcquire(lockIn(dir), other);
    expect(readdirSync(dir)).toEqual([SUITE_LOCK_FILE]);
  });
});

describe('releaseSuiteLock', () => {
  it('removes the lock this suite holds', () => {
    tryAcquire(lockIn(dir), self);
    releaseSuiteLock(lockIn(dir), self);
    expect(existsSync(lockIn(dir))).toBe(false);
  });

  it("never removes another suite's lock", () => {
    writeFileSync(lockIn(dir), JSON.stringify(other));
    releaseSuiteLock(lockIn(dir), self);
    expect(readJson(lockIn(dir))).toEqual(other);
  });
});

describe('acquireSuiteLock', () => {
  it('takes a free lock without waiting', async () => {
    const outcome = await acquireSuiteLock(lockIn(dir), self, { timeoutMs: 5000, pollMs: 20 });
    expect(outcome).toEqual({ kind: 'acquired', waited: false });
  });

  it('waits behind a live holder, names it once, and takes the lock when it is released', async () => {
    writeFileSync(lockIn(dir), JSON.stringify(other));
    const announced: unknown[] = [];
    setTimeout(() => rmSync(lockIn(dir)), 150);
    const outcome = await acquireSuiteLock(lockIn(dir), self, {
      timeoutMs: 5000,
      pollMs: 20,
      onWait: (holder) => announced.push(holder),
    });
    expect(outcome).toEqual({ kind: 'acquired', waited: true });
    expect(announced).toEqual([other]);
    expect(readJson(lockIn(dir))).toEqual(self);
  });

  it('stops at the deadline instead of waiting forever', async () => {
    writeFileSync(lockIn(dir), JSON.stringify(other));
    const outcome = await acquireSuiteLock(lockIn(dir), self, { timeoutMs: 150, pollMs: 20 });
    expect(outcome).toEqual({ kind: 'timed-out', holder: other });
    expect(readJson(lockIn(dir))).toEqual(other);
  });

  it('stops when the caller aborts', async () => {
    writeFileSync(lockIn(dir), JSON.stringify(other));
    const outcome = await acquireSuiteLock(lockIn(dir), self, {
      timeoutMs: 60_000,
      pollMs: 20,
      signal: AbortSignal.timeout(100),
    });
    expect(outcome).toEqual({ kind: 'timed-out', holder: other });
  });
});

describe('suiteLockSkipReason', () => {
  it.each([
    ['a full run', { env: undefined, watch: false, filters: undefined }],
    [
      'a full run with the variable set to anything but 0',
      { env: '1', watch: false, filters: undefined },
    ],
    ['a run whose filter list is empty', { env: undefined, watch: false, filters: [] }],
  ])('queues %s', (_run, run) => {
    expect(suiteLockSkipReason(run)).toBeNull();
  });

  it.each([
    ['NOLDOR_SUITE_LOCK=0', { env: '0', watch: false, filters: undefined }, 'disabled'],
    ['watch mode', { env: undefined, watch: true, filters: undefined }, 'watch'],
    [
      'a run with file filters',
      { env: undefined, watch: false, filters: ['src/a.test.ts'] },
      'filtered',
    ],
  ])('does not queue %s', (_run, run, reason) => {
    expect(suiteLockSkipReason(run)).toBe(reason);
  });
});

/**
 * The parent's environment minus what would change the code under test: the queue's
 * own off switch (the reproduction recipe runs the suite with it set) and vitest's
 * markers, which a nested vitest would otherwise read as its own.
 */
function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const inherited = Object.entries(process.env).filter(
    ([key]) => key !== 'NOLDOR_SUITE_LOCK' && !key.startsWith('VITEST'),
  );
  return { ...Object.fromEntries(inherited), ...extra };
}

describe('setup (vitest globalSetup)', () => {
  beforeEach(() => {
    vi.stubEnv('NOLDOR_SUITE_LOCK', undefined);
  });

  it('queues a full run on the lock in the git common dir and releases it on teardown', async () => {
    const repo = gitRepo(dir);
    const teardown = await setup(project(repo));
    expect(readJson(join(repo, '.git', SUITE_LOCK_FILE))).toMatchObject({ pid: process.pid });
    teardown();
    expect(existsSync(join(repo, '.git', SUITE_LOCK_FILE))).toBe(false);
  });

  it("queues a worktree on its main checkout's lock", async () => {
    const repo = gitRepo(dir);
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
    git('commit', '-q', '--allow-empty', '-m', 'init');
    const worktree = join(dir, 'wt');
    git('worktree', 'add', '-q', worktree);
    const teardown = await setup(project(worktree));
    expect(readJson(join(repo, '.git', SUITE_LOCK_FILE))).toMatchObject({ pid: process.pid });
    teardown();
  });

  it('never waits for, or touches, the lock on a filtered run', async () => {
    const repo = gitRepo(dir);
    const lock = join(repo, '.git', SUITE_LOCK_FILE);
    writeFileSync(lock, JSON.stringify(other));
    const teardown = await setup(project(repo, ['src/a.test.ts']));
    teardown();
    expect(readJson(lock)).toEqual(other);
  });

  it('never queues when NOLDOR_SUITE_LOCK=0', async () => {
    vi.stubEnv('NOLDOR_SUITE_LOCK', '0');
    const repo = gitRepo(dir);
    const teardown = await setup(project(repo));
    expect(existsSync(join(repo, '.git', SUITE_LOCK_FILE))).toBe(false);
    teardown();
  });

  it('lets a second setup in the same process through without waiting on itself', async () => {
    const repo = gitRepo(dir);
    const lock = join(repo, '.git', SUITE_LOCK_FILE);
    const first = await setup(project(repo));
    const second = await setup(project(repo));
    second();
    expect(readJson(lock)).toMatchObject({ pid: process.pid });
    first();
    expect(existsSync(lock)).toBe(false);
  });

  it('runs unqueued outside a git checkout, and says so', async () => {
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    const teardown = await setup(project(dir));
    teardown();
    expect(readdirSync(dir)).toEqual([]);
    expect(written.join('')).toContain('not queued');
  });
});

/** A `tsx` child running `body`, which can import the lock module; killed on dispose. */
function lockChild(
  body: string,
  env: Record<string, string>,
): { child: ChildProcessWithoutNullStreams } & Disposable {
  const script = join(dir, `child-${randomUUID()}.mts`);
  writeFileSync(
    script,
    `import setup, { tryAcquire } from ${JSON.stringify(MODULE_URL)};\n${body}\n`,
  );
  const child = spawn(process.execPath, ['--import', 'tsx', script], {
    cwd: REPO_ROOT,
    env: childEnv(env),
  });
  return { child, [Symbol.dispose]: () => child.kill('SIGKILL') };
}

function firstLine(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolveLine, reject) => {
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      if (out.includes('\n')) resolveLine(out.split('\n')[0]!);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.once('exit', (code) => reject(new Error(`child exited ${code} before a line: ${err}`)));
  });
}

describe('across processes', () => {
  it('leaves exactly one holder when several suites start at the same instant', async () => {
    const body = [
      'await new Promise((r) => setTimeout(r, Math.max(0, Number(process.env.START) - Date.now())));',
      "const r = tryAcquire(process.env.LOCK!, { pid: process.pid, startedAt: new Date().toISOString(), worktree: 'child' });",
      "process.stdout.write(r.kind + '\\n');",
      "if (r.kind === 'acquired') setInterval(() => {}, 1000);",
    ].join('\n');
    const env = { LOCK: lockIn(dir), START: String(Date.now() + 1000) };
    using a = lockChild(body, env);
    using b = lockChild(body, env);
    using c = lockChild(body, env);
    const kinds = await Promise.all([a, b, c].map(({ child }) => firstLine(child)));
    expect(kinds.toSorted()).toEqual(['acquired', 'held', 'held']);
  });

  it('removes its lock when the process exits without a teardown', async () => {
    const repo = gitRepo(dir);
    const lock = join(repo, '.git', SUITE_LOCK_FILE);
    const body = [
      'await setup({ config: { root: process.env.REPO!, watch: false }, vitest: {} });',
      "process.stdout.write('held\\n');",
      "process.stdin.once('data', () => process.exit(0));",
    ].join('\n');
    using holder = lockChild(body, { REPO: repo });
    expect(await firstLine(holder.child)).toBe('held');
    expect(readJson(lock)).toMatchObject({ pid: holder.child.pid });
    const exited = new Promise((done) => holder.child.once('exit', done));
    holder.child.stdin.write('exit\n');
    await exited;
    expect(existsSync(lock)).toBe(false);
  });
});

describe('through the real vitest CLI', () => {
  /**
   * A one-test project in its own git repo whose `globalSetup` is this module. Its
   * test records whether the suite lock existed while it ran, so the probe sees what
   * the setup decided from the `TestProject` the installed vitest really handed it.
   */
  function fixtureRepo(name: string): { config: string; lock: string; seen: string } {
    const repo = join(dir, name);
    execFileSync('git', ['init', '-q', repo]);
    const setupPath = JSON.stringify(join(REPO_ROOT, 'src/testing/suite-lock.ts'));
    writeFileSync(
      join(repo, 'vitest.config.mjs'),
      `export default { test: { globals: true, include: ['*.test.mjs'], globalSetup: [${setupPath}] } };\n`,
    );
    writeFileSync(
      join(repo, 'probe.test.mjs'),
      [
        "import { existsSync, writeFileSync } from 'node:fs';",
        "test('probe', () => writeFileSync(process.env.PROBE_SEEN, String(existsSync(process.env.PROBE_LOCK))));",
      ].join('\n'),
    );
    return {
      config: join(repo, 'vitest.config.mjs'),
      lock: join(repo, '.git', SUITE_LOCK_FILE),
      seen: join(repo, 'seen.txt'),
    };
  }

  it('queues a full run, leaves a filtered run alone, and releases the lock afterwards', async () => {
    const vitestCli = join(
      dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
      'vitest.mjs',
    );
    const run = (fixture: { config: string; lock: string; seen: string }, filters: string[]) =>
      execFileAsync(
        process.execPath,
        [
          vitestCli,
          'run',
          '--config',
          fixture.config,
          '--root',
          dirname(fixture.config),
          ...filters,
        ],
        { env: childEnv({ PROBE_LOCK: fixture.lock, PROBE_SEEN: fixture.seen }), timeout: 9000 },
      );
    const full = fixtureRepo('full');
    const filtered = fixtureRepo('filtered');
    await Promise.all([run(full, []), run(filtered, ['probe'])]);
    expect(readFileSync(full.seen, 'utf8')).toBe('true');
    expect(readFileSync(filtered.seen, 'utf8')).toBe('false');
    expect(existsSync(full.lock)).toBe(false);
  });
});
