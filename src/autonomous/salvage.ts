import { spawnSync } from 'node:child_process';

import { appendAgentEvent } from '../core/agent-events.js';

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
function spawnRunner(cwd: string): GitRunner {
  return (cmd, args) => {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: r.status === 0, stdout: r.stdout ?? '' };
  };
}

/**
 * Production `DrainDeps.salvageStaleBase`. Detects, repairs, and appends a
 * `salvaged` agent-event (fail-open by appendAgentEvent's contract). Detection
 * errors propagate — the loop treats a thrown dep as a systemic abort.
 */
export function makeSalvage(cwd: string): (slug: string, branch: string) => 'clean' | 'salvaged' {
  const run = spawnRunner(cwd);
  return (slug, branch) => {
    const started = Date.now();
    const reasons = detectStale(run, branch);
    if (reasons.length === 0) return 'clean';
    repair(run, slug);
    appendAgentEvent(cwd, {
      ts: new Date().toISOString(),
      runner: 'drain',
      role: 'watch',
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
