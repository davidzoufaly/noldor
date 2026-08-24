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
 * flag: commits ahead of `origin/main` (local ref or `origin/<branch>` — the
 * pushed-but-no-PR case) plus a clean checkout means deliver; nothing ahead
 * means rebuild. A dirty checkout also reads as rebuild, matching the finish
 * path's trust rule (a half-done tree is not deliverable) — the verdict's
 * `reason` names the dirty path and the range to read so the caller can surface
 * what a force-recreate is about to discard rather than deleting silently.
 *
 * Fail-closed where the evidence is missing: when `git fetch origin` fails there
 * is no way to prove the remote carries no undelivered work, so the verdict is
 * `unknown` and the caller must stop. This is the opposite bias to
 * {@link branchHasUnshippedWork}'s (which errs toward rebuilding): that probe
 * runs inside the supervisor, where a wrong answer costs one rebuild of work the
 * supervisor can re-derive; here a wrong answer is a deletion.
 */

import { branchHasUnshippedWork } from './drain-io.js';
import { spawnRunner, type GitRunner } from './salvage.js';
import { runIfDirect } from '../core/cli-entry.js';

/** `finish` = deliver the existing branch; `rebuild` = safe to force-recreate; `unknown` = stop. */
export type DrainBranchVerdict = 'finish' | 'rebuild' | 'unknown';

export interface DrainBranchState {
  readonly slug: string;
  readonly branch: string;
  readonly verdict: DrainBranchVerdict;
  /** Commits exist ahead of `origin/main` on the local branch or on `origin/<branch>`. */
  readonly hasWork: boolean;
  /** Path of the branch's checkout when it holds uncommitted changes, else null. */
  readonly dirtyWorktree: string | null;
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
 * checked out nowhere. Parses `git worktree list --porcelain`, whose records are
 * blank-line separated `worktree <path>` … `branch <ref>` blocks.
 */
export function worktreeFor(run: GitRunner, branch: string): string | null {
  const r = run('git', ['worktree', 'list', '--porcelain']);
  if (!r.ok) return null;
  let path: string | null = null;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length).trim();
    if (line.trim() === `branch refs/heads/${branch}`) return path;
  }
  return null;
}

/** Uncommitted changes (tracked or untracked) in `path`. A failed probe reads as clean. */
function isDirty(run: GitRunner, path: string): boolean {
  const r = run('git', ['-C', path, 'status', '--porcelain']);
  return r.ok && r.stdout.trim() !== '';
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
  const dirtyWorktree = worktree !== null && isDirty(run, worktree) ? worktree : null;
  const base = { slug, branch, hasWork, dirtyWorktree, remoteFetched };

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
    reason: `no commits ahead of origin/main on ${branch} or origin/${branch} — nothing to lose, safe to force-recreate`,
  };
}

export function formatState(s: DrainBranchState): string {
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
