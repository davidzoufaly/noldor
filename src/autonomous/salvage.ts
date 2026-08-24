import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { appendAgentEvent } from '../core/agent-events.js';
import { removeBlock } from '../utils/write-blocks.js';

/** Injected process runner: ok=false on nonzero exit. Production uses spawnSync; tests script it. */
export type GitRunner = (cmd: string, args: string[]) => { ok: boolean; stdout: string };

export type StaleReason =
  | 'local-branch-behind-main'
  | 'closed-unmerged-pr'
  | 'orphan-remote-branch';

/**
 * Classify provably-wedging leftover state for the drain's own branch (spec Unit 2).
 * Called after the worker's open-PR guard, so "no open PR" is already guaranteed.
 * A current-base local branch with no PR is NOT stale — the gate child's
 * force-recreate owns that case. Fail-closed on tool failure: a failed `gh pr
 * list` or `ls-remote` throws rather than reading as "clean" — guessing could
 * re-wedge the very case salvage exists to fix. (`rev-parse` !ok legitimately
 * means "no local branch" and `merge-base --is-ancestor` !ok legitimately means
 * "not an ancestor" — those two are semantic, not failures.)
 */
export function detectStale(run: GitRunner, branch: string): StaleReason[] {
  const reasons: StaleReason[] = [];
  const local = run('git', ['rev-parse', '--verify', branch]);
  if (local.ok) {
    const ancestor = run('git', ['merge-base', '--is-ancestor', 'origin/main', branch]);
    if (!ancestor.ok) reasons.push('local-branch-behind-main');
  }
  if (hasClosedUnmergedPr(run, branch)) reasons.push('closed-unmerged-pr');
  const remote = run('git', ['ls-remote', '--heads', 'origin', branch]);
  if (!remote.ok) throw new Error(`salvage: ls-remote failed for ${branch} — refusing to guess`);
  if (remote.stdout.trim() !== '') reasons.push('orphan-remote-branch');
  return reasons;
}

/**
 * Single `gh` query behind the `closed-unmerged-pr` verdict — a PR for this branch that a human
 * closed without merging. Extracted so {@link detectStale} and the drain loop's finish-mode
 * exclusion share one definition WITHOUT the caller that only needs this verdict paying for
 * detectStale's other probes: its `ls-remote` leg throws on a network blip, and from a settle-point
 * caller that throw becomes a whole-drain abort rather than a retry.
 *
 * Fail-closed on a `gh` failure, like the detector it feeds: guessing "no closed PR" would let the
 * loop reuse a branch a human rejected.
 */
export function hasClosedUnmergedPr(run: GitRunner, branch: string): boolean {
  const prs = run('gh', [
    'pr',
    'list',
    '--state',
    'closed',
    '--head',
    branch,
    '--json',
    'mergedAt',
  ]);
  if (!prs.ok) throw new Error(`salvage: gh pr list failed for ${branch} — refusing to guess`);
  const rows = JSON.parse(prs.stdout || '[]') as Array<{ mergedAt: string | null }>;
  return rows.some((r) => r.mergedAt === null);
}

/**
 * State of the checkout at `path` for the "is someone working here" question.
 * `-uno`, so an untracked scratch file cannot decide the fate of committed work;
 * the recoverability asymmetry the callers act on is about the index and tracked
 * edits, which no reflog holds.
 *
 * `'unknown'` is its own answer rather than a guess, because the two callers need
 * opposite fail-safe directions from the same probe: for `classifyDrainBranch`
 * dirt routes toward rebuild, so an unanswerable probe must not read as dirty;
 * for `pruneShippedWorktrees` dirt is the only thing left sparing the worktree by
 * the time it asks, so an unanswerable probe must not read as clean. Collapsing
 * it here would hand one of them the deletion-side error.
 */
export function checkoutDirtState(run: GitRunner, path: string): 'dirty' | 'clean' | 'unknown' {
  const r = run('git', ['-C', path, 'status', '--porcelain', '-uno']);
  if (!r.ok) return 'unknown';
  return r.stdout.trim() === '' ? 'clean' : 'dirty';
}

/** {@link checkoutDirtState} collapsed toward "not dirty" — the fail-open read. */
export function checkoutIsDirty(run: GitRunner, path: string): boolean {
  return checkoutDirtState(run, path) === 'dirty';
}

/**
 * Clean room for one slug: worktree dir, local branch, remote branch — each
 * best-effort (already-gone is fine). Closed PRs are left as history.
 * Branch is always the drain's own `fast/<slug>` namespace (see autonomy.md
 * for the namespace-collision caveat).
 */
export function repair(run: GitRunner, slug: string): void {
  run('git', ['worktree', 'remove', '--force', `.worktrees/${slug}`]);
  run('git', ['branch', '-D', `fast/${slug}`]);
  run('git', ['push', 'origin', '--delete', `fast/${slug}`]);
}

/** Production runner bound to cwd. */
export function spawnRunner(cwd: string): GitRunner {
  return (cmd, args) => {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: r.status === 0, stdout: r.stdout ?? '' };
  };
}

/**
 * Production `DrainDeps.salvageStaleBase`. Detects, repairs, and appends a
 * `salvaged` agent-event (fail-open by appendAgentEvent's contract). Detection
 * errors propagate — the loop treats a thrown dep as a systemic abort. `role`
 * attributes the event to the wiring entry point (`watch` daemon vs one-shot
 * `run`) so telemetry stays honest.
 */
export function makeSalvage(
  cwd: string,
  role: 'watch' | 'run',
): (slug: string, branch: string) => 'clean' | 'salvaged' {
  const run = spawnRunner(cwd);
  return (slug, branch) => {
    const started = Date.now();
    const reasons = detectStale(run, branch);
    if (reasons.length === 0) return 'clean';
    repair(run, slug);
    appendAgentEvent(cwd, {
      ts: new Date().toISOString(),
      runner: 'drain',
      role,
      kind: 'salvaged',
      slug,
      site: reasons.join(','),
      ...(process.env.NOLDOR_RUN_ID !== undefined ? { runId: process.env.NOLDOR_RUN_ID } : {}),
      exitCode: 0,
      durationMs: Date.now() - started,
      timedOut: false,
    });
    return 'salvaged';
  };
}

/**
 * Production `DrainDeps.closedUnmergedPrExistsFor`. Binds {@link hasClosedUnmergedPr} — the same
 * verdict {@link detectStale} uses, and ONLY that verdict: the other two stale reasons must not
 * disqualify a branch from finish mode. `orphan-remote-branch` IS the finishable signature (a child
 * that pushed without opening a PR), and `local-branch-behind-main` fires whenever `main` advanced
 * mid-run, which says nothing about whether the branch's own work is deliverable.
 */
export function makeClosedUnmergedPrProbe(cwd: string): (slug: string, branch: string) => boolean {
  const run = spawnRunner(cwd);
  return (_slug, branch) => hasClosedUnmergedPr(run, branch);
}

/** Injected file writer (defaults to fs); split out so the resolver stays unit-pure. */
export type FileWriter = (path: string, content: string) => void;

/**
 * Auto-resolve an *adjacent `docs/roadmap.md` block-removal* merge conflict for one
 * open fast-track PR under parallel drain (K>1). The correct post-merge content is
 * deterministic — "the caller's current `origin/main` roadmap, minus this slug's
 * block" — so we re-apply {@link removeBlock} against `origin/main` rather than
 * letting git's textual 3-way merge fail. Freshness of `origin/main` is the caller's
 * responsibility (the coordinator's `syncMainCleanState` fetches before each merge);
 * this function does not fetch. See the design spec
 * (`docs/design/specs/2026-06-14-parallel-drain-roadmapmd-conflict-auto-resolution-design.md`).
 *
 * Pure/IO split in the {@link detectStale}/{@link repair} style (GitRunner +
 * FileWriter injection) so the branching logic is unit-tested without shelling out.
 * Operates in a scratch worktree `.worktrees/.merge-<slug>` cut from the PR tip so it
 * never touches a live build worktree or the main workspace HEAD while K workers run.
 * `cwd` is the repo root the injected `run` is bound to — git resolves `wt` against
 * it via `-C`, and the FileWriter must too, so the write path is absolute (`join(cwd,
 * wt, …)`); a relative path would resolve against `process.cwd()` and silently miss
 * the scratch tree when they differ.
 *
 * FAIL-CLOSED: any conflict touching a path other than `docs/roadmap.md`, a thrown
 * `removeBlock` (block already gone), or any unexpected git `!ok` returns
 * `'unresolvable'` (today's leave-PR-open behaviour) — never throws, never guesses.
 * On every post-creation failure it best-effort aborts the rebase and removes the
 * scratch worktree so nothing leaks.
 */
export function resolveRoadmapConflict(
  run: GitRunner,
  slug: string,
  branch: string,
  cwd: string,
  removeBlockFn: typeof removeBlock = removeBlock,
  roadmapRel = 'docs/roadmap.md',
  maxAttempts = 3,
  writeFile: FileWriter = (p, c) => writeFileSync(p, c, 'utf8'),
): 'resolved' | 'unresolvable' {
  const wt = `.worktrees/.merge-${slug}`;
  const wtGit = (...args: string[]): { ok: boolean; stdout: string } =>
    run('git', ['-C', wt, ...args]);
  const removeWorktree = (): void => {
    run('git', ['worktree', 'remove', '--force', wt]);
  };
  const abandon = (abort: boolean): 'unresolvable' => {
    if (abort) wtGit('rebase', '--abort');
    removeWorktree();
    return 'unresolvable';
  };

  // Scratch worktree at the open PR's branch tip; --force tolerates a stale leftover dir.
  if (!run('git', ['worktree', 'add', '--force', wt, `origin/${branch}`]).ok) return 'unresolvable';

  let rebase = wtGit('rebase', 'origin/main');
  let attempts = 0;
  while (!rebase.ok) {
    if (++attempts > maxAttempts) return abandon(true); // pathological re-conflict backstop
    const unmerged = wtGit('diff', '--name-only', '--diff-filter=U')
      .stdout.split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    // Fail closed on any non-roadmap conflict — a genuine code conflict between two
    // fast-track features must stay human-escalated.
    if (unmerged.length !== 1 || unmerged[0] !== roadmapRel) return abandon(true);

    const base = wtGit('show', `origin/main:${roadmapRel}`);
    if (!base.ok) return abandon(true);
    let newRaw: string;
    try {
      // Contract: a fast-track child's only roadmap edit is removing its own block, so
      // the branch has exactly one roadmap-touching commit and `main-minus-slug` is the
      // correct content for the single conflicting commit. A multi-commit roadmap branch
      // would re-stage identical content each `--continue` and stall out (maxAttempts caps it).
      newRaw = removeBlockFn(base.stdout, slug).newRaw;
    } catch {
      // Block already removed from the fresh base by a prior PR — don't guess.
      return abandon(true);
    }
    // Absolute path: `run` (and thus `-C wt`) is bound to `cwd`, so the writer must
    // target `cwd/wt/…` rather than a `process.cwd()`-relative path.
    writeFile(join(cwd, wt, roadmapRel), newRaw);
    wtGit('add', roadmapRel);
    rebase = wtGit('rebase', '--continue'); // ok → rebase complete; !ok → next conflict, loop
  }

  if (!wtGit('push', '--force-with-lease', 'origin', `HEAD:${branch}`).ok) return abandon(false);
  removeWorktree();
  return 'resolved';
}

/**
 * Production `mergePr` conflict resolver: binds a runner to `cwd`, times the attempt,
 * and on success appends a `kind: 'resolved'` agent-event (telemetry honesty — this
 * merge was machine-rebased, not a plain ship). Mirrors {@link makeSalvage}; keeps the
 * `drain-io` wiring thin. `appendAgentEvent` is fail-open by contract.
 */
export function makeRoadmapConflictResolver(
  cwd: string,
  role: 'watch' | 'run' = 'run',
): (slug: string, branch: string) => 'resolved' | 'unresolvable' {
  const run = spawnRunner(cwd);
  return (slug, branch) => {
    const started = Date.now();
    const outcome = resolveRoadmapConflict(run, slug, branch, cwd);
    if (outcome === 'resolved')
      appendAgentEvent(cwd, {
        ts: new Date().toISOString(),
        runner: 'drain',
        role,
        kind: 'resolved',
        slug,
        ...(process.env.NOLDOR_RUN_ID !== undefined ? { runId: process.env.NOLDOR_RUN_ID } : {}),
        exitCode: 0,
        durationMs: Date.now() - started,
        timedOut: false,
      });
    return outcome;
  };
}
