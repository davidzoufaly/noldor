import { execFileSync } from 'node:child_process';

/**
 * `git status --porcelain` (tracked changes only). Returns '' when git is
 * unavailable so callers' tree guards never block their run — fail-open by
 * contract. Callers snapshot before/after a spawn batch and warn on delta.
 */
export function gitStatusPorcelain(cwd: string): string {
  try {
    return execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}
