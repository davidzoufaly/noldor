// @fd: autonomous-queue-drain-runner

/**
 * `noldor autonomous branch-state <slug>` — decide finish-vs-rebuild for a drain
 * entry's `fast/<slug>` branch from the branch itself.
 *
 * The drain-mode contract tells a child to force-recreate `fast/<slug>`
 * ("abandoned work safe to discard") because the *supervisor* already proved the
 * alternative: it knows whether the prior child exited 0 and sends `--finish`
 * when it did. A drain invoked by hand carries no such signal, so obeying the
 * override literally deletes finished work — on Q-0107 that branch held 7
 * commits with green tests, and the remote delete is unrecoverable.
 *
 * This module recomputes the decision from git instead of trusting an absent
 * flag, mirroring both legs of the supervisor's own finish gate
 * (`drain-loop.ts`): commits ahead of `origin/main` (local ref or
 * `origin/<branch>` — the pushed-but-no-PR case), no PR a human closed unmerged,
 * and a clean checkout means deliver; nothing ahead means rebuild. A branch whose
 * PR was closed unmerged rebuilds — that work was rejected, not undelivered. A
 * checkout with tracked uncommitted changes also rebuilds, matching the finish
 * path's trust rule (a half-done tree is not deliverable) — the verdict's
 * `reason` names the dirty path and the range to read so the caller can surface
 * what a force-recreate is about to discard rather than deleting silently.
 * Untracked files are deliberately not dirt (`status -uno`): a stray scratch file
 * must not authorize deleting committed work.
 *
 * Fail-closed where the evidence is missing: on the no-work path a failed
 * `git fetch origin` leaves no way to prove the remote carries no undelivered
 * work, so the verdict is `unknown` and the caller must stop. (With local commits
 * in hand the remote's freshness no longer decides, so that leg does not consult
 * it; an unanswerable `gh` closed-PR probe is the fail-closed stop there.) This is the opposite bias to
 * {@link branchHasUnshippedWork}'s (which errs toward rebuilding): that probe
 * runs inside the supervisor, where a wrong answer costs one rebuild of work the
 * supervisor can re-derive; here a wrong answer is a deletion.
 *
 * // noldor:cut reuses branchHasUnshippedWork, whose fail-open maps ANY `rev-list`
 * failure to "no work" — a non-semantic git failure on both refs therefore reads
 * as `rebuild` despite this module's fail-closed bias. Fine while both refs
 * normally resolve; upgrade path is a probe that distinguishes "ref absent" from
 * "git failed" and routes the latter to `unknown`.
 */

import { parseWorktrees } from './drain-reconcile.js';
import { branchHasUnshippedWork } from './drain-io.js';
import { checkoutIsDirty, hasClosedUnmergedPr, spawnRunner, type GitRunner } from './salvage.js';
import { runIfDirect } from '../core/cli-entry.js';

/** `finish` = deliver the existing branch; `rebuild` = safe to force-recreate; `unknown` = stop. */
export type DrainBranchVerdict = 'finish' | 'rebuild' | 'unknown';

export interface DrainBranchState {
  readonly slug: string;
  readonly branch: string;
  readonly verdict: DrainBranchVerdict;
  /** Commits exist ahead of `origin/main` on the local branch or on `origin/<branch>`. */
  readonly hasWork: boolean;
  /** Path of the branch's checkout when it holds tracked uncommitted changes, else null. */
  readonly dirtyWorktree: string | null;
  /** A human closed this branch's PR without merging — the work was rejected. */
  readonly rejectedPr: boolean;
  /** False when `git fetch origin` failed — remote evidence is stale. */
  readonly remoteFetched: boolean;
  /** Operator-facing one-liner: what was found and what it implies. */
  readonly reason: string;
}

/** Exit code per verdict: rebuild 0, finish 10, unknown 1. */
export const VERDICT_EXIT: Record<DrainBranchVerdict, number> = {
  rebuild: 0,
  finish: 10,
  unknown: 1,
};

/**
 * Path of the worktree that has `branch` checked out, or null when the branch is
 * checked out nowhere. Porcelain parsing is {@link parseWorktrees}'s (same
 * directory, already strips `refs/heads/`).
 */
export function worktreeFor(run: GitRunner, branch: string): string | null {
  const r = run('git', ['worktree', 'list', '--porcelain']);
  if (!r.ok) return null;
  return parseWorktrees(r.stdout).find((e) => e.branch === branch)?.path ?? null;
}

/**
 * Did a human close this branch's PR without merging? `'unknown'` when `gh`
 * failed: {@link hasClosedUnmergedPr} is fail-closed by throwing, and both of the
 * answers it could have given change the verdict (deliver vs delete), so the
 * caller must stop rather than pick one.
 */
function closedUnmergedPr(run: GitRunner, branch: string): boolean | 'unknown' {
  try {
    return hasClosedUnmergedPr(run, branch);
  } catch {
    return 'unknown';
  }
}

/**
 * Classify `fast/<slug>` into {@link DrainBranchVerdict}. Fetches `origin` first
 * so a stale remote-tracking ref can't hide pushed-but-undelivered work; a
 * failed fetch with no local evidence yields `unknown` rather than a deletion.
 */
export function classifyDrainBranch(run: GitRunner, slug: string): DrainBranchState {
  const branch = `fast/${slug}`;
  const remoteFetched = run('git', ['fetch', 'origin']).ok;
  const hasWork = branchHasUnshippedWork(run, slug, branch);
  const worktree = worktreeFor(run, branch);
  const dirtyWorktree = worktree !== null && checkoutIsDirty(run, worktree) ? worktree : null;
  const rejected = hasWork ? closedUnmergedPr(run, branch) : false;
  const base = {
    slug,
    branch,
    hasWork,
    dirtyWorktree,
    rejectedPr: rejected === true,
    remoteFetched,
  };

  if (hasWork && rejected === 'unknown') {
    return {
      ...base,
      verdict: 'unknown',
      reason: `${branch} carries commits but \`gh\` could not say whether a human closed its PR unmerged — refusing to guess between delivering rejected work and deleting good work`,
    };
  }
  if (hasWork && rejected === true) {
    return {
      ...base,
      verdict: 'rebuild',
      reason: `${branch} carries commits but a human closed its PR without merging — the work was rejected, so rebuild rather than re-delivering it; read \`git log origin/main..${branch}\` if you need to know what it held`,
    };
  }
  if (hasWork && dirtyWorktree === null) {
    return {
      ...base,
      verdict: 'finish',
      reason: `${branch} carries commits ahead of origin/main and its checkout is clean — deliver it (finish mode); do NOT force-recreate`,
    };
  }
  if (hasWork) {
    return {
      ...base,
      verdict: 'rebuild',
      reason: `${branch} carries commits ahead of origin/main but ${dirtyWorktree} has uncommitted changes — a half-done tree is not deliverable, so rebuild; inspect \`git log origin/main..${branch}\` before discarding it`,
    };
  }
  if (!remoteFetched) {
    return {
      ...base,
      verdict: 'unknown',
      reason: `git fetch origin failed — cannot prove ${branch} carries no undelivered work; refusing to authorize a force-recreate`,
    };
  }
  return {
    ...base,
    verdict: 'rebuild',
    reason:
      dirtyWorktree === null
        ? `no commits ahead of origin/main on ${branch} or origin/${branch} — nothing to lose, safe to force-recreate`
        : `no commits ahead of origin/main on ${branch} or origin/${branch}, so nothing committed is at risk — but ${dirtyWorktree} has uncommitted tracked changes that the force-recreate will discard; read them first`,
  };
}

function formatState(s: DrainBranchState): string {
  return `verdict: ${s.verdict}\n${s.reason}\n`;
}

async function main(argv: string[]): Promise<number> {
  const slug = argv.find((a) => !a.startsWith('--'));
  if (slug === undefined) {
    process.stderr.write('usage: noldor autonomous branch-state <slug> [--json]\n');
    return 1;
  }
  const state = classifyDrainBranch(spawnRunner(process.cwd()), slug);
  process.stdout.write(argv.includes('--json') ? `${JSON.stringify(state)}\n` : formatState(state));
  return VERDICT_EXIT[state.verdict];
}

runIfDirect('drain-branch-state', 'branch-state', main);
