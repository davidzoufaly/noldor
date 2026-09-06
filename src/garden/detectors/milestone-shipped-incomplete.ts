import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import matter from 'gray-matter';

import { FeatureFrontmatterSchema } from '../../core/feature-schema.js';
import { readQueueFile } from '../../core/doc-roots.js';
import { loadMilestones } from '../../milestones/lib.js';
import { parseBacklog, parseRoadmap } from '../../utils/parse-blocks.js';

export interface MilestoneShippedIncompleteFinding {
  readonly slug: string;
  readonly path: string;
  readonly milestone: string;
  /**
   * The feature's phase, or `queued` for a roadmap/backlog entry — which has no
   * phase at all, and whose openness is precisely that it was never promoted.
   */
  readonly phase: 'in-progress' | 'queued';
  /**
   * Which kind of open work was found. Two reasons rather than one because the
   * remedies differ: an open feature is finished or reassigned, while a queued
   * entry is promoted, dropped, or moved to another milestone.
   */
  readonly reason: 'shipped-milestone-incomplete-feature' | 'shipped-milestone-queued-entry';
}

/**
 * Flag open work under a `status: shipped` milestone — the drift that signals a
 * falsely-declared "shipped" milestone with work still behind it.
 *
 * Two kinds of open work, one owner. A feature whose `milestone` names a shipped
 * milestone while its own `phase` is not `done`; and a roadmap or backlog entry
 * whose `- milestone:` names one, which is open by virtue of never having been
 * promoted. Both live here rather than one here and one in the dashboard's
 * roll-up, so the two surfaces cannot disagree about the same repo.
 *
 * No-op invariant: returns `[]` when nothing declares a milestone (and,
 * trivially, when no milestone is shipped). The inverse case — a done feature
 * under a not-yet-shipped milestone — is normal and never flagged (spec D3).
 *
 * @param repo - Repository root.
 * @returns One finding per open feature and per queued entry under a shipped milestone.
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

  findings.push(...(await queuedEntryFindings(repo, shipped)));

  return findings;
}

/**
 * Flag live roadmap/backlog entries that name a `shipped` milestone.
 *
 * This lives beside the feature scan rather than in the dashboard's roll-up so
 * that "a shipped milestone still has open work" keeps exactly one definition.
 * The dashboard reports a milestone's queue as a count; whether that queue makes
 * the milestone dishonest is decided here.
 *
 * @param repo - Repository root.
 * @param shipped - Slugs of milestones whose status is `shipped`.
 * @returns One finding per queued entry naming a shipped milestone.
 */
async function queuedEntryFindings(
  repo: string,
  shipped: ReadonlySet<string>,
): Promise<MilestoneShippedIncompleteFinding[]> {
  const sources = [
    {
      path: 'docs/roadmap.md' as const,
      entries: parseRoadmap(await readQueueFile(join(repo, 'docs/roadmap.md'))),
    },
    {
      path: 'docs/backlog.md' as const,
      entries: parseBacklog(await readQueueFile(join(repo, 'docs/backlog.md'))),
    },
  ];
  return sources.flatMap(({ path, entries }) =>
    entries
      .filter((e) => e.milestone !== undefined && shipped.has(e.milestone))
      .map(
        (e): MilestoneShippedIncompleteFinding => ({
          slug: e.slug,
          path,
          milestone: e.milestone ?? '',
          phase: 'queued',
          reason: 'shipped-milestone-queued-entry',
        }),
      ),
  );
}
