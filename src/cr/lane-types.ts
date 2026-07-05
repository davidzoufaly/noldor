// scripts/cr/lane-types.ts
import type { ArtifactKind, Lane, LaneFindings } from './findings-schema.js';
import type { ReviewProfile } from '../core/review-profile.js';

export interface LaneInput {
  slug: string;
  artifact: string;
  kind: ArtifactKind;
  fdPath: string;
  artifactSha: string;
  baseSha?: string;
  fullReview?: boolean;
  reviewProfile?: ReviewProfile;
  repoRoot: string;
}

export interface LaneResult {
  lane: Lane;
  sinkPath: string;
  ok: boolean;
}

export type RunLane = (input: LaneInput) => Promise<LaneResult>;

export type { LaneFindings };
