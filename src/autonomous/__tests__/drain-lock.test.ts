// @tests: acceptance-verify-lane, autonomous-queue-drain-runner, consumer-contract-ci-and-headless-gate-e2e-harness, drain-startup-reconciliation-of-a-prior-dead-run
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  linkSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireLock, liveLockPid, releaseLock } from '../drain-lock.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const MODULE_URL = pathToFileURL(join(REPO_ROOT, 'src/autonomous/drain-lock.ts')).href;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drain-lock-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('drain lock', () => {
  it('acquires when no lock exists', () => {
    expect(acquireLock(dir).ok).toBe(true);
    expect(existsSync(join(dir, '.noldor/drain.lock'))).toBe(true);
  });

  it('refuses when held by a live pid', () => {
    acquireLock(dir);
    expect(acquireLock(dir).ok).toBe(false); // current process is alive → contention
  });

  it('reclaims a lock whose holder pid is dead', () => {
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    writeFileSync(
      join(dir, '.noldor/drain.lock'),
      JSON.stringify({ pid: 2147483646, startedAt: 't' }), // pid that cannot exist
    );
    expect(acquireLock(dir).ok).toBe(true);
  });

  it('refuses a lock another live process holds and leaves it untouched', () => {
    const held = JSON.stringify({ pid: process.ppid, startedAt: 'other' });
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    writeFileSync(join(dir, '.noldor/drain.lock'), held);
    expect(acquireLock(dir)).toEqual({ ok: false, reason: 'held by live pid' });
    expect(readFileSync(join(dir, '.noldor/drain.lock'), 'utf8')).toBe(held);
  });

  it('leaves a dead lock alone while another supervisor holds the claim on it', () => {
    const lock = join(dir, '.noldor/drain.lock');
    const dead = JSON.stringify({ pid: 2147483646, startedAt: 'dead' }); // pid that cannot exist
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    writeFileSync(lock, dead);
    const claim = `${lock}.reclaim.${statSync(lock, { bigint: true }).ino}`;
    linkSync(lock, claim);

    const refused = acquireLock(dir, 'T1');
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain(claim);
    expect(readFileSync(lock, 'utf8')).toBe(dead);

    rmSync(claim);
    expect(acquireLock(dir, 'T1')).toEqual({ ok: true });
    expect(JSON.parse(readFileSync(lock, 'utf8'))).toEqual({ pid: process.pid, startedAt: 'T1' });
  });

  it('releaseLock removes the lock', () => {
    acquireLock(dir);
    releaseLock(dir);
    expect(existsSync(join(dir, '.noldor/drain.lock'))).toBe(false);
  });

  it('releaseLock leaves a foreign-owned lock intact (the pre-acquire crash-handler case)', () => {
    // A different live supervisor's lock: a non-owner releaseLock must not free it.
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    writeFileSync(
      join(dir, '.noldor/drain.lock'),
      JSON.stringify({ pid: 2147483646, startedAt: 'other' }), // pid !== process.pid
    );
    releaseLock(dir);
    expect(existsSync(join(dir, '.noldor/drain.lock'))).toBe(true);
  });

  it('releaseLock with a mismatched startedAt token is a no-op (PID reuse guard)', () => {
    acquireLock(dir, 'T1'); // writes { pid: process.pid, startedAt: 'T1' }
    releaseLock(dir, { startedAt: 'T2' }); // same pid, different run → not ours
    expect(existsSync(join(dir, '.noldor/drain.lock'))).toBe(true);
    releaseLock(dir, { startedAt: 'T1' }); // matching token → removed
    expect(existsSync(join(dir, '.noldor/drain.lock'))).toBe(false);
  });

  it('liveLockPid names a live holder and refuses a pid readHolder rejects', () => {
    acquireLock(dir, 'T1');
    expect(liveLockPid(dir)).toBe(process.pid);
    // pid 0 passes a bare typeof check, and process.kill(0, 0) probes the process
    // group — so a hand-parsed reader would report 0 as a live holder.
    writeFileSync(join(dir, '.noldor/drain.lock'), JSON.stringify({ pid: 0 }));
    expect(liveLockPid(dir)).toBeNull();
  });

  it('releaseLock swallows a read error other than a missing lock (crash-handler safety)', () => {
    mkdirSync(join(dir, '.noldor/drain.lock'), { recursive: true }); // EISDIR on read
    expect(() => releaseLock(dir)).not.toThrow();
    expect(liveLockPid(dir)).toBeNull();
  });
});

function contender(
  script: string,
  env: NodeJS.ProcessEnv,
): { child: ChildProcessWithoutNullStreams; verdict: Promise<string> } & Disposable {
  const child = spawn(process.execPath, ['--import', 'tsx', script], { cwd: REPO_ROOT, env });
  const verdict = new Promise<string>((resolveVerdict, reject) => {
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      if (out.includes('\n')) resolveVerdict(out.split('\n')[0]!);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.once('close', (code) => reject(new Error(`contender exited ${code} unheard: ${err}`)));
  });
  return { child, verdict, [Symbol.dispose]: () => child.kill('SIGKILL') };
}

describe('drain lock across processes', () => {
  it.each([
    ['a free lock', false],
    ["a dead holder's lock", true],
  ])(
    'leaves exactly one holder when several supervisors start at the same instant on %s',
    async (_lock, deadHolder) => {
      mkdirSync(join(dir, '.noldor'), { recursive: true });
      if (deadHolder)
        writeFileSync(
          join(dir, '.noldor/drain.lock'),
          JSON.stringify({ pid: 2147483646, startedAt: 'dead' }),
        );
      const script = join(dir, 'contender.mts');
      writeFileSync(
        script,
        [
          `import { acquireLock } from ${JSON.stringify(MODULE_URL)};`,
          'await new Promise((r) => setTimeout(r, Math.max(0, Number(process.env.START) - Date.now())));',
          "const { ok } = acquireLock(process.env.DIR!, 'contender');",
          'process.stdout.write(`${ok}\\n`);',
          'if (ok) setInterval(() => {}, 1000);',
        ].join('\n'),
      );
      const env = { ...process.env, DIR: dir, START: String(Date.now() + 1000) };
      using a = contender(script, env);
      using b = contender(script, env);
      using c = contender(script, env);
      const verdicts = await Promise.all([a, b, c].map(({ verdict }) => verdict));
      expect(verdicts.toSorted()).toEqual(['false', 'false', 'true']);
      const winner = [a, b, c][verdicts.indexOf('true')]!;
      expect(JSON.parse(readFileSync(join(dir, '.noldor/drain.lock'), 'utf8'))).toEqual({
        pid: winner.child.pid,
        startedAt: 'contender',
      });
    },
  );
});
