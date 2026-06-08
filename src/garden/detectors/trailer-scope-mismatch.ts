import { execFileSync } from 'node:child_process';

import { loadScopeAliases } from '../../core/consumer-config.js';
import { readRolloutMarker } from '../../core/rollout-marker.js';
import { parseTrailers } from '../../core/trailers.js';

const SUBJECT_RE = /^(?:\w+)(?:\((?<scope>[^)]+)\))?(?:!)?:/;

/**
 * Return the set of root commit SHAs (commits with no parents). A repo created
 * by squash-importing external history has a genesis commit that may carry
 * legacy Noldor trailers whose scope predates the gate flow — it can never be
 * retroactively given a conforming scope. Skip such commits in the scan.
 *
 * @param cwd - Repository root.
 * @returns Set of root commit SHAs; empty on git failure.
 */
function rootCommitShas(cwd: string): Set<string> {
  try {
    const raw = execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return new Set(
      raw
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

export interface TrailerScopeMismatchFinding {
  readonly sha: string;
  readonly subject: string;
  readonly fdSlug: string;
  readonly scope: string | null;
  readonly reason: 'scope-missing-fd-slug';
  readonly action: 'fix-scope-or-trailer';
}

/**
 * Walk all commits that carry a `Noldor-FD: <slug>` trailer and assert
 * that the Conventional Commit scope contains `:<slug>` (or equals the slug).
 * Flags any commit where the scope does not include the FD slug.
 *
 * @param opts.cwd - Repository root.
 * @returns One TrailerScopeMismatchFinding per flagged commit.
 */
export async function detectTrailerScopeMismatch(opts: {
  cwd: string;
  scopeAliases?: Record<string, string[]>;
}): Promise<TrailerScopeMismatchFinding[]> {
  const { cwd } = opts;
  const aliases = opts.scopeAliases ?? loadScopeAliases(cwd);
  const marker = readRolloutMarker(cwd);
  const range = marker ? [`${marker}..HEAD`] : ['HEAD'];
  const rootShas = rootCommitShas(cwd);

  let raw: string;
  try {
    raw = execFileSync('git', ['log', '--pretty=%H%x00%s%x00%B%x1e', ...range], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return [];
  }

  const findings: TrailerScopeMismatchFinding[] = [];

  for (const block of raw.split('\x1e')) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const firstNull = trimmed.indexOf('\x00');
    if (firstNull === -1) continue;
    const secondNull = trimmed.indexOf('\x00', firstNull + 1);
    if (secondNull === -1) continue;

    const sha = trimmed.slice(0, firstNull).trim();
    // Genesis import commits predate the gate flow — skip (see rootCommitShas).
    if (rootShas.has(sha)) continue;
    const subject = trimmed.slice(firstNull + 1, secondNull).trim();
    const body = trimmed.slice(secondNull + 1);

    let trailers: Record<string, string>;
    try {
      trailers = parseTrailers(body);
    } catch {
      continue;
    }

    const fdSlug = trailers['Noldor-FD'];
    if (!fdSlug) continue;

    // Override commits bypass the normal gate path; skip scope-vs-trailer
    // alignment check for them. The override itself is audited separately
    // by the override-audit detector.
    if (trailers['Noldor-Path-Override'] !== undefined) continue;

    const scopeMatch = SUBJECT_RE.exec(subject);
    const scope = scopeMatch?.groups?.scope ?? null;

    // Scope is acceptable if it equals the slug, contains `:<slug>`, or its
    // last `:`-delimited segment is a configured alias for this FD slug. The
    // alias check mirrors the sub-scope leniency (last-segment-only): `garden:cr`
    // matches alias `cr`, but `cr:garden` does not.
    // pop() on a non-empty array is always a string; split() never yields [].
    const lastSegment = scope === null ? null : scope.split(':').pop()!;
    const aliasAccepts = lastSegment !== null && (aliases[lastSegment]?.includes(fdSlug) ?? false);
    const scopeContainsSlug =
      scope !== null && (scope === fdSlug || scope.endsWith(`:${fdSlug}`) || aliasAccepts);

    if (!scopeContainsSlug) {
      findings.push({
        sha,
        subject,
        fdSlug,
        scope,
        reason: 'scope-missing-fd-slug',
        action: 'fix-scope-or-trailer',
      });
    }
  }

  return findings;
}
