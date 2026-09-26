// @tests: ui-design-review-lane
// What the lanes that dispatch a pencil-MCP child share. The two mechanical
// children — render-compare's exporter and geometry-compare's reader — take the
// same per-surface jobs, follow the same enumerate-then-select steps over the
// `FINAL:` pages, and report the same enumeration row; all three pencil lanes
// (those two plus the ui-reviewer) turn a failed dispatch into the lane's own
// typed error the same way. One copy, so the children cannot drift on the page
// rule the parent re-derives with `selectFinalPage`.

import { z } from 'zod';

import { penBridgeRecipe } from '../../design/pen-bridge.js';
import type { AgentRole } from '../../core/agent-runner/types.js';
import type { LaneAnswerContract, RepairContext } from '../lane-answer.js';
import { createAnswerSeam, type LaneSpawnFailure } from '../lane-spawn.js';
import { transcriptionPrompt } from './prompt-parts.js';

/** One surface's job: which `FINAL:` page to read, and where its output file lands. */
export interface PenSurfaceRequest {
  surface: string;
  /** The recipe's `page` selector, when declared. */
  pageSelector?: string;
  /** Absolute path the surface's output file must land at. */
  outPath: string;
}

export interface PenSurfacesInput {
  /** Scratch COPY of the design — never the repo's own file. */
  penPath: string;
  requests: PenSurfaceRequest[];
  /** Wall-clock cap; DEFAULT_DISPATCH_TIMEOUT_MS when the caller omits it. */
  timeoutMs?: number;
}

/**
 * The page ENUMERATION a per-surface report row carries. Not strict on its own:
 * each lane `.extend`s it with its extra fields, then applies `.strict()`.
 */
export const surfaceCandidatesSchema = z.object({
  surface: z.string().min(1),
  /** `FINAL:<surface>:` page names found, `<name>` segment only. */
  candidates: z.array(z.string()).default([]),
});

/**
 * The bridge-wake recipe, the job list, and steps 1–2 (enumerate, then select)
 * of a mechanical child's per-surface loop. `skip` is what the child must NOT
 * do for a surface whose page cannot be selected; the caller continues the
 * numbered list from step 3.
 */
export function finalPageJobs(input: PenSurfacesInput, jobsHeading: string, skip: string): string {
  const jobs = input.requests
    .map(
      (r) =>
        `- surface \`${r.surface}\`${r.pageSelector !== undefined ? ` (page selector: \`${r.pageSelector}\`)` : ' (no page selector)'} → \`${r.outPath}\``,
    )
    .join('\n');
  return `${penBridgeRecipe(input.penPath)}

${jobsHeading} jobs (one selected page per surface):
${jobs}

For each surface:
1. Enumerate the design's top-level pages named \`FINAL:<surface>: <name>\` for that surface (exact surface segment). Collect the trimmed \`<name>\` segments as the candidates — report them ALL, verbatim, even when zero or ambiguous.
2. Select the page: with a page selector, the candidate exactly equal to it (trimmed, case-sensitive); without one, the single candidate if there is exactly one. Zero candidates, several candidates without a selector, a selector matching none, or two candidates with identical names — do NOT ${skip} (the parent recomputes the same rule from your candidates and classifies it).`;
}

/**
 * A pencil lane's dispatch failure, carrying which reason detail the caller
 * records so the sink stays specific. Each lane subclasses it under its own
 * name, so `instanceof` tells the lanes apart.
 */
export class PenDispatchError extends Error {
  readonly reason: LaneSpawnFailure;

  constructor(reason: LaneSpawnFailure, message: string) {
    super(message);
    this.reason = reason;
  }
}

type PenDispatchErrorClass = new (reason: LaneSpawnFailure, message: string) => PenDispatchError;

/**
 * {@link createAnswerSeam} for a pencil lane: an unusable dispatch throws
 * `error`, with a message that leads with `label` and says whether it timed out.
 */
export function createPenDispatchSeam<I extends { timeoutMs?: number }, T>(
  build: (input: I) => string,
  opts: {
    site: string;
    contract: LaneAnswerContract<T>;
    label: string;
    error: PenDispatchErrorClass;
  },
): ReturnType<typeof createAnswerSeam<I, T>> {
  return createAnswerSeam<I, T>(build, {
    site: opts.site,
    contract: opts.contract,
    onFailure: (f) => {
      throw new opts.error(
        f.reason,
        f.timedOut
          ? `${opts.label} dispatch timed out`
          : `${opts.label} dispatch failed: ${f.detail ?? `exit ${f.exitCode}`}`,
      );
    },
  });
}

/**
 * Everything a mechanical per-surface lane (exporter, geometry reader) declares
 * past its prompt: the `{ surfaces: [row] }` report, the answer contract, the
 * repair round that restates the child's enumeration (`repair` is its lead,
 * its one job, and its transcription rules), and the dispatch seam.
 */
export function defineSurfaceLane<Row extends z.ZodTypeAny>(spec: {
  lane: AgentRole;
  site: string;
  label: string;
  error: PenDispatchErrorClass;
  row: Row;
  shape: string;
  prompt: (input: PenSurfacesInput) => string;
  repair: { lead: string; job: string; rules: readonly string[] };
}) {
  const reportSchema = z.object({ surfaces: z.array(spec.row) }).strict();
  const repairPrompt = (ctx: RepairContext): string =>
    transcriptionPrompt(ctx, spec.repair.lead, spec.repair.job, spec.repair.rules);
  const contract: LaneAnswerContract<z.infer<typeof reportSchema>> = {
    lane: spec.lane,
    shape: spec.shape,
    schema: reportSchema,
    repairPrompt,
  };
  const seam = createPenDispatchSeam(spec.prompt, {
    site: spec.site,
    contract,
    label: spec.label,
    error: spec.error,
  });
  return { reportSchema, contract, repairPrompt, ...seam };
}
