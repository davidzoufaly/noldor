// The only three preflight remedies safe to apply without asking.
//
// Report-only is the default; `--fix` opts in. Every remedy here is guarded so
// it cannot destroy operator state: nothing commits, nothing regenerates the
// graph, nothing touches a dirty tree, and no live gate session is deleted.
// Every other blocking row carries a `fix` line the operator runs by hand.
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfigSync, resolveSessionTtlHours } from '../core/config.js';
import { isSessionStale, readSession } from '../core/session.js';
import { autoStampOnCleanDetect } from './auto-restamp.js';
import { inspectTreeState } from './clean-tree.js';
import { defaultRunCommand, runOrThrow, type RunCommand } from './run-command.js';
import type { PreflightRowId } from './preflight-types.js';

/**
 * Ordered: ref-moving fixes first, so later pass-1 evaluations see the
 * post-merge tree (see `runPreflight`'s pass-1 contract — a `garden-receipt`
 * that only goes stale because of the fast-forward is caught for that reason).
 */
export const SAFE_FIXES: readonly PreflightRowId[] = [
  'origin-sync',
  'session-marker',
  'garden-receipt',
];

/**
 * Apply the remedy for `id`, or decline.
 *
 * `nowMs` is the SAME clock the probes were given. Passing it matters: if the
 * fix re-derived "now" from `Date.now()` while the probe used an injected value,
 * the two could disagree about staleness — and the row that promised "--fix will
 * NOT remove a live marker" would remove it anyway.
 *
 * `run` is the same spawn seam the probes were given, and it is threaded for
 * the same reason: `fixOriginSync` re-reads `inspectTreeState`, which fetches.
 * Injecting the runner into the probe pass while leaving the fix pass spawning
 * for real would leave a test that passes `fixes: ['origin-sync']` reaching the
 * network — the fix pass is where the remaining `git fetch` would have lived.
 *
 * @returns a one-line description of what was done, or `null` when the guard
 *   declined (the row then stays blocking and its `fix` line stands).
 */
export async function applyFix(
  id: PreflightRowId,
  cwd: string,
  nowMs: number,
  run: RunCommand = defaultRunCommand,
): Promise<string | null> {
  switch (id) {
    case 'session-marker':
      return fixSessionMarker(cwd, nowMs);
    case 'origin-sync':
      return fixOriginSync(cwd, run);
    case 'garden-receipt':
      return fixGardenReceipt(cwd);
    default:
      // Every other row is operator-only by design; asking for it is a no-op
      // rather than an error so a caller can pass a wider list harmlessly.
      return null;
  }
}

/**
 * Remove `.noldor/session.json` only when the TTL says it is stale.
 *
 * Note `isSessionStale` is itself narrow: only `micro-chore` and `release-sweep`
 * markers are stale-eligible, so a live `fast-track` or `specs-only-*` session
 * can never be deleted here no matter how old it is. That is the intended
 * conservatism — losing a gate session costs the operator real work.
 */
function fixSessionMarker(cwd: string, nowMs: number): string | null {
  const session = readSession(cwd);
  if (session === null) return null;
  const ttlHours = resolveSessionTtlHours(loadConfigSync(join(cwd, '.noldor/config.json')));
  if (!isSessionStale(session, nowMs, ttlHours)) return null;
  const path = join(cwd, '.noldor/session.json');
  if (!existsSync(path)) return null;
  unlinkSync(path);
  return `removed stale session marker (path=${session.path}, past the ${ttlHours}h TTL)`;
}

/**
 * Fast-forward local main onto `origin/main` — only when strictly behind AND
 * the tree is clean. A diverged history needs a human; a dirty tree must never
 * be moved under the operator's feet.
 */
async function fixOriginSync(cwd: string, run: RunCommand): Promise<string | null> {
  const { branch, dirty, ahead, behind, remoteMissing } = await inspectTreeState(cwd, run);
  if (remoteMissing) return null;
  if (branch !== 'main' || dirty.length > 0 || ahead > 0 || behind === 0) return null;
  // Throws on a non-zero exit, as `execFileP` did. A fast-forward that failed
  // but reported success would have `runPreflight` log "fast-forwarded main"
  // over a tree that never moved, and pass 2 would then contradict the log.
  await runOrThrow(run, 'git', ['merge', '--ff-only', 'origin/main'], { cwd });
  return `fast-forwarded main ${behind} commit(s) onto origin/main`;
}

/**
 * Re-stamp the garden receipt via the existing release-start auto-restamp,
 * which stamps only when `garden detect` comes back clean. Reused rather than
 * reimplemented so there is one definition of "safe to stamp".
 */
async function fixGardenReceipt(cwd: string): Promise<string | null> {
  // Trust the return value, never the log text: every failure line from
  // autoStampOnCleanDetect contains "auto-stamped" ("receipt NOT auto-stamped"),
  // so a substring match reported each detect failure as a successful stamp.
  const stamped = await autoStampOnCleanDetect({ cwd, log: () => {} });
  return stamped ? 'stamped the garden receipt (garden detect was clean)' : null;
}
