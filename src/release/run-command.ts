// @fd: test-suites-read-live-repo-state-shifting-full-suite-failures
// The one sanctioned spawn seam for release preflight. Every probe reaches the
// outside world through a `RunCommand`, so a test hands `runPreflight` a
// scripted fake and the suite never spawns `gh` or `npm` — which is what keeps
// `preflight.test.ts` off the network and inside vitest's 10s bound.
//
// This lives in its own module so `no-probe-spawns.test.ts` can ban every spawn
// primitive in `preflight-probes.ts` unconditionally. A carve-out inside the
// scanned file would be exactly where a regression gets added, and a text scan
// has no reliable way to express one.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface RunResult {
  /** 0 on success. A non-zero exit, an absent binary and a killed child all land here. */
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** The repo the command runs against — never `process.cwd()`, or a fixture-backed test asserts against the developer's tree. */
  cwd?: string;
  /**
   * The probe's deadline AND its cancellation path, as one signal.
   *
   * `concurrency-write-discipline`: a subprocess wait takes a signal, and a
   * deadline and a cancellation compose into one rather than racing as two
   * mechanisms. `runProbe` owns an `AbortController` per probe and fires it from
   * a single `setTimeout`, which both aborts the child and produces the timeout
   * row — so there is no second bound to keep out of step with it. Deliberately
   * not `AbortSignal.timeout`: that keeps a timer scheduled for the whole budget
   * even when the probe answers immediately, and throws on an out-of-range delay.
   */
  signal?: AbortSignal;
}

/**
 * Spawn a command and RESOLVE its outcome — never reject.
 *
 * The `npm-name` probe discriminates published-from-unpublished by reading
 * `stderr`, so a runner that rejected with a bare `Error` would silently land
 * it in the "unanswered" branch and report a blocking row where production
 * reports the name free. A type cannot enforce this — `Promise<never>` is
 * assignable to any promise type, so an `async` function that throws still
 * satisfies this signature — which is why {@link normalizeRunner} wraps every
 * injected runner instead of the contract being left to convention.
 */
export type RunCommand = (cmd: string, args: string[], opts?: RunOptions) => Promise<RunResult>;

/**
 * Convert a rejected spawn into a {@link RunResult}.
 *
 * Folds `Error.message` into an empty `stderr`: for a binary that is absent
 * entirely (ENOENT) nothing reaches `stderr` and only the message carries
 * `spawn npm ENOENT`, so dropping it degrades `npm-name`'s warn detail to
 * `(no output)`. A non-numeric `code` — `execFile` reports `'ENOENT'` as a
 * string — is not an exit status, so it normalizes to 1.
 */
export function resultFromError(err: unknown): RunResult {
  // Narrowed, not merely cast: a runner rejecting with `null` or a string would
  // make a property read throw from inside the very function that exists to stop
  // a throw, breaking {@link normalizeRunner}'s never-reject contract.
  const e: { code?: unknown; stdout?: unknown; stderr?: unknown; message?: unknown } =
    typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : {};
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const stderr = str(e.stderr);
  const message = typeof e.message === 'string' ? e.message : String(err);
  return {
    code: typeof e.code === 'number' && e.code !== 0 ? e.code : 1,
    stdout: str(e.stdout),
    stderr: stderr.length > 0 ? stderr : message,
  };
}

/**
 * The real spawn. Exported as a named symbol so a test can assert that
 * `makeProbeContext` defaults to it by identity — `execFileP` above is module
 * private and a test has no reference to compare against.
 */
export const defaultRunCommand: RunCommand = async (cmd, args, opts) => {
  try {
    const { stdout, stderr } = await execFileP(cmd, args, {
      cwd: opts?.cwd,
      signal: opts?.signal,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return resultFromError(err);
  }
};

/**
 * Wrap a runner so a rejection becomes a {@link RunResult} whatever it was
 * handed. This is the enforcement point for "resolves rather than rejects":
 * without it a hand-written fake that throws crashes the probe into
 * `runProbe`'s generic catch instead of producing the row the probe meant.
 */
export function normalizeRunner(run: RunCommand): RunCommand {
  return async (cmd, args, opts) => {
    try {
      return await run(cmd, args, opts);
    } catch (err) {
      return resultFromError(err);
    }
  };
}
