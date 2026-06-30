import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isAlive } from './drain-lock.js';
import { classifyMergeView, mergePr, type MergeOutcome } from './drain-io.js';
import type { DrainSource } from './drain-source.js';
import type { DrainState } from './drain-state.js';

/**
 * Startup reconciliation of a prior dead drain run (spec
 * `drain-startup-reconciliation-of-a-prior-dead-run`). Heals the mess a
 * crash / SIGKILL / session-pause leaves behind — orphan agent process groups,
 * open drain PRs, and orphaned shipped worktrees — and pre-flights a
 * local-ahead-of-origin divergence. Pure of IO except through injected
 * {@link ReconcileDeps}; the production deps are bound by {@link makeReconcileDeps}.
 */

export interface ReconcileReport {
  /** pgids the reap pass killed (dry-run: would kill). */
  reapedPgids: number[];
  /** Slugs whose open drain PR was merged (dry-run: would merge). */
  merged: string[];
  /** Slugs whose dirty/conflicting drain PR was closed for rebuild (dry-run: would close). */
  closedDirty: string[];
  /** Slugs whose orphaned shipped worktree was pruned (dry-run: would prune). */
  prunedWorktrees: string[];
}

/** One open PR row from `gh pr list --state open`. */
export interface OpenPrView {
  number: number;
  headRefName: string;
  mergeStateStatus: string;
  mergedAt: string | null;
  state: string;
}

/** One worktree parsed from `git worktree list --porcelain`. `branch` is the short ref (prefix stripped). */
export interface WorktreeEntry {
  path: string;
  branch: string;
}

export interface ReconcileDeps {
  /** Prior run's heartbeat, or null when absent / unreadable. */
  readDrainState: () => DrainState | null;
  /** Liveness probe (drain-lock's {@link isAlive} in production). */
  isAlive: (pid: number) => boolean;
  /** Group-kill a pgid (`process.kill(-pgid, 'SIGKILL')`, ESRCH/EPERM swallowed). */
  killPgid: (pgid: number) => void;
  /** Advance local main to origin (the existing `syncMainCleanState`). */
  syncMain: () => void;
  /** Throw loud when local main is ahead of origin (the new `assertQueueSourceSynced`). */
  assertSynced: () => void;
  /** All open PRs (namespace filtering happens in {@link reconcileOpenPrs}). */
  listOpenPrs: () => OpenPrView[];
  /** Bounded squash-merge of one open PR; resolves with the outcome. */
  mergePr: (slug: string, branch: string) => Promise<MergeOutcome>;
  /** Close an open PR by its head branch (`gh pr close`). */
  closePr: (branch: string) => void;
  /** All git worktrees (porcelain-parsed). */
  listWorktrees: () => WorktreeEntry[];
  /** Remove a drain worktree dir + delete its local branch. */
  removeWorktree: (slug: string, branch: string) => void;
}

/**
 * Parse `git worktree list --porcelain` into {@link WorktreeEntry}s. Blocks are
 * separated by blank lines; each carries a `worktree <path>` line and (unless
 * detached) a `branch refs/heads/<name>` line. The `refs/heads/` prefix is
 * stripped so callers compare against the source's short branch namespace.
 */
export function parseWorktrees(porcelain: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let path: string | null = null;
  let branch = '';
  const flush = (): void => {
    if (path !== null) entries.push({ path, branch });
    path = null;
    branch = '';
  };
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush();
      path = line.slice('worktree '.length).trim();
    } else if (line.startsWith('branch ')) {
      branch = line
        .slice('branch '.length)
        .trim()
        .replace(/^refs\/heads\//, '');
    }
  }
  flush();
  return entries;
}

/**
 * Reap the orphan agent process groups of a prior dead run. No-op unless the
 * recorded `pid` is confirmed dead (a live prior run owns its own children) and
 * the state carries `agentPgids`. Self-protecting: if the state is this run's own
 * (pid === own pid), the liveness probe returns true and nothing is killed.
 * Returns the pgids acted on (best-effort telemetry for the report).
 */
export function reapOrphanAgents(deps: ReconcileDeps, dryRun = false): number[] {
  const state = deps.readDrainState();
  if (state === null) return [];
  if (deps.isAlive(state.pid)) return []; // prior run still alive — its children are not orphans
  const pgids = state.agentPgids ?? [];
  if (!dryRun) for (const pgid of pgids) deps.killPgid(pgid);
  return [...pgids];
}

/**
 * Heal the prior run's open PRs in the source's branch namespace. CLEAN/pending →
 * bounded merge (advances the oracle on success; non-merge is left for the
 * worker's open-PR guard to re-observe). DIRTY/CONFLICTING → close, leaving the
 * branch so the next drain's `salvageStaleBase` rebuilds it. Already-merged → no-op.
 *
 * TWO guards keep this from clobbering anything but the drain's own leftovers: the
 * head must be in the source's branch namespace (`fast/` | `feat/`) AND the slug
 * must still be in the universe (`source.parseAll()`). The universe guard is what
 * scopes this to "an **in-roadmap** slug with an open PR" (the spec's wording) —
 * an ordinary interactive fast-track / no-FD PR shares the `fast/*` namespace but
 * its slug is NOT in the roadmap, so it is never auto-merged or auto-closed.
 * (`pruneShippedWorktrees` carries the mirror guard.)
 */
export async function reconcileOpenPrs(
  deps: ReconcileDeps,
  source: DrainSource,
  dryRun = false,
): Promise<{ merged: string[]; closedDirty: string[] }> {
  const prefix = source.branchFor(''); // 'fast/' (roadmap) | 'feat/' (plans)
  const universe = new Set(source.parseAll());
  const merged: string[] = [];
  const closedDirty: string[] = [];
  for (const pr of deps.listOpenPrs()) {
    if (!pr.headRefName.startsWith(prefix)) continue; // not the drain's namespace — never touch
    const slug = pr.headRefName.slice(prefix.length);
    if (!universe.has(slug)) continue; // in-namespace but not a drain entry (e.g. a human fast-track PR)
    const verdict = classifyMergeView({
      mergedAt: pr.mergedAt,
      mergeStateStatus: pr.mergeStateStatus,
      state: pr.state,
    });
    if (verdict === 'merged') continue; // oracle already advanced
    if (verdict === 'merge-conflict') {
      if (!dryRun) deps.closePr(pr.headRefName);
      closedDirty.push(slug);
      continue;
    }
    // pending / CLEAN → bounded merge attempt.
    if (dryRun) {
      merged.push(slug);
      continue;
    }
    const outcome = await deps.mergePr(slug, pr.headRefName);
    if (outcome === 'merged') merged.push(slug);
    // non-merge (conflict surfaced mid-poll / timeout) → leave open; worker re-observes it.
  }
  return { merged, closedDirty };
}

/**
 * GC the prior run's orphaned worktrees: a `.worktrees/<slug>` on the source's
 * branch namespace whose slug is no longer in the universe (already shipped /
 * retired). Two guards keep it from touching anything else — the branch must be
 * in the drain namespace AND the path must be the drain's own `.worktrees/<slug>`
 * (so a human's `.claude/worktrees/*` or an unrelated branch is never removed).
 */
export function pruneShippedWorktrees(
  deps: ReconcileDeps,
  source: DrainSource,
  dryRun = false,
): string[] {
  const prefix = source.branchFor('');
  const universe = new Set(source.parseAll());
  const pruned: string[] = [];
  for (const wt of deps.listWorktrees()) {
    if (!wt.branch.startsWith(prefix)) continue; // not a drain branch
    const slug = wt.branch.slice(prefix.length);
    const isDrainWorktreePath =
      wt.path === `.worktrees/${slug}` || wt.path.endsWith(`/.worktrees/${slug}`);
    if (!isDrainWorktreePath) continue; // a human worktree on a same-prefix branch — leave it
    if (universe.has(slug)) continue; // still in-universe (in-flight / to-ship) — leave it
    if (!dryRun) deps.removeWorktree(slug, wt.branch);
    pruned.push(slug);
  }
  return pruned;
}

/**
 * The startup reconciliation pass. Runs once after lock acquisition, before the
 * first gate spawn. Order: reap stragglers → sync + divergence pre-flight → heal
 * PRs → prune the freed worktrees. Idempotent — each sub-unit is a no-op when its
 * input set is empty, so a clean startup returns an all-empty report and makes
 * zero kill/merge/close/remove calls. `assertSynced` may throw (local-ahead) →
 * the caller exits 1 before any gate child wastes work. Skipped under `dryRun`,
 * which never mutates and never aborts — it only reports the would-do plan.
 */
export async function reconcileDeadRun(
  deps: ReconcileDeps,
  source: DrainSource,
  dryRun = false,
): Promise<ReconcileReport> {
  const reapedPgids = reapOrphanAgents(deps, dryRun);
  if (!dryRun) {
    deps.syncMain(); // advance origin (also catches *behind* divergence via ff-only)
    deps.assertSynced(); // throws on *ahead* divergence → propagates → main exits 1
  }
  const { merged, closedDirty } = await reconcileOpenPrs(deps, source, dryRun);
  const prunedWorktrees = pruneShippedWorktrees(deps, source, dryRun);
  return { reapedPgids, merged, closedDirty, prunedWorktrees };
}

/**
 * Best-effort group-kill of the gate children recorded in the live heartbeat.
 * Called from the runner's SIGTERM handler so a `kill <runner-pid>` tears down the
 * agent grandchildren with it instead of orphaning them. Reads `agentPgids` from
 * the current `.noldor/drain-state.json` (kept fresh by `emitState`) and
 * `process.kill(-pgid, 'SIGKILL')` each. Swallows everything — a signal handler
 * must never throw. SIGKILL on the runner runs no handler at all; the startup
 * `reapOrphanAgents` is the backstop for that case.
 */
export function groupKillState(cwd: string): void {
  const p = join(cwd, '.noldor/drain-state.json');
  if (!existsSync(p)) return;
  let pgids: number[] = [];
  try {
    pgids = (JSON.parse(readFileSync(p, 'utf8')) as DrainState).agentPgids ?? [];
  } catch {
    return;
  }
  for (const pgid of pgids) {
    try {
      process.kill(-pgid, 'SIGKILL');
    } catch {
      /* already gone / not ours — best-effort */
    }
  }
}

/** True when a {@link ReconcileReport} recorded any action (drives whether to log it). */
export function reportIsEmpty(r: ReconcileReport): boolean {
  return (
    r.reapedPgids.length === 0 &&
    r.merged.length === 0 &&
    r.closedDirty.length === 0 &&
    r.prunedWorktrees.length === 0
  );
}

/** One-line human summary of a reconcile report (printed before the drain begins). */
export function formatReconcile(r: ReconcileReport): string {
  return (
    `reconcile: merged ${r.merged.length}` +
    (r.merged.length > 0 ? ` [${r.merged.join(', ')}]` : '') +
    `, closed-dirty ${r.closedDirty.length}` +
    (r.closedDirty.length > 0 ? ` [${r.closedDirty.join(', ')}]` : '') +
    `, pruned ${r.prunedWorktrees.length} worktree(s)` +
    (r.prunedWorktrees.length > 0 ? ` [${r.prunedWorktrees.join(', ')}]` : '') +
    `, reaped ${r.reapedPgids.length} orphan agent(s)`
  );
}

/**
 * Production {@link ReconcileDeps} bound to a repo root + drain source. Shells out
 * to `git` / `gh` exactly as the rest of `drain-io` does — no branching logic
 * worth unit-testing lives here (the orchestration is tested against mocks). The
 * reconcile-time merge uses a short bounded poll (90s) so it never hangs minutes
 * on a stuck PR (spec D6).
 */
export function makeReconcileDeps(
  cwd: string,
  source: DrainSource,
  syncMain: () => void,
  assertSynced: () => void,
): ReconcileDeps {
  return {
    readDrainState: () => {
      const p = join(cwd, '.noldor/drain-state.json');
      if (!existsSync(p)) return null;
      try {
        return JSON.parse(readFileSync(p, 'utf8')) as DrainState;
      } catch {
        return null; // garbage payload — treat as no prior state
      }
    },
    isAlive,
    killPgid: (pgid) => {
      try {
        process.kill(-pgid, 'SIGKILL');
      } catch {
        /* ESRCH (already gone) / EPERM (reused, not ours) — best-effort */
      }
    },
    syncMain,
    assertSynced,
    listOpenPrs: () => {
      const out = execFileSync(
        'gh',
        [
          'pr',
          'list',
          '--state',
          'open',
          '--json',
          'number,headRefName,mergeStateStatus,mergedAt,state',
        ],
        { cwd, encoding: 'utf8' },
      );
      return JSON.parse(out) as OpenPrView[];
    },
    mergePr: (slug, branch) => mergePr(cwd, slug, branch, 90_000, 5_000),
    closePr: (branch) => {
      spawnSync('gh', ['pr', 'close', branch], { cwd, encoding: 'utf8' });
    },
    listWorktrees: () => {
      const out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
        cwd,
        encoding: 'utf8',
      });
      return parseWorktrees(out);
    },
    removeWorktree: (slug, branch) => {
      spawnSync('git', ['worktree', 'remove', '--force', `.worktrees/${slug}`], { cwd });
      spawnSync('git', ['branch', '-D', branch], { cwd });
    },
  };
}
