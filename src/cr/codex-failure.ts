import { CODEX_BIN } from '../core/agent-runner/runners/codex.js';
import type { Spawn } from './codex-spawn.js';

/**
 * Recorded when the version probe cannot answer. Names the binary that was probed, so an
 * unknown version is still attributable to a specific command — `runCodex` accepts a
 * `cmd` override, and "unknown" against a wrapper script means something different than
 * "unknown" against the real CLI.
 */
export function unknownVersion(cmd: string = CODEX_BIN): string {
  return `${cmd} (version unknown)`;
}

/** Default cap on how much stderr rides into a sink blocker. */
export const STDERR_TAIL_CHARS = 4000;

/**
 * Loose on purpose. Codex's exact wording for an expired ChatGPT session could not be
 * captured while the probe machine was logged in, so this matches a family of phrasings
 * rather than one string. A miss is not a regression: the caller still records the exit
 * code, the CLI version and a stderr tail, which is strictly more than the bare
 * `codex exited with exit code 1` this replaces.
 */
export const AUTH_HINT_RE =
  /codex login|not logged[- ]?in|unauthorized|\b401\b|no valid credentials|auth(?:entication)? (?:failed|expired|required)/i;

/**
 * Render a bounded tail of `stderr` with its true size, or `''` when there is nothing to
 * show. The header always states the full size, so truncation is never silent — codex
 * routinely emits hundreds of KB and a sink is read by both `cr aggregate` and an agent's
 * context window.
 *
 * Size is reported in bytes (what `wc -c` and the measurements in the spec show) while the
 * tail is sliced by characters; the header says which is which. For codex's ASCII stderr
 * the two coincide.
 */
export function formatStderrTail(stderr: string, maxChars: number = STDERR_TAIL_CHARS): string {
  if (stderr.length === 0) return '';
  const totalBytes = Buffer.byteLength(stderr, 'utf8');
  const tail = stderr.length > maxChars ? stderr.slice(-maxChars) : stderr;
  return `stderr (last ${tail.length} chars of ${totalBytes} bytes):\n${tail}`;
}

/**
 * Compose the message for a codex failure blocker: which CLI version failed, how it
 * failed, an explicit remediation when the stderr looks auth-shaped, and a bounded tail.
 *
 * The auth scan runs over the WHOLE stderr rather than the tail — the actionable line can
 * sit at byte 400 of 326,525, well outside any tail worth putting in a sink.
 */
export function describeCodexFailure(input: {
  exitCode: number;
  stderr: string;
  version: string;
}): string {
  const hint = AUTH_HINT_RE.test(input.stderr) ? ' — auth looks expired; run: codex login' : '';
  const tail = formatStderrTail(input.stderr);
  return `${input.version}: exited with exit code ${input.exitCode}${hint}${tail ? `\n\n${tail}` : ''}`;
}

/**
 * Ask the installed CLI for its version so a failure is attributable to a specific build
 * — the premise of the entry this fixes was that mocked lane tests cannot catch CLI drift,
 * so a real failure should at least name the CLI that produced it.
 *
 * Runs only on the failure path, so a green review pays nothing for it. Never throws and
 * never propagates a non-zero exit: an attribution helper that fails must not mask the
 * failure it is attributing.
 *
 * `cmd` MUST be the same command that failed. `runCodex` accepts a `cmd` override, so
 * probing a hard-coded `codex` would report the version of a binary that was never run —
 * misattributing the failure precisely where attribution is the point.
 */
export async function probeCodexVersion(spawn: Spawn, cmd: string = CODEX_BIN): Promise<string> {
  try {
    const r = await spawn({ cmd, args: ['--version'], stdin: '' });
    if (r.exitCode !== 0) return unknownVersion(cmd);
    const first = r.stdout.trim().split('\n')[0]?.trim();
    return first !== undefined && first.length > 0 ? first : unknownVersion(cmd);
  } catch {
    return unknownVersion(cmd);
  }
}
