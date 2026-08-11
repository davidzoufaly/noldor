import { spawn as nodeSpawn } from 'node:child_process';

/**
 * Contract for spawning a codex review process. Homed here, beside the canonical
 * implementation, and re-exported from `run-codex.ts` for back-compat: `run-codex.ts`
 * imports the failure helpers, which need this type, so owning it there would make a
 * type-only import cycle.
 *
 * `stderr` is REQUIRED, not optional. The bug this module exists to fix was a stream
 * nobody read; an optional field would let a stub omit it and leave the
 * failure-attribution path vacuously green — the same shape of defect one level up.
 */
export type Spawn = (args: {
  cmd: string;
  args: string[];
  stdin: string;
}) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

/**
 * Spawn codex with the prompt on stdin, draining BOTH output streams.
 *
 * Draining stderr is the entire point. `nodeSpawn(cmd, args)` pipes all three
 * streams; the previous implementation read only `stdout`, so once the kernel pipe
 * buffer filled, the child blocked on `write(2)` and never reached `close`. That is
 * not theoretical: codex-cli 0.133.0 writes ~326 KB to stderr on a normal run (a
 * models-cache `unknown variant 'max'` error that dumps the whole models JSON), while
 * stdout stays a clean 12 bytes. Measured against this shape, an unread stderr pipe
 * completes at 65 KB and never completes at 200 KB.
 *
 * Deliberately no timeout, no `detached`, and no kill path — the wall-clock cap lives
 * in the orchestrate lane (`lanes/codex.ts`, from `crReview.dispatchTimeoutMs`). An
 * inner cap needs a kill; a direct kill orphans codex's own sandbox children; a group
 * kill needs `detached: true`; and `detached` removes the child from the terminal's
 * foreground process group, so Ctrl-C stops reaching it and a signal reaper becomes
 * necessary too. Staying in the parent's process group means the platform reaps the
 * child on Ctrl-C for free. See the design spec's (D6).
 */
export const spawnCodex: Spawn = async ({ cmd, args, stdin }) =>
  new Promise((resolve) => {
    const c = nodeSpawn(cmd, args);
    // noldor:cut no cap on accumulation — codex's measured worst case is ~326 KB, and every
    // bound worth having (which stream, what to drop, how to say so in the sink) needs a real
    // runaway to design against. Filed in ideas.md; add a cap when one shows up.
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (result: { stdout: string; stderr: string; exitCode: number }): void => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    // setEncoding, not a per-chunk `d.toString()`: the stream's StringDecoder holds partial
    // UTF-8 sequences across chunk boundaries. Decoding each chunk independently corrupts any
    // multi-byte character that straddles a boundary into U+FFFD — realistic here, where
    // stderr arrives in hundreds of KB and reviewed source quotes em dashes and non-ASCII.
    c.stdout.setEncoding('utf8');
    c.stderr.setEncoding('utf8');
    c.stdout.on('data', (d: string) => (stdout += d));
    c.stderr.on('data', (d: string) => (stderr += d));
    c.on('close', (code, signal) => {
      // `code` is null exactly when the child died from a signal (OOM killer, an operator
      // `kill`, or the outer execFile cap cascading down). The prior implementation's
      // `code ?? 0` reported that as SUCCESS, sending runCodex down the happy path to parse a
      // truncated stdout and skip attribution entirely — the "error path reads vacuously
      // green" failure this module exists to eliminate. Signal death is a failure.
      if (code === null) {
        settle({
          stdout,
          stderr: `${stderr}\n[spawnCodex] child terminated by signal ${signal ?? 'unknown'}\n`,
          exitCode: 1,
        });
        return;
      }
      settle({ stdout, stderr, exitCode: code });
    });
    // Append the reason, symmetrically with the signal path above. Discarding the Error here
    // was the same defect in miniature: `spawn codex ENOENT` / `EACCES` / `EMFILE` never
    // reached stderr, so the sink rendered a bare "exited with exit code 127" with nothing to
    // act on. Keep whatever stdout arrived too — dropping it while keeping stderr was
    // asymmetric with no reason behind it.
    //
    // 127 is a FALLBACK, not a diagnosis: it mirrors a shell's "command not found", which is
    // right for ENOENT and wrong for EACCES or EMFILE. The appended message is what actually
    // distinguishes them.
    c.on('error', (err: Error) =>
      settle({
        stdout,
        stderr: `${stderr}\n[spawnCodex] spawn error: ${err.message}\n`,
        exitCode: 127,
      }),
    );
    // A child that exits before reading stdin must not raise EPIPE.
    c.stdin.on('error', () => {});
    c.stdin.end(stdin);
  });
