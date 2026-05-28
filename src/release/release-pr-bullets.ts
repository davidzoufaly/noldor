import type { FeatureCommit } from './release-fd-commits.js';

/** Regex matching a trailing `(#N)` PR-number suffix on a commit subject. */
export const PR_SUBJECT_RE = /\s*\(#(\d+)\)\s*$/;

/**
 * Render `#### PRs` bullets for a list of feature commits. Each bullet:
 *   - `#<N>: <title-without-PR-suffix> ([link](<repoUrl>/pull/<N>))`
 *
 * Commits without a `(#N)` subject suffix are skipped silently. Bullets are
 * deduplicated by PR number; preserves input order (caller delivers
 * newest-first per `git log`).
 *
 * @param commits - Feature commits already filtered for noise types
 * @param repoUrl - Canonicalized HTTPS repo URL
 * @returns Bullet lines (empty array when no commits have PR refs)
 */
export function renderPrBullets(commits: FeatureCommit[], repoUrl: string): string[] {
  // Input order = commitsForFeature output order = scope-grep results followed
  // by trailer-grep results (each group newest-first; groups concatenated, not
  // merge-sorted). For post-PR-flow commits virtually all PRs land in the
  // scope-grep group, so the concatenation is a non-issue in practice. A
  // trailer-only commit older than a scope-grep commit could appear below it
  // in the bullet list — acceptable per spec §2.3.
  const seen = new Set<number>();
  const bullets: string[] = [];
  for (const c of commits) {
    const match = c.subject.match(PR_SUBJECT_RE);
    if (!match) continue;
    const prNumber = Number(match[1]);
    if (seen.has(prNumber)) continue;
    seen.add(prNumber);
    const title = c.subject.replace(PR_SUBJECT_RE, '').trim();
    bullets.push(`- #${prNumber}: ${title} ([link](${repoUrl}/pull/${prNumber}))`);
  }
  return bullets;
}
