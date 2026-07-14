import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { atomicWriteFileSync } from './atomic-write.js';

const FILE = '.noldor/rollout-marker';

/**
 * Read the rollout marker SHA from `.noldor/rollout-marker`.
 * Returns null if the file does not exist or is empty.
 */
export function readRolloutMarker(cwd: string = process.cwd()): string | null {
  const p = join(cwd, FILE);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8').trim() || null;
}

/**
 * Returns true if `commitSha` is at or after the rollout marker commit.
 * Uses `git merge-base --is-ancestor marker commit`. Fails **closed** on an
 * unresolvable marker: a present-but-corrupt marker (torn write, truncated SHA)
 * makes git exit 128, and a missing git binary / signal-killed child yields
 * `status: null` — in both cases the marker exists but cannot be resolved, and
 * an enforcement decision must not silently drop the repo to soft mode.
 */
export function isPostRollout(commitSha: string, cwd: string = process.cwd()): boolean {
  const marker = readRolloutMarker(cwd);
  if (!marker) return false; // no marker → genuinely pre-rollout (soft mode)
  const r = spawnSync('git', ['merge-base', '--is-ancestor', marker, commitSha], {
    cwd,
    stdio: 'ignore',
  });
  //   0  → marker is an ancestor of commit → post-rollout → enforce.
  //   1  → clean "not an ancestor" → genuinely pre-rollout → soft mode.
  //   128 (bad/unknown object = corrupt marker) or null (git absent / killed)
  //        → present but unresolvable → enforce (fail closed).
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  return true;
}

export type EnsureMarkerStatus = 'created' | 'exists' | 'skipped-no-git';

/**
 * Create `.noldor/rollout-marker` pointing at the repo's current HEAD, so the
 * trailer/receipt/session validators enforce from the next commit onward.
 * Called by `noldor init` on scaffold. No-ops when a marker already exists;
 * skips (soft mode stays) when the tree is not a git repo or has no commits
 * yet. The marker should be committed — a fresh clone without it falls back
 * to soft mode.
 */
export function ensureRolloutMarker(cwd: string = process.cwd()): EnsureMarkerStatus {
  if (readRolloutMarker(cwd) !== null) return 'exists';
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
  const head = r.status === 0 ? r.stdout.trim() : '';
  if (!head) return 'skipped-no-git';
  mkdirSync(join(cwd, '.noldor'), { recursive: true });
  atomicWriteFileSync(join(cwd, FILE), `${head}\n`);
  return 'created';
}
