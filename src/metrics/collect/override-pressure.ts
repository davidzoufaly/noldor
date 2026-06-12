import type { Collector, MetricResult, RepoFacts } from '../types.js';

/** First release whose tag date >= commit date; commits after the last tag bucket to 'unreleased'. */
function releaseWindow(commitDate: string, releases: RepoFacts['releases']): string {
  for (const r of releases) {
    if (commitDate <= r.date) return r.version;
  }
  return 'unreleased';
}

export const collectOverridePressure: Collector = (facts: RepoFacts): MetricResult => {
  const buckets: Record<string, Record<string, number>> = {};
  const samples: { sha: string; trailer: string; window: string }[] = [];
  for (const c of facts.commits) {
    for (const key of Object.keys(c.trailers)) {
      if (!key.startsWith('Noldor-Override')) continue;
      const window = releaseWindow(c.date, facts.releases);
      const row = (buckets[window] ??= {});
      row[key] = (row[key] ?? 0) + 1;
      samples.push({ sha: c.sha, trailer: key, window });
    }
  }
  return {
    id: 'override-pressure',
    unit: 'override commits',
    value: buckets,
    formula:
      'Count of commits carrying a Noldor-Override-prefixed trailer, grouped by trailer key and by release window (first tag dated >= commit date; after last tag → unreleased).',
    blindSpots: [
      'Only trailer-carrying overrides count; env-var bypasses (the release-skip env flags) leave no commit trace.',
      'Rising counts can mean a stricter gate OR more violations — the metric flags friction, not fault.',
    ],
    samples,
  };
};
