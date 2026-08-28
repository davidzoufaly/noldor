import type { Slug } from '../core/slug.js';
// scripts/cr/lane-types.ts
import type { ArtifactKind, Finding, Lane, LaneFindings } from './findings-schema.js';
import type { ReviewProfile } from '../core/review-profile.js';

/**
 * The prior round's adjudicated blockers plus how the prompt must frame them.
 * `fixes-in-diff` is granted only when a non-empty fix diff was verified;
 * every other re-run shape gets `reexamine`, which asserts nothing unverified
 * — the safe direction is re-confirmation, never suppression.
 */
export interface PriorReview {
  blockers: Finding[];
  mode: 'fixes-in-diff' | 'reexamine';
}

export interface LaneInput {
  /** Branded: the sink path is built from it, so it arrives already parsed. */
  slug: Slug;
  artifact: string;
  kind: ArtifactKind;
  fdPath: string;
  artifactSha: string;
  baseSha?: string;
  fullReview?: boolean;
  reviewProfile?: ReviewProfile;
  /**
   * Wall-clock cap per agent dispatch, resolved once by orchestrate from
   * `crReview.dispatchTimeoutMs`. Absent for direct lane callers (unit tests,
   * ad-hoc runs), which fall back to `DEFAULT_DISPATCH_TIMEOUT_MS`.
   */
  dispatchTimeoutMs?: number;
  /**
   * Prior-round context for the reviewer lane. Lane-generic on purpose so other
   * lanes can opt in later; today only `runSubagent` forwards it into the prompt.
   */
  priorReview?: PriorReview;
  repoRoot: string;
}

export interface LaneResult {
  lane: Lane;
  sinkPath: string;
  ok: boolean;
}

export type RunLane = (input: LaneInput) => Promise<LaneResult>;

export type { LaneFindings };
