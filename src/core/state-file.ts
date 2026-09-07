import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { atomicWriteFileSync } from './atomic-write.js';

/**
 * Thrown by {@link readJsonState} when a state file is present but cannot be
 * read or parsed — the "torn / corrupt" case. A distinct type lets callers tell
 * corruption (fail closed) apart from a legitimately-absent file, and lets a
 * read-only view (the dashboard) catch it specifically and surface a corruption
 * state instead of silently rendering a permissive empty default.
 */
export class StateFileCorruptError extends Error {
  readonly path: string;
  constructor(path: string, cause: unknown) {
    super(
      `state file corrupt: ${path} (${cause instanceof Error ? cause.message : String(cause)})`,
    );
    this.name = 'StateFileCorruptError';
    this.path = path;
  }
}

/**
 * Read + JSON-parse a state file, distinguishing ABSENT from CORRUPT:
 *   - file missing (ENOENT) → `undefined`; a fresh start is legitimate and the
 *     caller supplies its own defaults.
 *   - any other read error (EACCES, EISDIR, EMFILE, …) or a JSON parse failure
 *     → throw {@link StateFileCorruptError}. Fail closed — never silently fall
 *     back to a permissive default on a file that exists but is unreadable.
 *
 * This is the read-side half of state-file fail-open hardening; its write-side
 * twin is {@link writeJsonState}, which prevents the torn file in the first
 * place.
 */
export function readJsonState<T>(path: string): T | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new StateFileCorruptError(path, err);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new StateFileCorruptError(path, err);
  }
}

/**
 * Write-side twin of {@link readJsonState}: ensure `path`'s parent directory
 * exists, then serialize `value` as pretty-printed JSON with a trailing newline
 * and land it through {@link atomicWriteFileSync}, so a concurrent reader sees
 * either the old bytes or the complete new ones — never a torn file.
 *
 * The directory create is part of the contract precisely because
 * `atomicWriteFileSync` deliberately does not do it: its `.tmp.<pid>` sibling
 * needs a home, so every caller writing under `.noldor/` had to pair the two
 * calls by hand. Owning both directions here is what keeps the read and write
 * halves of a state file from drifting apart (a writer that skipped the
 * trailing newline, or emitted compact JSON, still parses — it just churns the
 * diff of a committed state file forever).
 *
 * Throws rather than returning a result type: a failing `mkdirSync` or rename
 * on a path the process owns is an environment/invariant failure, not an
 * expected branch a caller could meaningfully recover from. Callers whose write
 * is genuinely best-effort (`saveWatchState`) keep their own `try`.
 */
export function writeJsonState(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
