// src/hooks/noldor-pre-commit.ts
// pre-commit stage: enforces micro-chore allowlist and hard-wall post-rollout session requirement.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { readSession, isSessionStale, touchSession, type SessionMarker } from '../core/session';
import { isMicroChoreAllowed, isReleaseSweepAllowed } from '../core/allowlist';
import { readRolloutMarker, isPostRollout } from '../core/rollout-marker';
import { appendOverrideLog } from '../core/overrides-log';
import { DEFAULT_SESSION_TTL_HOURS, loadConfigSync, resolveSessionTtlHours } from '../core/config';

export interface PreCommitResult {
  ok: boolean;
  reason?: string;
  /**
   * Set when {@link runPreCommit} honored a `NOLDOR_PATH_OVERRIDE` bypass. Carries
   * the trimmed override reason so the CLI entrypoint can write the audit
   * breadcrumb via {@link logOverride}. Kept out of the function so `runPreCommit`
   * stays pure (no file I/O).
   */
  overrideReason?: string;
  /**
   * Set when a green `release-sweep` commit should reset the session TTL clock.
   * The entrypoint performs the actual `touchSession` write so `runPreCommit`
   * stays pure (same split as {@link PreCommitResult.overrideReason}). Turns the
   * TTL into an inactivity window for sweeps: only a sweep idle for the full
   * TTL between commits goes stale, not one whose total runtime crosses it.
   * micro-chore is deliberately excluded — its single-commit staleness guard
   * is working as designed.
   */
  refreshSession?: boolean;
}

/**
 * Appends a `(pre-commit)`-tagged breadcrumb line to `.noldor/overrides.log` so an
 * env-var pre-commit bypass always leaves a local audit record — even when the
 * commit carries no `Noldor-Path-Override` trailer. The trailing tag distinguishes
 * it from the 2-column untagged line `validate-trailer` writes at the commit-msg
 * layer. The cross-clone audit (git log, read by the `/noldor-garden` override detector)
 * still relies on the committed trailer; this is the local backstop.
 */
export function logOverride(cwd: string, reason: string): void {
  appendOverrideLog(cwd, reason, 'pre-commit');
}

function getStagedPaths(cwd: string): string[] {
  const r = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd, encoding: 'utf8' });
  return (r.stdout ?? '').split('\n').filter(Boolean);
}

function staleResult(session: SessionMarker, ttlHours: number): PreCommitResult {
  return {
    ok: false,
    reason:
      `session stale: '${session.path}' started ${session.startedAt} ` +
      `(older than ${ttlHours}h). Run /noldor-gate again to refresh.`,
  };
}

export function runPreCommit(opts: {
  cwd: string;
  pathOverride?: string;
  nowMs: number;
  ttlHours: number;
}): PreCommitResult {
  // Universal escape hatch: a non-empty NOLDOR_PATH_OVERRIDE releases both the
  // allowlist branches and the no-session hard wall, consistent with the
  // Noldor-Path-Override trailer's semantics at every other layer. Checked first
  // so it short-circuits everything below. Empty/whitespace is treated as unset.
  const override = opts.pathOverride?.trim();
  if (override) {
    return { ok: true, overrideReason: override };
  }

  // Always check session first (before rollout gate) so micro-chore session enforcement
  // works even pre-rollout (belt-and-suspenders for the session itself).
  const session = readSession(opts.cwd);
  const staged = getStagedPaths(opts.cwd);

  if (session?.path === 'micro-chore') {
    if (isSessionStale(session, opts.nowMs, opts.ttlHours))
      return staleResult(session, opts.ttlHours);
    if (!isMicroChoreAllowed(staged)) {
      return {
        ok: false,
        reason: `micro-chore diff includes files outside allowlist: ${staged.join(', ')}`,
      };
    }
    return { ok: true };
  }

  if (session?.path === 'release-sweep') {
    if (isSessionStale(session, opts.nowMs, opts.ttlHours))
      return staleResult(session, opts.ttlHours);
    if (!isReleaseSweepAllowed(staged)) {
      return {
        ok: false,
        reason: `release-sweep diff includes files outside allowlist: ${staged.join(', ')}`,
      };
    }
    return { ok: true, refreshSession: true };
  }

  // For non-micro-chore / non-release-sweep sessions (or no session), enforce hard wall only post-rollout.
  const marker = readRolloutMarker(opts.cwd);
  if (!marker) return { ok: true }; // soft mode: no rollout marker yet

  let head: string;
  try {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: opts.cwd, encoding: 'utf8' });
    if (r.status !== 0 || !r.stdout.trim()) return { ok: true }; // empty repo
    head = r.stdout.trim();
  } catch {
    return { ok: true };
  }
  if (!isPostRollout(head, opts.cwd)) return { ok: true }; // pre-rollout: soft mode

  if (!session) {
    return {
      ok: false,
      reason: `No /noldor-gate session. Run /noldor-gate before committing: ${staged.join(', ')}`,
    };
  }

  // Any other session (fast-track, specs-only-*, full-*) — no diff-level check at this stage.
  return { ok: true };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cwd = process.cwd();
  // Fail-open: a malformed .noldor/config.json must never block a commit, since
  // this hook gates every commit. Fall back to the default TTL on any read/parse error.
  let ttlHours = DEFAULT_SESSION_TTL_HOURS;
  try {
    ttlHours = resolveSessionTtlHours(loadConfigSync(join(cwd, '.noldor', 'config.json')));
  } catch {
    /* fail-open */
  }
  const nowMs = Date.now();
  const r = runPreCommit({
    cwd,
    pathOverride: process.env.NOLDOR_PATH_OVERRIDE,
    nowMs,
    ttlHours,
  });
  if (r.overrideReason) {
    logOverride(cwd, r.overrideReason);
  }
  if (r.ok && r.refreshSession) {
    // Fail-open: a refresh failure must never block a commit the check passed.
    try {
      touchSession(cwd, nowMs);
    } catch {
      /* fail-open */
    }
  }
  if (!r.ok) {
    console.error(`Noldor gate: ${r.reason}`);
    process.exit(1);
  }
}
