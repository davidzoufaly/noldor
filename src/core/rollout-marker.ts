import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

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
 * Uses `git merge-base --is-ancestor marker commit` which exits 0 when
 * the marker is an ancestor of (or equal to) the given commit.
 */
export function isPostRollout(commitSha: string, cwd: string = process.cwd()): boolean {
  const marker = readRolloutMarker(cwd);
  if (!marker) return false;
  const r = spawnSync('git', ['merge-base', '--is-ancestor', marker, commitSha], {
    cwd,
    stdio: 'ignore',
  });
  return r.status === 0;
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
  writeFileSync(join(cwd, FILE), `${head}\n`);
  return 'created';
}
