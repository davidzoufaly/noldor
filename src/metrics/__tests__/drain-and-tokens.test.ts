// @tests: outcome-telemetry-and-effectiveness-metrics
import { describe, expect, it } from 'vitest';
import { collectDrainReliability } from '../collect/drain-reliability';
import { collectTokensPerFeature } from '../collect/tokens-per-feature';
import { emptyFacts } from './fixtures';
import type { AgentEvent } from '../../core/agent-events';

const EV = (over: Partial<AgentEvent>): AgentEvent => ({
  ts: '2026-06-12T00:00:00Z',
  runner: 'claude',
  role: 'drain-implementer',
  exitCode: 0,
  durationMs: 60_000,
  timedOut: false,
  ...over,
});

describe('collectDrainReliability', () => {
  it('separates last-run snapshot from event history', () => {
    const facts = emptyFacts({
      drainState: {
        pid: 1,
        startedAt: 'x',
        phase: 'idle',
        inFlight: [],
        merging: null,
        currentSlug: null,
        shipped: 2,
        skip: ['s1'],
        retries: { s2: 1 },
      },
      agentEvents: [EV({ slug: 'a', kind: 'salvaged' }), EV({ slug: 'b' })],
      escalations: [
        {
          ts: '2026-06-12T01:00:00Z',
          slug: 'c',
          source: 'roadmap',
          reason: 'retries-exhausted',
          evidence: 'e',
          stateSnapshot: { shipped: 0, skipped: [] },
          suggestedAction: 'x',
        },
      ],
    });
    const v = collectDrainReliability(facts).value as {
      lastRun: { shipped: number; skipped: number; retried: number } | null;
      history: { salvaged: number; escalatedTotal: number; meanDurationMs: number };
    };
    expect(v.lastRun).toEqual({ shipped: 2, skipped: 1, retried: 1 });
    expect(v.history.salvaged).toBe(1);
    expect(v.history.escalatedTotal).toBe(1);
    expect(v.history.meanDurationMs).toBe(60_000);
  });

  it('emits null history parts when event sources are absent', () => {
    const v = collectDrainReliability(emptyFacts()).value as { lastRun: null; history: null };
    expect(v.lastRun).toBeNull();
    expect(v.history).toBeNull();
  });
});

describe('collectTokensPerFeature', () => {
  it('sums tokens.total per slug, only over token-bearing events', () => {
    const facts = emptyFacts({
      agentEvents: [
        EV({ slug: 'a', tokens: { input: 100, output: 10, total: 110, source: 'claude-jsonl' } }),
        EV({ slug: 'a', tokens: { input: 50, output: 5, total: 55, source: 'codex-session' } }),
        EV({ slug: 'a' }),
        EV({ slug: 'b' }),
      ],
    });
    const v = collectTokensPerFeature(facts).value as Record<string, number | null>;
    expect(v.a).toBe(165);
    expect(v.b).toBeNull();
  });
});
