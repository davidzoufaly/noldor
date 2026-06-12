import { sizeToPath } from '../../core/size-routing.js';
import type { Collector, MetricResult, RepoFacts } from '../types.js';

const LAST_N = 10;

export const collectRoutingAccuracy: Collector = (facts: RepoFacts): MetricResult => {
  const tagDates = new Map(facts.releases.map((r) => [r.version, r.date]));
  const intakeBySlug = new Map(facts.intake.map((i) => [i.slug, i]));
  const actualBySlug = new Map<string, string>();
  for (const c of facts.commits) {
    const slug = c.trailers['Noldor-FD'];
    const path = c.trailers['Noldor-Path'];
    if (slug && path && !actualBySlug.has(slug)) actualBySlug.set(slug, path);
  }
  const shipped = facts.features
    .filter((f) => f.fm.introduced && tagDates.has(f.fm.introduced))
    .sort((a, b) =>
      (tagDates.get(b.fm.introduced as string) as string).localeCompare(
        tagDates.get(a.fm.introduced as string) as string,
      ),
    )
    .slice(0, LAST_N);
  const table: Record<string, Record<string, number>> = {};
  const samples: { slug: string; suggested: string; actual: string }[] = [];
  let matches = 0;
  let excluded = 0;
  for (const f of shipped) {
    const intake = intakeBySlug.get(f.slug);
    const actual = actualBySlug.get(f.slug);
    if (!intake?.size || !actual) {
      excluded += 1;
      continue;
    }
    const suggested = sizeToPath(intake.size, intake.parent !== undefined);
    const row = (table[suggested] ??= {});
    row[actual] = (row[actual] ?? 0) + 1;
    if (suggested === actual) matches += 1;
    samples.push({ slug: f.slug, suggested, actual });
  }
  return {
    id: 'routing-accuracy',
    unit: 'entries',
    value: { table, matches, total: samples.length, excluded, window: LAST_N },
    formula: `sizeToPath(intake.size, intake.parent != null) vs first Noldor-Path trailer of the FD's commits, over the last ${LAST_N} shipped FDs (by release-tag date).`,
    blindSpots: [
      'Entries whose roadmap size/parent could not be recovered from history, or whose commits predate the Noldor-Path trailer, are excluded (see excluded count).',
      'First-trailer-wins: a feature shipped across mixed paths is judged by its first commit path.',
    ],
    samples,
  };
};
