import type { Collector, MetricResult, RepoFacts } from '../types.js';

export const collectDrainReliability: Collector = (facts: RepoFacts): MetricResult => {
  const lastRun = facts.drainState
    ? {
        shipped: facts.drainState.shipped,
        skipped: facts.drainState.skip.length,
        retried: Object.keys(facts.drainState.retries).length,
      }
    : null;
  const hasHistory = facts.agentEvents.length > 0 || facts.escalations.length > 0;
  // `event` absent ⇒ exited (pre-vocabulary rows): only completed spawns carry
  // a duration — a `spawned`/`phase` row has none and must not drag the mean to 0.
  const durations = facts.agentEvents
    .filter((e) => e.event === 'exited' || e.event === undefined)
    .map((e) => e.durationMs ?? 0);
  const escalatedBySlug: Record<string, number> = {};
  for (const e of facts.escalations) escalatedBySlug[e.slug] = (escalatedBySlug[e.slug] ?? 0) + 1;
  const history = hasHistory
    ? {
        salvaged: facts.agentEvents.filter((e) => e.kind === 'salvaged').length,
        escalatedTotal: facts.escalations.length,
        escalatedBySlug,
        meanDurationMs:
          durations.length > 0
            ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
            : 0,
      }
    : null;
  return {
    id: 'drain-reliability',
    unit: 'runs / events',
    value: { lastRun, history },
    formula:
      'lastRun: shipped/skip/retries from .noldor/drain-state.json (live snapshot, overwritten per run). history: salvaged = agent-events kind=salvaged; escalated = escalations.jsonl counts (total/per-slug — rows carry no run id); mean duration over all agent-events.',
    blindSpots: [
      'drain-state.json is the LATEST run only — it cannot yield per-run history or trends.',
      'Event/escalation history starts at the event-log epoch (2026-06-12); earlier drains are invisible.',
      'EscalationRow has no run identifier — per-run escalation grouping is not derivable (run-id is out of v1 scope).',
    ],
    samples: facts.escalations.map((e) => ({ slug: e.slug, reason: e.reason, ts: e.ts })),
  };
};
