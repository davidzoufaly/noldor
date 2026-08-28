// @tests: ui-design-review-lane
// Opening a lane's sink and writing it. Every lane resolved its own sink path,
// stamped `startedAt`, created `.noldor/cr/` defensively, filled the same five
// identity fields on every payload and mapped the result to a `LaneResult` — the
// identical dance around whatever the lane actually decided. This owns it, so a
// lane body carries verdicts rather than plumbing.

import { mkdir } from 'node:fs/promises';
import type { Slug } from '../core/slug.js';
import { dirname } from 'node:path';

import { writeJsonAtomic } from './atomic-write.js';
import { openLane } from './filename.js';
import type { ArtifactKind, Lane, LaneFindings } from './findings-schema.js';
import type { LaneResult } from './lane-types.js';

/** The identity fields the sink derives; a lane never restates them. */
export type SinkPayload = Omit<LaneFindings, 'lane' | 'artifact' | 'kind' | 'slug' | 'startedAt'>;

export interface LaneSink {
  readonly sinkPath: string;
  readonly startedAt: string;
  /** Write the one sink for this round. `ok` drives orchestrate's exit code. */
  write: (payload: SinkPayload, ok: boolean) => Promise<LaneResult>;
}

export function openLaneSink(
  input: { repoRoot: string; slug: Slug; kind: ArtifactKind; artifact: string },
  lane: Lane,
): LaneSink {
  const { sinkPath, startedAt } = openLane(input, lane);
  return {
    sinkPath,
    startedAt,
    write: async (payload, ok) => {
      // Orchestrate pre-creates `.noldor/cr/`, but a lane stays self-sufficient
      // for direct callers and unit tests.
      await mkdir(dirname(sinkPath), { recursive: true });
      await writeJsonAtomic(sinkPath, {
        lane,
        artifact: input.artifact,
        kind: input.kind,
        slug: input.slug,
        startedAt,
        finishedAt: new Date().toISOString(),
        ...payload,
      } satisfies LaneFindings);
      return { lane, sinkPath, ok };
    },
  };
}
