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

/**
 * Slack added to a probe's budget before it reaches `execFile`.
 *
 * `runProbe` races the probe body against the budget and owns the timeout row;
 * `execFile`'s own timeout exists only to kill a child the race cannot cancel.
 * Equal bounds would fire at the same instant and make it a coin flip which row
 * is produced, so the spawn always gets strictly longer than the race.
 */
export const RUNNER_SLACK_MS = 1_000;

export interface RunResult {
  /** 0 on success. A non-zero exit, an absent binary and a killed child all land here. */
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** The repo the command runs against — never `process.cwd()`, or a fixture-backed test asserts against the developer's tree. */
  cwd?: string;
  /** The probe's budget. {@link defaultRunCommand} adds {@link RUNNER_SLACK_MS} before spawning. */
  timeout?: number;
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
  const e = err as { code?: unknown; stdout?: string; stderr?: string; message?: string };
  const stderr = e.stderr ?? '';
  const message = typeof e.message === 'string' ? e.message : String(err);
  return {
    code: typeof e.code === 'number' && e.code !== 0 ? e.code : 1,
    stdout: e.stdout ?? '',
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
      timeout: opts?.timeout === undefined ? undefined : opts.timeout + RUNNER_SLACK_MS,
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
