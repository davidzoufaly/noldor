import type { Collector, MetricResult, RepoFacts } from '../types.js';

interface Row {
  slug: string;
  days: number;
  path: string;
  provenance: 'autonomous' | 'operator' | 'unknown-provenance';
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export const collectCycleTime: Collector = (facts: RepoFacts): MetricResult => {
  const tagDates = new Map(facts.releases.map((r) => [r.version, r.date]));
  const intakeBySlug = new Map(facts.intake.map((i) => [i.slug, i]));
  const commitsBySlug = new Map<string, RepoFacts['commits']>();
  for (const c of facts.commits) {
    const slug = c.trailers['Noldor-FD'];
    if (!slug) continue;
    const list = commitsBySlug.get(slug) ?? [];
    list.push(c);
    commitsBySlug.set(slug, list);
  }
  const eventSlugs = new Set(facts.agentEvents.map((e) => e.slug).filter(Boolean));
  const rows: Row[] = [];
  let noIntake = 0;
  let noTag = 0;
  for (const f of facts.features) {
    const version = f.fm.introduced;
    if (!version) continue;
    const end = tagDates.get(version);
    if (!end) {
      noTag += 1;
      continue;
    }
    const start = f.fm.since ?? intakeBySlug.get(f.slug)?.since;
    if (!start) {
      noIntake += 1;
      continue;
    }
    const days = Math.round(((Date.parse(end) - Date.parse(start)) / 86_400_000) * 10) / 10;
    const cs = commitsBySlug.get(f.slug) ?? [];
    const paths = [...new Set(cs.map((c) => c.trailers['Noldor-Path']).filter(Boolean))];
    const path = paths.length === 0 ? 'unknown' : paths.length === 1 ? paths[0] : 'mixed';
    const provenance = eventSlugs.has(f.slug)
      ? 'autonomous'
      : paths.length > 0
        ? 'operator'
        : 'unknown-provenance';
    rows.push({ slug: f.slug, days, path, provenance });
  }
  const sorted = rows.map((r) => r.days).sort((a, b) => a - b);
  const byPath: Record<string, number[]> = {};
  for (const r of rows) (byPath[r.path] ??= []).push(r.days);
  const medianByPath = Object.fromEntries(
    Object.entries(byPath).map(([p, ds]) => [
      p,
      percentile(
        [...ds].sort((a, b) => a - b),
        50,
      ),
    ]),
  );
  return {
    id: 'cycle-time',
    unit: 'days',
    value: {
      medianDays: percentile(sorted, 50),
      p90Days: percentile(sorted, 90),
      medianByPath,
      excluded: { noIntake, noTag },
    },
    formula:
      'days(intake → release): intake = FD frontmatter `since` else roadmap-history recovery; release = creator date of tag v<introduced>. Median + p90 over FDs with both endpoints.',
    blindSpots: [
      'FDs with unrecoverable intake or an introduced version without a matching v-tag are excluded (see excluded tally).',
      'Provenance segmentation approximates: autonomous = any agent-event for the slug; pre-event-log autonomous ships read as operator/unknown.',
      'Pre-Noldor-Path commits make path segmentation read `unknown`.',
    ],
    samples: rows,
  };
};
