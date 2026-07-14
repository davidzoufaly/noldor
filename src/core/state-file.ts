import { readFileSync } from 'node:fs';

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
 * twin is {@link ./atomic-write.atomicWriteFileSync}, which prevents the torn
 * file in the first place.
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
