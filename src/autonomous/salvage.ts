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
  if (rows.some((r) => r.mergedAt === null)) reasons.push('closed-unmerged-pr');
  const remote = run('git', ['ls-remote', '--heads', 'origin', branch]);
  if (!remote.ok) throw new Error(`salvage: ls-remote failed for ${branch} — refusing to guess`);
  if (remote.stdout.trim() !== '') reasons.push('orphan-remote-branch');
  return reasons;
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
      exitCode: 0,
      durationMs: Date.now() - started,
      timedOut: false,
    });
    return 'salvaged';
  };
}

/** Injected file writer (defaults to fs); split out so the resolver stays unit-pure. */
export type FileWriter = (path: string, content: string) => void;

/**
 * Auto-resolve an *adjacent `docs/roadmap.md` block-removal* merge conflict for one
 * open fast-track PR under parallel drain (K>1). The correct post-merge content is
 * deterministic — "the freshly-rebased base's roadmap, minus this slug's block" —
 * so we re-apply {@link removeBlock} against `origin/main` rather than letting git's
 * textual 3-way merge fail. See the design spec
 * (`docs/superpowers/specs/2026-06-14-parallel-drain-roadmapmd-conflict-auto-resolution-design.md`).
 *
 * Pure/IO split in the {@link detectStale}/{@link repair} style (GitRunner +
 * FileWriter injection) so the branching logic is unit-tested without shelling out.
 * Operates in a scratch worktree `.worktrees/.merge-<slug>` cut from the PR tip so it
 * never touches a live build worktree or the main workspace HEAD while K workers run.
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
      newRaw = removeBlockFn(base.stdout, slug).newRaw;
    } catch {
      // Block already removed from the fresh base by a prior PR — don't guess.
      return abandon(true);
    }
    writeFile(join(wt, roadmapRel), newRaw);
    wtGit('add', roadmapRel);
    rebase = wtGit('rebase', '--continue'); // ok → rebase complete; !ok → next conflict, loop
  }

  if (!wtGit('push', '--force-with-lease', 'origin', `HEAD:${branch}`).ok) return abandon(false);
  removeWorktree();
  return 'resolved';
}
