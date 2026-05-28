import { commitsForFeature } from './release-fd-commits.js';

const PR_SUBJECT_RE = /\(#\d+\)\s*$/;

/**
 * Walk all-time slug-matching commits oldest-first and return the SHA of the
 * first one whose subject carries a `(#N)` PR suffix. Used as the lower bound
 * for the Initial Release block's cumulative range (`<sha>^..HEAD`).
 *
 * Returns null when no slug-matching commit has a PR ref (entirely pre-
 * PR-flow FD — caller falls back to repo-start range).
 *
 * @param slug - FD slug
 * @param cwd - Repo root
 */
export async function findFirstPrCommit(slug: string, cwd: string): Promise<string | null> {
  // `commitsForFeature` returns newest-first; reverse for chronological order.
  const commits = await commitsForFeature(slug, '', 'HEAD', cwd);
  const oldestFirst = commits.toReversed();
  for (const c of oldestFirst) {
    if (PR_SUBJECT_RE.test(c.subject)) {
      return c.sha;
    }
  }
  return null;
}
