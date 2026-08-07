/**
 * Pure verdict logic for the `noldor commit` wrapper.
 *
 * `git commit -m '…' | tail` reports `tail`'s exit code, so a pre-commit red
 * reads as success while nothing landed and every file stays staged. Exit-code
 * fidelity alone cannot fix that — the caller threw the code away. So the
 * wrapper also emits a fixed-prefix verdict as the LAST thing on stdout: piped
 * or not, the tail of the output states whether a commit exists.
 *
 * Ground truth is HEAD movement, not the exit status: a commit landed only when
 * HEAD points somewhere new. The status still drives the exit code (the entry's
 * "surface the real git exit code"); it never overrides the observation.
 *
 * Pure — no spawn, no I/O. {@link ./commit-cli.ts} observes and prints.
 */

/** Prefix on every verdict line — the token a `| tail` reader greps for. */
export const VERDICT_PREFIX = 'noldor commit:';

/** How many staged paths a verdict enumerates before eliding the rest. */
export const STAGED_LIST_CAP = 10;

/** Observed state around one `git commit` run. */
export interface CommitObservation {
  /** git's exit status; `null` when the spawn failed or a signal killed it. */
  readonly status: number | null;
  /** HEAD before the run; `null` on an unborn HEAD (first commit) or git failure. */
  readonly headBefore: string | null;
  /** HEAD after the run; `null` when still unborn. */
  readonly headAfter: string | null;
  /** Subject line of `headAfter`, when resolvable. */
  readonly subjectAfter: string | null;
  /** Paths still in the index after the run. */
  readonly stagedAfter: readonly string[];
  /** True when the invocation carried `--dry-run` (HEAD is expected to hold). */
  readonly dryRun: boolean;
}

/** What actually happened, independent of what the exit code claims. */
export type CommitOutcome = 'committed' | 'no-op' | 'failed';

/** The wrapper's decision: exit code, outcome, and the lines to print last. */
export interface CommitVerdict {
  readonly code: number;
  readonly outcome: CommitOutcome;
  readonly lines: readonly string[];
}

/** Short-form sha for human-facing lines; passes through anything atypical. */
function short(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

/** `a.ts, b.ts, … (+3 more)` — bounded so a bulk stage can't flood the tail. */
function renderStaged(paths: readonly string[]): string {
  const head = paths.slice(0, STAGED_LIST_CAP).join(', ');
  const rest = paths.length - STAGED_LIST_CAP;
  return rest > 0 ? `${head}, … (+${rest} more)` : head;
}

/**
 * Classify a run. A commit landed only when git succeeded *and* HEAD moved —
 * `--dry-run` and an empty-but-tolerated commit both exit 0 without moving it,
 * and reporting either as `committed` would reintroduce the lie this wrapper
 * exists to kill.
 */
export function classifyCommit(obs: CommitObservation): CommitOutcome {
  if (obs.status !== 0) return 'failed';
  return obs.headAfter !== null && obs.headAfter !== obs.headBefore ? 'committed' : 'no-op';
}

/**
 * Map an observation to the verdict. The exit code is always git's own
 * (`null` → 1, covering spawn failure and signal death); the lines report what
 * the working tree shows. On failure the staged set is named explicitly —
 * "nothing committed" is only half the story when the files are still staged
 * and the next command may commit them by accident.
 */
export function decideCommitVerdict(obs: CommitObservation): CommitVerdict {
  const outcome = classifyCommit(obs);
  const code = obs.status ?? 1;
  const lines: string[] = [];

  if (outcome === 'committed') {
    const sha = short(obs.headAfter!);
    const subject = obs.subjectAfter ? ` ${obs.subjectAfter}` : '';
    lines.push(`${VERDICT_PREFIX} OK — committed ${sha}${subject}`);
    if (obs.stagedAfter.length > 0) {
      lines.push(
        `${VERDICT_PREFIX} note — ${obs.stagedAfter.length} path(s) remain staged: ${renderStaged(obs.stagedAfter)}`,
      );
    }
    return { code, outcome, lines };
  }

  if (outcome === 'no-op') {
    const why = obs.dryRun ? '--dry-run' : 'HEAD did not move';
    lines.push(`${VERDICT_PREFIX} NO-OP — git exited 0 but nothing was committed (${why})`);
    if (obs.stagedAfter.length > 0) {
      lines.push(
        `${VERDICT_PREFIX} ${obs.stagedAfter.length} path(s) still staged: ${renderStaged(obs.stagedAfter)}`,
      );
    }
    return { code, outcome, lines };
  }

  const how = obs.status === null ? 'git did not run to completion' : `git exit ${obs.status}`;
  // Read HEAD even on the failure path. A failed run that nonetheless moved
  // HEAD is rare, but asserting "nothing was committed" from the exit status
  // alone would be the same exit-status-over-observation lie this wrapper kills.
  const moved = obs.headAfter !== null && obs.headAfter !== obs.headBefore;
  const what = moved
    ? `HEAD still moved to ${short(obs.headAfter!)} — inspect before retrying`
    : 'nothing was committed';
  lines.push(`${VERDICT_PREFIX} FAILED — ${how}; ${what}`);
  lines.push(
    obs.stagedAfter.length > 0
      ? `${VERDICT_PREFIX} ${obs.stagedAfter.length} path(s) still staged: ${renderStaged(obs.stagedAfter)}`
      : `${VERDICT_PREFIX} index is empty — nothing was staged to commit`,
  );
  return { code, outcome, lines };
}
