import type { Slug } from '../core/slug.js';
// scripts/cr/lane-types.ts
import type { ArtifactKind, Finding, Lane, LaneFindings } from './findings-schema.js';
import type { ReviewProfile } from '../core/review-profile.js';

/**
 * A finding the series has already decided (Q-0261): one a lane answered resolved (`fixed`), or
 * one the operator disposed. Every prior-aware lane is shown the series' decided findings, from
 * every lane, after its own priors.
 */
export interface DecidedFinding {
  /** The finding's `fingerprintBlocker` id. */
  readonly id: string;
  readonly finding: Finding;
  /**
   * `fixed`, or one of the arbitration record's `DISPOSITIONS`. Spelled out rather than imported
   * so the lane types stay a leaf; `decisions.ts` builds these from its own schema, so a vocabulary
   * that drifted would stop compiling there.
   */
  readonly disposition: 'fixed' | 'accepted' | 'rejected' | 'deferred';
  /** The lane's `why` for a fixed finding, the operator's note for a disposition. */
  readonly reason: string;
  readonly round: number;
  /**
   * Operator dispositions only: true while the content the finding cites is unchanged at the head
   * under review, so the ruling still holds. Absent on a fixed finding, which nothing enforces.
   * Anything but `true` reads as not holding, which carries rather than suppresses.
   */
  readonly holds?: boolean;
}

/**
 * The prior round's adjudicated blockers plus how the prompt must frame them.
 * `fixes-in-diff` is granted only when a non-empty fix diff was verified;
 * every other re-run shape gets `reexamine`, which asserts nothing unverified
 * — the safe direction is re-confirmation, never suppression.
 */
export interface PriorReview {
  blockers: Finding[];
  mode: 'fixes-in-diff' | 'reexamine';
  /** The series' decided findings (Q-0261). Absent when the series has decided nothing. */
  decided?: readonly DecidedFinding[];
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
   * Prior-round context for the prior-aware lanes (`reviewer`, `codex`): their own standing
   * blockers and the series' decided findings.
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
