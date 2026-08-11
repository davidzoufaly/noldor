// @tests: specs-cr-gate-multi-reviewer
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { spawnCodex } from '../codex-spawn.js';

/**
 * These tests spawn REAL child processes on purpose. The defect they cover — an unread
 * stderr pipe deadlocking the child once the kernel buffer fills — cannot be reproduced
 * with an injected fake `Spawn`, which is exactly why every existing mocked test stayed
 * green while the codex lane could not complete a single real dispatch.
 */

const POSIX = process.platform !== 'win32';

/** Child that dumps `bytes` to stderr via a real blocking write, then prints to stdout. */
const noisyChild = (bytes: number): { cmd: string; args: string[] } => ({
  cmd: 'sh',
  args: ['-c', `head -c ${bytes} /dev/zero | tr '\\0' x >&2; printf '{"ok":true}'`],
});

describe.skipIf(!POSIX)('spawnCodex', () => {
  it('drains 327 KB of stderr instead of deadlocking', async () => {
    // codex-cli 0.133.0 emits ~326,525 bytes on a normal run. Against the previous
    // implementation this never resolved; see the undrained control below.
    const r = await spawnCodex({ ...noisyChild(327_000), stdin: 'prompt' });
    expect(r.exitCode).toBe(0);
    expect(r.stderr.length).toBeGreaterThan(300_000);
    expect(r.stdout).toContain('{"ok":true}');
  });

  it('also handles a volume below the pipe buffer, where the old code looked fine', async () => {
    // 65 KB completed even undrained, which is why casual use never surfaced the bug.
    const r = await spawnCodex({ ...noisyChild(65_000), stdin: 'prompt' });
    expect(r.exitCode).toBe(0);
    expect(r.stderr.length).toBeGreaterThan(60_000);
  });

  it('delivers stdin to the child', async () => {
    const r = await spawnCodex({ cmd: 'sh', args: ['-c', 'cat'], stdin: 'the prompt' });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('the prompt');
    expect(r.stderr).toBe('');
  });

  it('returns 127 for a binary that does not exist, without throwing', async () => {
    const r = await spawnCodex({
      cmd: 'noldor-definitely-not-a-real-binary',
      args: [],
      stdin: '',
    });
    expect(r.exitCode).toBe(127);
  });

  it('keeps a non-zero exit code and the stderr that explains it', async () => {
    const r = await spawnCodex({
      cmd: 'sh',
      args: ['-c', 'echo "no valid credentials" >&2; exit 1'],
      stdin: '',
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('no valid credentials');
  });

  /**
   * Control for the first test: the previous implementation's exact shape — stderr piped
   * by `nodeSpawn` but never read. It must NOT resolve at this volume. If this ever
   * starts resolving, the first test has stopped proving anything and the drain could be
   * removed without any test noticing.
   */
  it('the undrained shape it replaced still hangs at this volume', async () => {
    let child: ChildProcess | undefined;
    const undrained = new Promise<'resolved'>((resolve) => {
      const { cmd, args } = noisyChild(327_000);
      child = nodeSpawn(cmd, args);
      let stdout = '';
      child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
      // No `child.stderr.on('data')` — that omission IS the bug.
      child.on('close', () => resolve('resolved'));
      child.stdin?.on('error', () => {});
      child.stdin?.end('prompt');
    });
    const timeout = new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 1500));
    try {
      await expect(Promise.race([undrained, timeout])).resolves.toBe('hung');
    } finally {
      child?.kill('SIGKILL');
    }
  });
});
