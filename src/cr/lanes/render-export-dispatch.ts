// @tests: ui-design-review-lane
// Prompt + child contract for the render-compare lane's design EXPORTER — the
// lane's single dispatched role (spec R5). The child opens the scratch `.pen`
// through pencil MCP, selects each surface's `FINAL:` page, and exports it to
// PNG at the exact output path. No judgment, no findings: the child's report
// only classifies WHY a surface has no file (page selection), and is never a
// pass — the trusted evidence is the decoded PNG on disk, validated Node-side.

import { z } from 'zod';

import {
  defineSurfaceLane,
  finalPageJobs,
  PenDispatchError,
  surfaceCandidatesSchema,
  type PenSurfacesInput,
} from './pen-dispatch.js';

/** Each request's `outPath` is where that surface's selected-page PNG lands. */
export type RenderExportInput = PenSurfacesInput;

export function buildRenderExportPrompt(input: RenderExportInput): string {
  return `You are a design EXPORTER for a mechanical pixel-diff pipeline. You render pages of a Pencil \`.pen\` design to PNG files. You make no judgments and report no findings — only whether each export happened.

The design is a scratch COPY at \`${input.penPath}\`. Read and export it through pencil MCP — only pencil renders pages, and an export is a render: call \`get_app_state\` (with \`include_schema\` and \`include_canvas_design\`) once for the SCHEMA AND API DOCS ONLY, then do ALL reading and exporting via \`execute({ filePath: "${input.penPath}", input: ... })\`. get_app_state describes whatever file the editor has active — which may be a DIFFERENT design — so page names and node ids taken from it are invalid: enumerate pages exclusively through \`execute\` against the filePath above (e.g. a snippet over the document's top-level children). Do not read a \`.pen\` with a file-reading tool (its raw JSON is not what renders), and never touch any design file under the repository.

${finalPageJobs(input, 'Export', 'export that surface')}
3. Export the selected page's node: \`Export(["<nodeId>"], "png", "<outputDir>", { scale: 1 })\`. IMPORTANT: the third argument is a DIRECTORY — the file lands at \`<outputDir>/<nodeId>.png\`. Pass \`scale: 1\` explicitly (the default is 2). Then move/rename that file to the surface's exact output path listed above.

Do not create, modify, or save anything in the design; do not write any file except the listed output paths (and the exporter's intermediate \`<nodeId>.png\`, which you move).

Report one entry per surface — the candidates are the report; there is no verdict field.`;
}

/** The exporter's dispatch failure; `reason` picks the sink's reason detail. */
export class RenderExportError extends PenDispatchError {
  override readonly name = 'RenderExportError';
}

/**
 * The exporter's dispatch seam (`setRenderExportDispatcher` is the test seam —
 * production code never calls it). The shape is valid JSON, so an echo still
 * parses; the repair round restates the exporter's page enumeration as a valid
 * report, and opens no design, exports nothing and moves no file.
 */
export const {
  reportSchema: renderExportReportSchema,
  setDispatcher: setRenderExportDispatcher,
  dispatch: dispatchRenderExport,
} = defineSurfaceLane({
  lane: 'render-compare',
  site: 'cr.render-export-dispatch',
  label: 'render-compare export',
  error: RenderExportError,
  // The page ENUMERATION only: the lane re-derives the selection from
  // `candidates` itself and trusts files for the export, so the row carries no
  // outcome/verdict field for the child to be wrong in.
  row: surfaceCandidatesSchema.strict(),
  shape:
    '{"surfaces": [{"surface": "dashboard", "candidates": ["overview"]}, {"surface": "settings", "candidates": ["default", "expanded"]}]}',
  prompt: buildRenderExportPrompt,
  repair: {
    lead: 'A previous design exporter finished its exports, but its report was rejected',
    job: 'Your ONLY job is to restate the per-surface page enumeration that exporter reported — do not open the design, do not export anything, do not move any file.',
    rules: [
      'One entry per surface the exporter reported, carrying the `FINAL:<surface>:` page names it found, verbatim.',
      'Invent no surface and no page name the output does not state.',
      'If nothing above states the enumeration, write no answer at all.',
    ],
  },
});
export type RenderExportReport = z.infer<typeof renderExportReportSchema>;
