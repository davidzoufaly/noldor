import { execFileSync } from 'node:child_process';

import { readRolloutMarker } from '../../noldor/rollout-marker.js';
import { parseTrailers } from '../../noldor/trailers.js';

const SUBJECT_RE = /^(?:\w+)(?:\((?<scope>[^)]+)\))?(?:!)?:/;

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
}): Promise<TrailerScopeMismatchFinding[]> {
  const { cwd } = opts;
  const marker = readRolloutMarker(cwd);
  const range = marker ? [`${marker}..HEAD`] : ['HEAD'];

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

    // Scope is acceptable if it equals the slug or contains `:<slug>`
    const scopeContainsSlug = scope !== null && (scope === fdSlug || scope.endsWith(`:${fdSlug}`));

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
