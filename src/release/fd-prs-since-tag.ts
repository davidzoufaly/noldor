// src/release/fd-prs-since-tag.ts
// @tests: fd-prs-since-last-release-section

import { commitsForFeature } from './release-fd-commits.js';
import { NOISE_TYPES, stripBang } from './release-noise-types.js';
import { PR_SUBJECT_RE } from './release-pr-bullets.js';
import { findPreviousTag } from './release-version.js';

/** One pull-request reference rendered into a `## PRs` bullet. */
export interface PrRef {
  number: number;
  title: string;
  url: string;
}

/**
 * Return the PRs whose commits touch `slug` in the range `<lastSemverTag>..HEAD`.
 *
 * Range resolution: `findPreviousTag` returns the literal `'v0.0.0'` when no
 * semver tag is reachable from HEAD. That sentinel is coerced to `''` here so
 * `commitsForFeature` walks from repo-start instead of attempting `git log
 * v0.0.0..HEAD` against a non-existent ref.
 *
 * Returns an empty array when no PR-bearing commits touch the slug — same as
 * a "no tags yet, no commits yet" repo. Callers must not distinguish the two.
 *
 * @param slug - Feature slug (matched against commit scope, e.g. `foo` matches
 *   `feat(area:foo):`).
 * @param cwd - Working directory for git operations. Pass the repo root (or a
 *   scratch repo in tests).
 * @param repoUrl - Canonical HTTPS repository URL used to build PR links.
 * @returns PR references sorted newest-first, deduplicated by PR number.
 */
export async function prsSinceLastTag(
  slug: string,
  cwd: string,
  repoUrl: string,
): Promise<PrRef[]> {
  const tag = await findPreviousTag(cwd);
  const fromRef = tag === 'v0.0.0' ? '' : tag;
  const commits = await commitsForFeature(slug, fromRef, 'HEAD', cwd);
  const visible = commits.filter((c) => !NOISE_TYPES.has(stripBang(c.type)));
  const seen = new Set<number>();
  const refs: PrRef[] = [];
  for (const c of visible) {
    const raw = c.subject;
    const match = raw.match(PR_SUBJECT_RE);
    if (!match) continue;
    const number = Number(match[1]);
    if (seen.has(number)) continue;
    seen.add(number);
    const title = raw.replace(PR_SUBJECT_RE, '').trim();
    refs.push({ number, title, url: `${repoUrl}/pull/${number}` });
  }
  return refs;
}
