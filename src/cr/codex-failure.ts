import { execFile } from 'node:child_process';
import { CODEX_BIN } from '../core/agent-runner/runners/codex.js';
import { settleWithin } from '../core/settle-within.js';

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
 * The configured model postdates the installed CLI. Measured: codex-cli 0.133.0 against
 * `gpt-5.6-sol` returns `400 invalid_request_error` carrying "The 'gpt-5.6-sol' model
 * requires a newer version of Codex" — and codex appends generic login advice to API
 * failures, so without this check the loose {@link AUTH_HINT_RE} sends the operator to
 * re-authenticate a session that never expired.
 */
export const MODEL_VERSION_RE = /model requires a newer version of codex/i;

/**
 * An `invalid_request_error` naming a model on the SAME line, in either order. A
 * model-shaped 400 is a request problem, never a credential problem, so it suppresses the
 * auth hint even when the body happens to trip {@link AUTH_HINT_RE} (a "401" inside a
 * request id, appended login boilerplate). Same-line on purpose: codex stderr runs to
 * hundreds of KB, and a cross-line pairing would let an unrelated `model` word (an echoed
 * `-c model=` flag) suppress a genuine auth hint.
 */
export const MODEL_REQUEST_ERROR_RE =
  /invalid_request_error[^\n]*\bmodel\b|\bmodel\b[^\n]*invalid_request_error/i;

/**
 * Pick the remediation hint for a failure's stderr. Precedence: the model-version
 * rejection owns its remedy (upgrade the CLI — the binary is npm-global, so
 * `brew upgrade codex` silently no-ops; verified 2026-08-17, 0.133.0 → 0.147.0); any other
 * model-shaped 400 explicitly disclaims auth; only then does auth-shaped stderr earn the
 * login hint. Scans the WHOLE stderr — the actionable line can sit far outside any tail.
 */
function codexFailureHint(stderr: string): string {
  if (MODEL_VERSION_RE.test(stderr)) {
    return (
      ' — the configured model requires a newer Codex CLI; run: npm install -g @openai/codex@latest' +
      ' (npm-global binary — brew upgrade codex silently no-ops), or pin an older model: codex exec -c model=<model>'
    );
  }
  if (MODEL_REQUEST_ERROR_RE.test(stderr)) {
    return ' — request rejected over the named model; not an auth failure (see stderr tail)';
  }
  if (AUTH_HINT_RE.test(stderr)) {
    return ' — auth looks expired; run: codex login';
  }
  return '';
}

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
export function formatStderrTail(
  stderr: string,
  maxChars: number = STDERR_TAIL_CHARS,
  trueTotalBytes?: number,
): string {
  if (stderr.length === 0) return '';
  // Prefer the caller's pre-elision count. Measuring the string we were handed under-reports
  // exactly when a bounded capture already dropped the middle — and the `[… elided …]` marker
  // sits at the head/tail seam, far outside a 4000-char tail, so it never reaches the sink to
  // say so. Silent under-reporting of truncation is the failure this whole module rejects.
  const totalBytes = trueTotalBytes ?? Buffer.byteLength(stderr, 'utf8');
  const tail = stderr.length > maxChars ? stderr.slice(-maxChars) : stderr;
  return `stderr (last ${tail.length} chars of ${totalBytes} bytes):\n${tail}`;
}

/**
 * Compose the message for a codex failure blocker: which CLI version failed, how it
 * failed, an explicit remediation from {@link codexFailureHint}, and a bounded tail.
 *
 * The hint scan runs over the WHOLE stderr rather than the tail — the actionable line can
 * sit at byte 400 of 326,525, well outside any tail worth putting in a sink.
 */
export function describeCodexFailure(input: {
  exitCode: number;
  stderr: string;
  version: string;
  /** Set when the dispatch cap fired. Distinguishes a timeout from an OOM or operator kill. */
  timedOut?: boolean;
  /** The cap that fired, for the timeout message. */
  timeoutMs?: number;
  /** True pre-elision size of `stderr`; falls back to measuring the string when omitted. */
  stderrBytes?: number;
}): string {
  const hint = codexFailureHint(input.stderr);
  const tail = formatStderrTail(input.stderr, STDERR_TAIL_CHARS, input.stderrBytes);
  // A timeout and a signal kill both surface as a non-zero exit with a SIGKILL note, so the
  // exit code alone cannot tell them apart. Lead with the cap when it is what fired.
  const cause = input.timedOut
    ? `timed out after ${input.timeoutMs ?? '?'}ms`
    : `exited with exit code ${input.exitCode}`;
  return `${input.version}: ${cause}${hint}${tail ? `\n\n${tail}` : ''}`;
}

/** Cap on the version probe, inherited from the `--version`-class probe this replaces. */
export const PROBE_TIMEOUT_MS = 5000;

/**
 * The probe's child-spawner, injectable so the cap can be tested at the level it applies.
 * Resolves the child's stdout; rejects on any failure.
 *
 * Deliberately takes only `bin`: the argv is fixed at the definition site below, so no caller
 * — and no test — can turn a `--version` call into something else. That is what closes the
 * hole this replaces, where the probe borrowed the review `Spawn` and an adapter ignoring its
 * `args` would have spawned a full empty-prompt review on the failure path.
 */
export type VersionExec = (bin: string) => Promise<string>;

const defaultVersionExec: VersionExec = (bin) =>
  new Promise<string>((resolve, reject) => {
    // The `timeout` here is the best-effort KILL. It is not what guarantees the caller
    // settles — `settleWithin` below does that — because this callback fires on stream
    // close, which a wedged child or a surviving grandchild can withhold indefinitely.
    execFile(bin, ['--version'], { timeout: PROBE_TIMEOUT_MS }, (err, stdout) =>
      err ? reject(err) : resolve(String(stdout)),
    );
  });

/**
 * Ask the installed CLI for its version so a failure is attributable to a specific build
 * — the premise of the entry this fixes was that mocked lane tests cannot catch CLI drift,
 * so a real failure should at least name the CLI that produced it.
 *
 * Runs only on the failure path, so a green review pays nothing for it. Never throws, never
 * propagates a non-zero exit, and never hangs: an attribution helper that fails must not mask
 * the failure it is attributing, and one that blocks must not become the failure. Anything
 * unanswerable degrades to {@link unknownVersion}, which the sink already renders.
 *
 * `bin` is supplied by the caller from the shared `CODEX_BIN` — the same constant the agent
 * registry spawns from — so the version reported is the binary that actually ran.
 */
export async function probeCodexVersion(
  bin: string = CODEX_BIN,
  exec: VersionExec = defaultVersionExec,
): Promise<string> {
  const fallback = unknownVersion(bin);
  // The async IIFE is load-bearing: `exec(bin).catch(...)` would not catch an exec that
  // throws SYNCHRONOUSLY, since there is no promise to attach to yet — and "never throws" has
  // to hold against a broken injected seam too, not just a rejecting child. The `.catch` then
  // rides the promise itself, so a rejection arriving after the timer already won cannot
  // surface as an unhandled rejection on a path whose whole job is to explain someone else's
  // failure.
  const out = await settleWithin(
    (async () => exec(bin))().catch(() => null),
    PROBE_TIMEOUT_MS,
    null,
  );
  if (out === null) return fallback;
  const first = out.trim().split('\n')[0]?.trim();
  return first !== undefined && first.length > 0 ? first : fallback;
}
