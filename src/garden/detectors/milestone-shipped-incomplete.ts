import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import matter from 'gray-matter';

import { FeatureFrontmatterSchema } from '../../core/feature-schema.js';
import { loadMilestones } from '../../milestones/lib.js';

export interface MilestoneShippedIncompleteFinding {
  readonly slug: string;
  readonly path: string;
  readonly milestone: string;
  readonly phase: 'in-progress';
  readonly reason: 'shipped-milestone-incomplete-feature';
}

/**
 * Flag features whose declared `milestone` resolves to a `status: shipped`
 * milestone while the feature's own `phase` is not `done` — the drift that
 * signals a falsely-declared "shipped" milestone with open work behind it.
 *
 * No-op invariant: returns `[]` when no FD carries a `milestone` field (and,
 * trivially, when no milestone is shipped). The inverse case — a done feature
 * under a not-yet-shipped milestone — is normal and never flagged (spec D3).
 *
 * @param repo - Repository root.
 * @returns One finding per shipped-milestone-with-open-feature FD.
 */
export async function detectMilestoneShippedIncomplete(
  repo: string,
): Promise<MilestoneShippedIncompleteFinding[]> {
  const shipped = new Set(
    loadMilestones(repo)
      .filter((m) => m.frontmatter.status === 'shipped')
      .map((m) => m.slug),
  );
  if (shipped.size === 0) return []; // nothing shipped → nothing to flag

  const featuresDir = join(repo, 'docs/features');
  let entries: string[];
  try {
    entries = await readdir(featuresDir);
  } catch {
    return [];
  }

  const findings: MilestoneShippedIncompleteFinding[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const fullPath = join(featuresDir, entry);
    const slug = entry.replace(/\.md$/, '');

    let raw: string;
    try {
      raw = await readFile(fullPath, 'utf8');
    } catch {
      continue;
    }

    let fm: ReturnType<typeof FeatureFrontmatterSchema.parse>;
    try {
      fm = FeatureFrontmatterSchema.parse(matter(raw).data);
    } catch {
      continue;
    }

    if (fm.milestone !== undefined && shipped.has(fm.milestone) && fm.phase !== 'done') {
      findings.push({
        slug,
        path: join('docs/features', entry),
        milestone: fm.milestone,
        phase: fm.phase,
        reason: 'shipped-milestone-incomplete-feature',
      });
    }
  }

  return findings;
}
