import type { Collector, MetricResult, RepoFacts } from '../types.js';

const CORRECTIVE_WINDOW_DAYS = 14;

export const collectCrEffectiveness: Collector = (facts: RepoFacts): MetricResult => {
  const perLane: Record<string, { blockers: number; suggestions: number }> = {};
  for (const lf of facts.laneFindings) {
    const lane = (perLane[lf.lane] ??= { blockers: 0, suggestions: 0 });
    lane.blockers += lf.blockers.length;
    lane.suggestions += lf.suggestions.length;
  }
  const tagDates = new Map(facts.releases.map((r) => [r.version, r.date]));
  const correctiveBySlug: Record<string, number> = {};
  for (const f of facts.features) {
    const shipDate = f.fm.introduced ? tagDates.get(f.fm.introduced) : undefined;
    if (!shipDate) continue;
    const shipMs = Date.parse(shipDate);
    const windowEnd = shipMs + CORRECTIVE_WINDOW_DAYS * 86_400_000;
    const n = facts.commits.filter((c) => {
      if (c.trailers['Noldor-FD'] !== f.slug) return false;
      if (!/^(fix|revert)\b/.test(c.subject)) return false;
      const t = Date.parse(c.date);
      return t > shipMs && t <= windowEnd;
    }).length;
    if (n > 0) correctiveBySlug[f.slug] = n;
  }
  return {
    id: 'cr-effectiveness',
    unit: 'findings / corrective commits',
    value: { perLane, correctiveBySlug, windowDays: CORRECTIVE_WINDOW_DAYS },
    formula: `Per-lane blockers+suggestions from .noldor/cr LaneFindings vs fix:/revert: commits carrying the same Noldor-FD within ${CORRECTIVE_WINDOW_DAYS} days after the FD's release-tag date.`,
    blindSpots: [
      'Approximation: a corrective commit is attributed by trailer + subject prefix; refactors that silently fix, or fixes without the FD trailer, are invisible.',
      'CR sinks are operator-local and pruned/archived — historical lanes may be missing entirely.',
    ],
    samples: facts.laneFindings.map((lf) => ({
      slug: lf.slug,
      lane: lf.lane,
      kind: lf.kind,
      blockers: lf.blockers.length,
      suggestions: lf.suggestions.length,
    })),
  };
};
