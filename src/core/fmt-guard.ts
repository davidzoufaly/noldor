/**
 * Pure decision logic for the fmt all-ignored no-op guard.
 *
 * oxfmt exits 1 with "Expected at least one target file" when its resolved
 * target set is empty — e.g. a commit that stages only oxfmt-ignored files
 * (`**\/*.md`, `graphify-out/**`, lockfiles per `.oxfmtrc.json`). That is not a
 * formatting failure; there is simply nothing to check. This module is the
 * single source of truth for the marker string + the swallow rule, replacing
 * the inline bash guard that previously lived (duplicated) in
 * `lefthook/noldor.yml` and its `templates/` twin.
 *
 * Pure — no spawn, no I/O. The CLI wrapper ({@link ./fmt-guard-cli.ts}) feeds it
 * a raw run result and acts on the decision.
 */

/** The exact oxfmt message emitted when no target file survives its ignores. */
export const NO_TARGET_MARKER = 'Expected at least one target file';

/** A raw oxfmt run: exit status (null if killed by signal) + captured streams. */
export interface FmtRunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** The guarded outcome: the code to exit with, the output to emit, and whether
 * the no-target error was swallowed. */
export interface FmtGuardDecision {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly swallowed: boolean;
}

/**
 * True when the run failed *solely* because oxfmt had no target files to act
 * on. A clean run (status 0) is never a no-target failure; a real format
 * failure carries a non-zero status but not the marker.
 */
export function isNoTargetFailure(status: number | null, combinedOutput: string): boolean {
  return status !== 0 && combinedOutput.includes(NO_TARGET_MARKER);
}

/**
 * Map a raw oxfmt run to a guarded outcome. A no-target failure becomes exit 0
 * with its output suppressed (nothing was wrong, so nothing to report).
 * Everything else passes through verbatim: clean runs (status 0) and real
 * format failures (non-zero status + diff output) alike. A `null` status
 * (signal kill) is treated as a genuine failure → exit 1.
 */
export function decideFmtGuard(result: FmtRunResult): FmtGuardDecision {
  const combined = result.stdout + result.stderr;
  if (isNoTargetFailure(result.status, combined)) {
    return { code: 0, stdout: '', stderr: '', swallowed: true };
  }
  return {
    code: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
    swallowed: false,
  };
}
