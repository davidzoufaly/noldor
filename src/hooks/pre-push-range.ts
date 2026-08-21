// @tests: src/hooks/__tests__/validate-pushed-adrs.test.ts
// Shared pre-push infrastructure: the injected git-runner seam and the strict
// stdin ref-line parser. Extracted from the retired per-commit summary-body
// scan (`validate-pushed-summaries.ts`) because the ADR append-only gate rides
// the same pre-push plumbing and must survive that scan's removal.
import { defaultRunGit, type GitOutcome as CoreGitOutcome } from '../core/branch-added.js';

/** rev-list over a large history outruns Node's 1 MiB default. */
const MAX_BUFFER = 64 * 1024 * 1024;

export type GitOutcome = CoreGitOutcome;

/**
 * The git surface pre-push scans need, injected so tests can drive command
 * failures and odd object shapes without mocking process globals.
 */
export interface GitRunner {
  text(args: readonly string[], stdin?: string): GitOutcome;
}

/**
 * Production runner, delegating to the shared `defaultRunGit` seam rather than
 * calling `spawnSync` again here.
 *
 * The spawn-level error handling (`git` off PATH, EACCES, a deleted cwd, a
 * `maxBuffer` overrun — all of which leave `status` null and `stderr` empty, so
 * a diagnostic would read `exit null`) is subtle enough that a second copy
 * drifts on the next fix. The clone detector and the code reviewer flagged the
 * duplicate independently, which is a fair sign it was one.
 */
export function createGitRunner(cwd: string = process.cwd()): GitRunner {
  const run = defaultRunGit(cwd);
  return {
    text: (args, stdin) =>
      run(args, { maxBuffer: MAX_BUFFER, ...(stdin === undefined ? {} : { stdin }) }),
  };
}

/**
 * A full git object ID: 40 hex digits (SHA-1) or 64 (SHA-256).
 *
 * Anything else must be rejected before it reaches `git rev-list --stdin` —
 * that command accepts pseudo-options such as `--no-walk` and `--not` on stdin,
 * so an unvalidated field there can shrink the candidate set instead of
 * failing.
 */
const SHA_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export function isObjectId(value: string): boolean {
  return SHA_RE.test(value);
}

export interface RefUpdate {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
}

/**
 * Parse pre-push stdin. Per `git help githooks` each line is
 * `<local ref> SP <local sha> SP <remote ref> SP <remote sha>`.
 *
 * Strict: a line with any other field count is an infrastructure failure rather
 * than something to skip, because silently ignoring a ref update is the one
 * error mode that lets an unvalidated commit through.
 */
export function parseRefLines(lines: readonly string[]): RefUpdate[] | { error: string } {
  const updates: RefUpdate[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4) {
      return { error: `malformed pre-push ref line (expected 4 fields): ${JSON.stringify(line)}` };
    }
    const [localRef, localSha, remoteRef, remoteSha] = fields as [string, string, string, string];
    // Both SHA fields must be object IDs before either reaches `rev-list --stdin`
    // (see isObjectId). Other garbage makes rev-list error out and fails closed
    // already; only the pseudo-option class fails open, and validation at a
    // trust boundary is never a permitted cut.
    for (const [label, sha] of [
      ['local', localSha],
      ['remote', remoteSha],
    ] as const) {
      if (!isObjectId(sha)) {
        return {
          error: `malformed pre-push ref line (${label} sha is not an object ID): ${JSON.stringify(line)}`,
        };
      }
    }
    updates.push({ localRef, localSha, remoteRef, remoteSha });
  }
  return updates;
}
