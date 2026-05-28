import { existsSync, readFileSync } from 'node:fs';
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
