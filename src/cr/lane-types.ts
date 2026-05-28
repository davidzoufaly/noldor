// scripts/cr/lane-types.ts
import type { ArtifactKind, Lane, LaneFindings } from './findings-schema.js';

export interface LaneInput {
  slug: string;
  artifact: string;
  kind: ArtifactKind;
  fdPath: string;
  artifactSha: string;
  baseSha?: string;
  fullReview?: boolean;
  repoRoot: string;
}

export interface LaneResult {
  lane: Lane;
  sinkPath: string;
  ok: boolean;
}

export type RunLane = (input: LaneInput) => Promise<LaneResult>;

export type { LaneFindings };
