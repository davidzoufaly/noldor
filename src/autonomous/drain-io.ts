import { execFileSync, spawnSync } from 'node:child_process';
import { spawnAgent } from '../core/agent-runner/registry.js';
import { makeRoadmapConflictResolver, spawnRunner, type GitRunner } from './salvage.js';

/**
 * Real implementations of the {@link DrainDeps} IO adapters. These shell out to
 * `git` / `gh` / `claude`, so they carry no branching logic worth unit-testing —
 * the loop logic is tested against mocks in `run-drain.test.ts`, and these are
 * exercised by the manual integration run (FD Usage → Verification).
 */

/**
 * Outcome of a serialized PR merge under parallel drain (K>1). `merge-conflict` and
 * `merge-timeout` both mean "leave the PR open, skip this slug for the run"; only `merged`
 * advances the success oracle. See {@link mergePr}.
 */
export type MergeOutcome = 'merged' | 'merge-conflict' | 'merge-timeout';

interface MergeView {
  mergedAt: string | null;
  mergeStateStatus: string;
  state: string;
}

/**
 * Pure verdict on one `gh pr view` payload. `pending` means "keep polling" — crucially
 * BLOCKED / UNSTABLE / BEHIND (checks running, branch protection, behind base) are NOT
 * conflicts; only `DIRTY` / `CONFLICTING` are. Merging on a `pending` PR would land code
 * before CI completes on a repo without required-checks protection.
 */
export function classifyMergeView(d: MergeView): 'merged' | 'merge-conflict' | 'pending' {
  if (d.mergedAt !== null || d.state === 'MERGED') return 'merged';
  if (d.mergeStateStatus === 'DIRTY' || d.mergeStateStatus === 'CONFLICTING')
    return 'merge-conflict';
  return 'pending';
}

/**
 * Serialized squash-merge of one already-open PR (parallel drain K>1), reusing the same
 * `--auto --squash` + poll machinery the K=1 child runs today (`pr-flow.ts`). Enqueues auto-merge,
 * then polls the STRUCTURED `mergeStateStatus` until merged / genuine conflict / timeout — never a
 * stderr substring. On a repo WITHOUT a merge queue (auto-merge enqueue exits non-zero) it attempts a
 * direct squash, but ONLY when `mergeStateStatus === 'CLEAN'` (all required checks passed + up to
 * date) so it never lands code before CI. Throws only on a systemic `gh`/spawn failure → the
 * coordinator aborts the whole drain fail-closed.
 */
export async function mergePr(
  cwd: string,
  slug: string,
  branch: string,
  pollTimeoutMs = 20 * 60 * 1000,
  pollIntervalMs = 10_000,
  resolve: (
    slug: string,
    branch: string,
  ) => 'resolved' | 'unresolvable' = makeRoadmapConflictResolver(cwd),
): Promise<MergeOutcome> {
  const enq = spawnSync('gh', ['pr', 'merge', branch, '--auto', '--squash'], {
    cwd,
    encoding: 'utf8',
  });
  if (enq.error) throw new Error(`gh pr merge spawn failed for ${branch}: ${enq.error.message}`);
  const autoEnabled = enq.status === 0;
  const deadline = Date.now() + pollTimeoutMs; // real wall-clock — IO adapter, not unit-tested
  let resolveAttempted = false; // re-apply the deterministic roadmap removal at most once
  for (;;) {
    const view = spawnSync(
      'gh',
      ['pr', 'view', branch, '--json', 'mergedAt,mergeStateStatus,state'],
      {
        cwd,
        encoding: 'utf8',
      },
    );
    if (view.status !== 0) {
      throw new Error(`gh pr view failed for ${branch}: ${(view.stderr ?? '').trim()}`);
    }
    const v = JSON.parse(view.stdout) as MergeView;
    const verdict = classifyMergeView(v);
    if (verdict === 'merged') return 'merged';
    if (verdict === 'merge-conflict') {
      // A DIRTY PR under K>1 is usually an adjacent docs/roadmap.md block-removal conflict.
      // Try the deterministic re-apply ONCE; on success the rebased+pushed branch re-reads
      // BEHIND→CLEAN and we keep polling, on failure fall back to today's leave-open behaviour.
      if (resolveAttempted) return 'merge-conflict';
      resolveAttempted = true;
      if (resolve(slug, branch) !== 'resolved') return 'merge-conflict';
      spawnSync('gh', ['pr', 'merge', branch, '--auto', '--squash'], { cwd, encoding: 'utf8' });
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      continue;
    }
    if (Date.now() > deadline) return 'merge-timeout';
    if (v.mergeStateStatus === 'BEHIND') {
      // "require branches up to date" protection: a PR opened off the pre-merge base goes BEHIND
      // once the prior PR merges. Update it onto the new base so it can become mergeable — this is
      // what makes "merges serialize, each rebased on the prior" actually true on a protected repo.
      // Best-effort (clean PRs need no update); the next poll re-reads the fresh status.
      spawnSync('gh', ['pr', 'update-branch', branch], { cwd, encoding: 'utf8' });
    } else if (!autoEnabled && v.mergeStateStatus === 'CLEAN') {
      // No merge queue: attempt a direct squash, but ONLY when CLEAN (mergeable now — checks passed).
      spawnSync('gh', ['pr', 'merge', branch, '--squash'], { cwd, encoding: 'utf8' });
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

/**
 * Checkout main, fetch, ff-only sync, prune stale worktree admin entries, drop
 * stale escalation context. Throws on an ff-only rejection (caller aborts the
 * drain — local main diverged, spec Error handling).
 *
 * IMPORTANT: this does **not** blanket-remove `.worktrees/*` or delete `fast/*`
 * branches — that would destroy unrelated human feature worktrees and ordinary
 * interactive fast-track branches the lock does not protect. `git worktree prune`
 * only drops admin entries for worktree dirs that are *already gone*; it never
 * deletes a live worktree. Per-slug cleanup of the drain's own `fast/<slug>`
 * branch + worktree is the gate Step 2 force-recreate's job (drain-mode), scoped
 * to the exact slug being shipped.
 */
export function syncMainCleanState(cwd: string): void {
  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd, stdio: 'pipe' });
  };
  git(['checkout', 'main']);
  git(['fetch', 'origin', 'main']);
  git(['merge', '--ff-only', 'origin/main']); // throws on divergence → abort
  git(['worktree', 'prune']); // admin-only: drops entries for already-deleted dirs; never deletes a live worktree
  // Drop stale escalation context so a failed iteration's context can't bleed into the next.
  spawnSync('bash', ['-c', 'rm -f .noldor/cr/*-escalation-context.md 2>/dev/null || true'], {
    cwd,
    stdio: 'pipe',
  });
}

/**
 * Pre-flight divergence guard: throw loud when local `main` is AHEAD of
 * `origin/main` (an un-pushed commit — e.g. a triage commit on local main). The
 * existing `git merge --ff-only origin/main` in {@link syncMainCleanState} only
 * catches *behind* divergence; a local-ahead state reads as "Already up to date"
 * and slips through, surfacing only AFTER a gate child did the work and tried to
 * retire the entry against an out-of-sync `origin/main`. Runs after `syncMain`
 * (so `origin/main` is freshly fetched) and before the first spawn. The thrown
 * message names the offending commits; `main()` catches → exit 1. Injectable
 * {@link GitRunner} for unit-testing (production binds `spawnRunner(cwd)`).
 */
export function assertQueueSourceSynced(run: GitRunner): void {
  const r = run('git', ['rev-list', '--count', 'origin/main..HEAD']);
  const ahead = Number((r.stdout || '0').trim());
  if (Number.isFinite(ahead) && ahead > 0) {
    const log = run('git', ['log', '--oneline', 'origin/main..HEAD']);
    throw new Error(
      `drain: local main is ahead of origin/main by ${ahead} commit(s) — push or reset before draining:\n${log.stdout.trim()}`,
    );
  }
}

/** Production binding of {@link assertQueueSourceSynced} to a repo root. */
export function assertQueueSourceSyncedAt(cwd: string): void {
  assertQueueSourceSynced(spawnRunner(cwd));
}

/**
 * True when an OPEN PR exists for the source's drain branch (`fast/<slug>` for
 * roadmap, `feat/<slug>` for plans — the branch is passed in by the loop via
 * `DrainSource.branchFor`). Throws on a `gh` failure — the caller treats that as
 * a fail-closed abort: treating an error as "no PR" would re-spawn a duplicate.
 * `slug` is retained for caller/log context even though `branch` drives the query.
 */
export function openPrExistsFor(cwd: string, slug: string, branch: string): boolean {
  void slug;
  const out = execFileSync(
    'gh',
    ['pr', 'list', '--state', 'open', '--head', branch, '--json', 'number'],
    {
      cwd,
      encoding: 'utf8',
    },
  );
  return (JSON.parse(out) as unknown[]).length > 0;
}

/**
 * Spawn a headless gate run via the agent-runner registry (implementer role —
 * claude unless the consumer's agents config remaps it). Returns the child
 * exit code; throws `iteration-timeout` when the child exceeds `timeoutMs`.
 * The registry's canonical argv keeps the AskUserQuestion kill-switch (a
 * forgotten prose branch fails fast instead of hanging) and bypassPermissions
 * so git/gh/pnpm/Edit run unattended. A systemic spawn error (e.g. ENOENT —
 * runner not on PATH) rejects `spawn-failed: …` so the loop aborts the whole
 * drain instead of churning retries across every entry. `prompt` defaults to
 * `/gate` (roadmap source); plans source passes `/gate --resume <slug>`.
 */
export async function spawnGate(
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
  prompt = '/gate',
  onSpawn?: (pgid: number) => void,
  slug?: string,
): Promise<number> {
  const r = await spawnAgent(prompt, {
    role: 'implementer',
    cwd,
    env,
    timeoutMs,
    stdio: 'inherit',
    needsWrite: true,
    site: 'drain.spawnGate',
    onSpawn,
    slug,
  });
  if (r.timedOut) throw new Error('iteration-timeout'); // per-entry failure → retry/skip
  return r.exitCode;
}
