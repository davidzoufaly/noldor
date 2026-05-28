import { spawnSync } from 'node:child_process';

export type Trailers = Record<string, string>;

/**
 * Parse trailers from a commit message using `git interpret-trailers --parse`.
 * Uses spawnSync with an args array (no shell) to avoid escaping bugs.
 *
 * @throws when `git interpret-trailers` subprocess exits non-zero
 *   (binary missing, ENOENT, pipe failure). Callers that need to
 *   tolerate the failure MUST wrap in try/catch and pick a fallback —
 *   e.g. `validate-noldor-scope.ts` falls back to a regex bypass.
 *   Returning `{}` on failure would silently regress those callers, so
 *   the throw is a load-bearing contract.
 *
 * @returns parsed trailers keyed by trailer name. Empty object when the
 *   message has no trailer block (git interpret-trailers exits 0 with
 *   empty stdout on an empty / trailer-free message).
 */
export function parseTrailers(message: string): Trailers {
  const r = spawnSync('git', ['interpret-trailers', '--parse'], {
    input: message,
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    throw new Error(`git interpret-trailers --parse failed: ${r.stderr}`);
  }
  const trailers: Trailers = {};
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^([A-Z][A-Za-z-]*):\s*(.*)$/);
    if (m) trailers[m[1]] = m[2];
  }
  return trailers;
}

/** Format a trailers object as an array of `Key: value` strings. */
export function formatTrailers(t: Trailers): string[] {
  return Object.entries(t).map(([k, v]) => `${k}: ${v}`);
}

/**
 * Append trailers to a commit message using `git interpret-trailers`.
 * Uses spawnSync with an args array (no shell) to avoid escaping bugs with
 * values that contain colons, dashes, or shell-special characters.
 */
export function appendToMessage(message: string, t: Trailers): string {
  const args = ['interpret-trailers'];
  for (const [k, v] of Object.entries(t)) {
    args.push('--trailer', `${k}: ${v}`);
  }
  const r = spawnSync('git', args, { input: message, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git interpret-trailers failed: ${r.stderr}`);
  }
  return r.stdout;
}
