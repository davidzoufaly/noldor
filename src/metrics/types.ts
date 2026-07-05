import type { AgentEvent } from '../core/agent-events.js';
import type { EscalationRow } from '../autonomous/escalations.js';
import type { DrainState } from '../autonomous/drain-state.js';
import type { LaneFindings } from '../cr/findings-schema.js';
import type { FeatureFrontmatter } from '../core/feature-schema.js';

export interface CommitFact {
  sha: string;
  /** Committer date, ISO. */
  date: string;
  subject: string;
  trailers: Record<string, string>;
  insertions: number;
  deletions: number;
}

export interface FeatureFact {
  slug: string;
  fm: FeatureFrontmatter;
}

/** Intake metadata recovered from roadmap/backlog git history (promotion deletes the source block). */
export interface IntakeFact {
  slug: string;
  since?: string;
  parent?: string;
  size?: string;
}

export interface ReleaseFact {
  /** Without the leading 'v'. */
  version: string;
  /** Tag (creator) date, ISO. */
  date: string;
}

export interface RepoFacts {
  commits: CommitFact[];
  features: FeatureFact[];
  intake: IntakeFact[];
  laneFindings: LaneFindings[];
  agentEvents: AgentEvent[];
  escalations: EscalationRow[];
  drainState: DrainState | null;
  releases: ReleaseFact[];
  warnings: string[];
}

export interface MetricResult {
  id: string;
  value: unknown;
  unit: string;
  /** Human-readable derivation. REQUIRED — the honesty rail lives in code. */
  formula: string;
  /** REQUIRED, never empty — every metric has at least one blind spot. */
  blindSpots: string[];
  /** Underlying rows, for audit. */
  samples: unknown[];
}

export type Collector = (facts: RepoFacts) => MetricResult;

export interface MetricsReport {
  generatedAt: string;
  head: string;
  factsWarnings: string[];
  metrics: MetricResult[];
}
