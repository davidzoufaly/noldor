import type { Collector, MetricResult, RepoFacts } from '../types.js';

export const collectTokensPerFeature: Collector = (facts: RepoFacts): MetricResult => {
  const totals: Record<string, number | null> = {};
  for (const e of facts.agentEvents) {
    if (!e.slug) continue;
    if (e.tokens) totals[e.slug] = (totals[e.slug] ?? 0) + e.tokens.total;
    else totals[e.slug] ??= null;
  }
  return {
    id: 'tokens-per-feature',
    unit: 'raw tokens (NEVER cost)',
    value: totals,
    formula:
      'Sum of agent-event tokens.total per slug. Tokens are read verbatim from runner usage records (claude-jsonl / codex-session / opencode-session); events without trustworthy usage carry no tokens.',
    blindSpots: [
      'null = no usage data, not zero usage: operator-driven interactive sessions and runners without locatable usage records are invisible.',
      'Only spawn-captured agents count; epoch-limited to when token capture shipped.',
    ],
    samples: facts.agentEvents
      .filter((e) => e.tokens)
      .map((e) => ({
        slug: e.slug,
        runner: e.runner,
        total: e.tokens?.total,
        source: e.tokens?.source,
      })),
  };
};
