// @tests: pendev-ui-design-phase
// Run a consumer-declared capture command under a timeout, in its own process
// group. Shared by the `render-compare` CR lane (which captures screenshots
// from a booted app) and `design capture` (which regenerates a UI baseline):
// both hand a shell string to the OS and care about exactly one thing the
// server-boot helper in `verify/boot.ts` cannot express — the command's exit
// code. `boot.ts` decides success by polling for an HTTP 200 and never surfaces
// a code, so it does not model "exit 0 ⇒ vouch for the result".

import { spawn } from 'node:child_process';

import { errMessage } from './err-message.js';

/**
 * Stderr is kept as a bounded byte tail rather than a string: decoding
 * per chunk and slicing in UTF-16 can split a character at the tail seam.
 */
const STDERR_TAIL_CAP = 2000;

/** What a capture command run produced: exit code, cap status, stderr tail. */
export interface CaptureResult {
  code: number;
  timedOut: boolean;
  stderrTail: string;
}

/**
 * Run `command` via `/bin/sh -c` under `timeoutMs`, with cwd = `cwd` and env
 * inherited. The child leads its own process group so a timeout kills the whole
 * tree — a `pnpm …` capture spawns node, a bundler, sometimes a browser, and a
 * bare child-pid kill would orphan every one of them.
 *
 * Never rejects: a spawn error (command not found) resolves as `code: 1`, so a
 * caller branches on one result shape instead of a result plus a throw. That is
 * the boundary conversion `error-result-types` asks for — the throw source is
 * the OS, and it is caught here rather than in each caller.
 */
export function runCapture(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd,
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    // Byte tail, decoded ONCE at the end: per-chunk decoding plus a UTF-16
    // slice can still split characters at the tail seam. A byte-boundary
    // partial at the very head of the tail decodes to one replacement char —
    // acceptable for diagnostic text.
    let stderrTail = Buffer.alloc(0);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = Buffer.concat([stderrTail, chunk]).subarray(-STDERR_TAIL_CAP);
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* already exited */
        }
      }
    }, timeoutMs);
    // Group-kill on EVERY exit path, not only timeout: a capture command that
    // exits while a spawned descendant (a browser, a daemonized helper) lives
    // on would otherwise leak it past the round.
    const reapGroup = (): void => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* group already gone */
        }
      }
    };
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reapGroup();
      resolve({ code, timedOut, stderrTail: stderrTail.toString('utf8').trim() });
    };
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reapGroup();
      resolve({ code: 1, timedOut: false, stderrTail: errMessage(err) });
    });
    // Resolve on 'exit' + a short stderr-drain grace rather than waiting for
    // 'close': 'close' fires only when stdio drains, and a daemonized
    // descendant holding the inherited stderr pipe would otherwise hold the
    // capture "running" until the timeout kills it — turning a written,
    // perfectly good result into a failure.
    child.on('exit', (code) => {
      setTimeout(() => finish(code ?? 1), 200);
    });
    child.on('close', (code) => {
      finish(code ?? 1);
    });
  });
}
