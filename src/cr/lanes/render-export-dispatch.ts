// @tests: ui-design-review-lane
// Prompt + child contract for the render-compare lane's design EXPORTER — the
// lane's single dispatched role (spec R5). The child opens the scratch `.pen`
// through pencil MCP, selects each surface's `FINAL:` page, and exports it to
// PNG at the exact output path. No judgment, no findings: the child's report
// only classifies WHY a surface has no file (page selection), and is never a
// pass — the trusted evidence is the decoded PNG on disk, validated Node-side.

import { z } from 'zod';

import { penBridgeRecipe } from '../../design/pen-bridge.js';
import type { LaneAnswerContract, RepairContext } from '../lane-answer.js';
import { createAnswerSeam } from '../lane-spawn.js';
import { repairEvidence } from './prompt-parts.js';

/** One surface's export instruction. */
export interface ExportRequest {
  surface: string;
  /** The recipe's `page` selector, when declared. */
  pageSelector?: string;
  /** Absolute path the selected page's PNG must land at. */
  outPath: string;
}

export interface RenderExportInput {
  /** Scratch COPY of the design — never the repo's own file. */
  penPath: string;
  requests: ExportRequest[];
  /** Wall-clock cap; DEFAULT_DISPATCH_TIMEOUT_MS when the caller omits it. */
  timeoutMs?: number;
}

/**
 * Per-surface child report row: the page ENUMERATION only. The lane re-derives
 * the selection from `candidates` itself and trusts files for the export — so
 * the contract deliberately carries no outcome/verdict field for the child to
 * be wrong in.
 */
export const exportOutcomeSchema = z
  .object({
    surface: z.string().min(1),
    /** `FINAL:<surface>:` page names found, `<name>` segment only. */
    candidates: z.array(z.string()).default([]),
  })
  .strict();
export type ExportOutcome = z.infer<typeof exportOutcomeSchema>;

export const renderExportReportSchema = z
  .object({ surfaces: z.array(exportOutcomeSchema) })
  .strict();
export type RenderExportReport = z.infer<typeof renderExportReportSchema>;

export function buildRenderExportPrompt(input: RenderExportInput): string {
  const jobs = input.requests
    .map(
      (r) =>
        `- surface \`${r.surface}\`${r.pageSelector !== undefined ? ` (page selector: \`${r.pageSelector}\`)` : ' (no page selector)'} → \`${r.outPath}\``,
    )
    .join('\n');
  return `You are a design EXPORTER for a mechanical pixel-diff pipeline. You render pages of a Pencil \`.pen\` design to PNG files. You make no judgments and report no findings — only whether each export happened.

The design is a scratch COPY at \`${input.penPath}\`. Read and export it through pencil MCP — only pencil renders pages, and an export is a render: call \`get_app_state\` (with \`include_schema\` and \`include_canvas_design\`) once for the SCHEMA AND API DOCS ONLY, then do ALL reading and exporting via \`execute({ filePath: "${input.penPath}", input: ... })\`. get_app_state describes whatever file the editor has active — which may be a DIFFERENT design — so page names and node ids taken from it are invalid: enumerate pages exclusively through \`execute\` against the filePath above (e.g. a snippet over the document's top-level children). Do not read a \`.pen\` with a file-reading tool (its raw JSON is not what renders), and never touch any design file under the repository.

${penBridgeRecipe(input.penPath)}

Export jobs (one selected page per surface):
${jobs}

For each surface:
1. Enumerate the design's top-level pages named \`FINAL:<surface>: <name>\` for that surface (exact surface segment). Collect the trimmed \`<name>\` segments as the candidates — report them ALL, verbatim, even when zero or ambiguous.
2. Select the page: with a page selector, the candidate exactly equal to it (trimmed, case-sensitive); without one, the single candidate if there is exactly one. Zero candidates, several candidates without a selector, a selector matching none, or two candidates with identical names — do NOT export that surface (the parent recomputes the same rule from your candidates and classifies it).
3. Export the selected page's node: \`Export(["<nodeId>"], "png", "<outputDir>", { scale: 1 })\`. IMPORTANT: the third argument is a DIRECTORY — the file lands at \`<outputDir>/<nodeId>.png\`. Pass \`scale: 1\` explicitly (the default is 2). Then move/rename that file to the surface's exact output path listed above.

Do not create, modify, or save anything in the design; do not write any file except the listed output paths (and the exporter's intermediate \`<nodeId>.png\`, which you move).

Report one entry per surface — the candidates are the report; there is no verdict field.`;
}

/** The example the answer instruction shows the exporter — valid JSON, so an echo still parses. */
export const RENDER_EXPORT_SHAPE =
  '{"surfaces": [{"surface": "dashboard", "candidates": ["overview"]}, {"surface": "settings", "candidates": ["default", "expanded"]}]}';

/**
 * The repair round's prompt: restate the exporter's page enumeration as a valid report. It
 * opens no design, exports nothing and moves no file.
 */
export function buildRenderExportRepairPrompt(ctx: RepairContext): string {
  return `A previous design exporter finished its exports, but its report was rejected: ${ctx.error}. Your ONLY job is to restate the per-surface page enumeration that exporter reported — do not open the design, do not export anything, do not move any file.

${repairEvidence(ctx)}

Transcription rules:
1. One entry per surface the exporter reported, carrying the \`FINAL:<surface>:\` page names it found, verbatim.
2. Invent no surface and no page name the output does not state.
3. If nothing above states the enumeration, write no answer at all.`;
}

/** What the exporter child hands back, and how the seam reads it. */
export const RENDER_EXPORT_ANSWER: LaneAnswerContract<RenderExportReport> = {
  lane: 'render-compare',
  shape: RENDER_EXPORT_SHAPE,
  schema: renderExportReportSchema,
  repairPrompt: buildRenderExportRepairPrompt,
};

/** Carries which reason detail the lane should record, so the sink stays specific. */
export class RenderExportError extends Error {
  readonly reason: 'timeout' | 'dispatch-failed';

  constructor(reason: 'timeout' | 'dispatch-failed', message: string) {
    super(message);
    this.name = 'RenderExportError';
    this.reason = reason;
  }
}

const seam = createAnswerSeam<RenderExportInput, RenderExportReport>(buildRenderExportPrompt, {
  site: 'cr.render-export-dispatch',
  contract: RENDER_EXPORT_ANSWER,
  onFailure: (f) => {
    throw new RenderExportError(
      f.reason,
      f.timedOut
        ? 'render-compare export dispatch timed out'
        : `render-compare export dispatch failed: ${f.detail ?? `exit ${f.exitCode}`}`,
    );
  },
});

/** Test seam — production code never calls this. */
export const setRenderExportDispatcher = seam.setDispatcher;
export const dispatchRenderExport = seam.dispatch;
