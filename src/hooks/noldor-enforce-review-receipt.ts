// scripts/hooks/noldor-enforce-review-receipt.ts
// pre-push stage: verifies that the tip commit carries a review-receipt trailer matching HEAD^{tree}.
// Accepts either Noldor-Reviewed (legacy single-reviewer) or Noldor-Reviewed-Subagent (multi-reviewer gate Step 4).
import { spawnSync } from 'node:child_process';
import { parseTrailers } from '../core/trailers';
import { readRolloutMarker, isPostRollout } from '../core/rollout-marker';

export interface EnforceResult {
  ok: boolean;
  reason?: string;
}

const PATHS_REQUIRING_REVIEW = new Set([
  'fast-track',
  'specs-only-new',
  'specs-only-attach',
  'full-new',
  'full-attach',
]);

const RECEIPT_TRAILERS = ['Noldor-Reviewed', 'Noldor-Reviewed-Subagent'] as const;

export function enforceReviewReceipt(opts: { cwd: string }): EnforceResult {
  // Soft mode: if no rollout marker or HEAD is pre-rollout, skip enforcement.
  const marker = readRolloutMarker(opts.cwd);
  if (!marker) return { ok: true };

  let head: string;
  try {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: opts.cwd, encoding: 'utf8' });
    if (r.status !== 0 || !r.stdout.trim()) return { ok: true }; // empty repo
    head = r.stdout.trim();
  } catch {
    return { ok: true };
  }
  if (!isPostRollout(head, opts.cwd)) return { ok: true };

  const msgR = spawnSync('git', ['log', '-1', '--pretty=%B'], { cwd: opts.cwd, encoding: 'utf8' });
  const message = msgR.stdout;
  const t = parseTrailers(message);
  if (t['Noldor-Path-Override']) return { ok: true };
  const path = t['Noldor-Path'];
  if (!path || !PATHS_REQUIRING_REVIEW.has(path)) return { ok: true };

  const present = RECEIPT_TRAILERS.find((k) => t[k]);
  if (!present) {
    return {
      ok: false,
      reason: `pre-push: review receipt trailer missing on tip commit (expected one of: ${RECEIPT_TRAILERS.join(', ')})`,
    };
  }
  const reviewed = t[present]!;
  const treeR = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: opts.cwd, encoding: 'utf8' });
  const tree = treeR.stdout.trim();
  if (reviewed !== tree) {
    return {
      ok: false,
      reason: `pre-push: ${present}=${reviewed} does not match HEAD tree ${tree}; re-run reviewer`,
    };
  }
  return { ok: true };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = enforceReviewReceipt({ cwd: process.cwd() });
  if (!r.ok) {
    console.error(`Noldor gate: ${r.reason}`);
    process.exit(1);
  }
}
