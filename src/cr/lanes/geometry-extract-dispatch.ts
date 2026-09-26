// @tests: ui-design-review-lane
// Prompt + child contract for the `geometry-compare` lane's DESIGN READER (spec
// D3). The child opens the scratch `.pen` through pencil MCP, resolves each
// surface's `FINAL:` page, walks it with a `Get` visitor, and writes one
// normalized geometry document per surface. Its answer carries the page
// ENUMERATION and the clipped-node exclusions only — the caller re-derives the
// selection with `selectFinalPage` and trusts the written file, parsed by
// `parseGeometryDoc`, as the evidence.

import { z } from 'zod';

import { penBridgeRecipe } from '../../design/pen-bridge.js';
import type { LaneAnswerContract, RepairContext } from '../lane-answer.js';
import { createAnswerSeam } from '../lane-spawn.js';
import { repairEvidence } from './prompt-parts.js';

/** One surface's extraction instruction. */
export interface ExtractRequest {
  surface: string;
  /** The recipe's `page` selector, when declared. */
  pageSelector?: string;
  /** Absolute path the surface's geometry document must land at. */
  outPath: string;
}

export interface GeometryExtractInput {
  /** Scratch COPY of the design — never the repo's own file. */
  penPath: string;
  requests: ExtractRequest[];
  /** Wall-clock cap; DEFAULT_DISPATCH_TIMEOUT_MS when the caller omits it. */
  timeoutMs?: number;
}

/**
 * Per-surface answer row: the page enumeration, plus the nodes the child
 * dropped because pen reported problems on them. No outcome field — the
 * document on disk is what gets validated, so the child has nothing to be
 * wrong about in its answer.
 */
export const extractOutcomeSchema = z
  .object({
    surface: z.string().min(1),
    /** `FINAL:<surface>:` page names found, `<name>` segment only. */
    candidates: z.array(z.string()).default([]),
    /** Nodes excluded because pen reported them clipped (spec D3). */
    excluded: z.array(z.string()).default([]),
  })
  .strict();
export type ExtractOutcome = z.infer<typeof extractOutcomeSchema>;

export const geometryExtractReportSchema = z
  .object({ surfaces: z.array(extractOutcomeSchema) })
  .strict();
export type GeometryExtractReport = z.infer<typeof geometryExtractReportSchema>;

export function buildGeometryExtractPrompt(input: GeometryExtractInput): string {
  const jobs = input.requests
    .map(
      (r) =>
        `- surface \`${r.surface}\`${r.pageSelector !== undefined ? ` (page selector: \`${r.pageSelector}\`)` : ' (no page selector)'} → \`${r.outPath}\``,
    )
    .join('\n');
  return `You are a design GEOMETRY READER for a mechanical layout-diff pipeline. You read resolved geometry out of a Pencil \`.pen\` design and write it as JSON documents. You make no judgments and report no findings.

The design is a scratch COPY at \`${input.penPath}\`. Read it through pencil MCP only: call \`get_app_state\` (with \`include_schema\`) once for the SCHEMA AND API DOCS ONLY, then do ALL reading via \`execute({ filePath: "${input.penPath}", input: ... })\`. get_app_state describes whatever file the editor has active — which may be a DIFFERENT design — so page names and node ids taken from it are invalid: enumerate pages exclusively through \`execute\` against the filePath above. Do not read a \`.pen\` with a file-reading tool (its raw JSON holds declared values, not resolved geometry), and never touch any design file under the repository.

${penBridgeRecipe(input.penPath)}

Extraction jobs (one selected page per surface):
${jobs}

For each surface:
1. Enumerate the design's top-level pages named \`FINAL:<surface>: <name>\` for that surface (exact surface segment). Collect the trimmed \`<name>\` segments as the candidates — report them ALL, verbatim, even when zero or ambiguous.
2. Select the page: with a page selector, the candidate exactly equal to it (trimmed, case-sensitive); without one, the single candidate if there is exactly one. Zero candidates, several candidates without a selector, a selector matching none, or two candidates with identical names — do NOT write that surface's file (the parent recomputes the same rule from your candidates and classifies it).
3. Read the selected page with ONE visitor pass, resolving variables:

\`\`\`js
const abs = (c) => { let x = 0, y = 0; for (let k = c; k; k = k.parentCtx) { x += k.bounds.x; y += k.bounds.y; } return { x, y }; };
Get(pageId, (n, c) => { const o = abs(c); return { id: n.id, name: n.name, type: n.type, problems: c.problems,
  x: o.x, y: o.y, w: c.bounds.width, h: c.bounds.height,
  content: n.content, fontSize: n.fontSize, layout: n.layout, gap: n.gap, padding: n.padding }; }, { resolveVariables: true })
\`\`\`

\`ctx.bounds\` is resolved in the PARENT's coordinate space, so the accumulation up \`parentCtx\` is required, and it must happen inside the callback, where the ancestor chain is still reachable. Never read a node's own \`x\`/\`y\`/\`width\`/\`height\`: \`x\`/\`y\` are ignored under a flex layout, and \`width\`/\`height\` may be \`fit_content\`, \`fill_container\`, or a variable. Then subtract the page node's own accumulated origin from every node's \`x\`/\`y\`, so the page's top-left is \`{0,0}\` and every box is page-relative.
4. Write the surface's output path as ONE JSON object in exactly this shape:

\`\`\`json
{"surface":"dashboard","viewport":{"width":1440,"height":900},
 "nodes":[{"name":"Card","kind":"container","box":{"x":24,"y":16,"w":320,"h":180},"spacing":{"rowGap":16,"padding":[24,24,24,24]}},
          {"name":"Title","kind":"text","box":{"x":48,"y":40,"w":200,"h":24},"fontSize":20,"text":"Revenue"},
          {"name":"Divider","kind":"shape","box":{"x":24,"y":200,"w":320,"h":1}}]}
\`\`\`

Rules for that file, all mandatory — the parent validates it and refuses the whole document on any violation:
- \`surface\` is the surface name exactly as listed in the jobs above.
- \`viewport\` is the selected page node's own resolved size (its \`ctx.bounds.width\` and \`ctx.bounds.height\`), both positive. The page node is the viewport, not an entry in \`nodes\`.
- \`nodes\` is a FLAT list of every node under the page, at any depth, in visit order.
- \`box\` is the page-relative \`{"x","y","w","h"}\` from step 3, in CSS pixels: every value a finite number, \`w\` and \`h\` at least 0.
- \`name\` is the pen node's name; omit the key when the node has none.
- \`kind\`: a pen \`text\` node whose \`content\` is non-empty after trimming → \`"text"\`; a pen \`text\` node with empty or whitespace-only \`content\` → \`"shape"\`; a pen \`frame\` → \`"container"\`; every other pen type → \`"shape"\`.
- Every \`"text"\` node carries \`text\` (its \`content\` as a plain, non-empty string; if \`content\` is not a plain string, join its runs' text) and \`fontSize\` (the resolved font size, a positive number). A text node whose font size does not resolve to a positive number is emitted as \`"shape"\`.
- \`text\` and \`fontSize\` appear on \`"text"\` nodes and NOWHERE else.
- \`spacing\`: pen \`gap\` becomes \`rowGap\` under \`layout: "vertical"\` and \`columnGap\` under \`layout: "horizontal"\` (drop it under any other layout); pen \`padding\` becomes the four-tuple \`[top, right, bottom, left]\` (a number becomes all four, \`[v, h]\` becomes \`[v, h, v, h]\`). Every spacing value is at least 0. Omit \`spacing\` entirely when the node declares neither. NEVER emit \`margin\` — pen has no margin property, and the parent rejects a design document that carries one.
- Exclude any node whose \`problems\` is set (pen reported it clipped): leave it out of \`nodes\` and list its name in that surface's \`excluded\` report entry (its id when it has no name).
- No other keys, at any level.

Do not create, modify, or save anything in the design; write no file except the listed output paths.

Report one entry per surface — its candidates and its excluded nodes are the report; there is no verdict field.`;
}

/** The example the answer instruction shows the reader — valid JSON, so an echo still parses. */
export const GEOMETRY_EXTRACT_SHAPE =
  '{"surfaces": [{"surface": "dashboard", "candidates": ["overview"], "excluded": []}, {"surface": "settings", "candidates": ["default", "expanded"], "excluded": ["Badge"]}]}';

/**
 * The repair round's prompt: restate the reader's page enumeration and exclusions as a
 * valid report. It opens no design and reads or writes no geometry document.
 */
export function buildGeometryExtractRepairPrompt(ctx: RepairContext): string {
  return `A previous design geometry reader finished its work, but its report was rejected: ${ctx.error}. Your ONLY job is to restate the per-surface report that reader gave — do not open the design, do not read or write any geometry document.

${repairEvidence(ctx)}

Transcription rules:
1. One entry per surface the reader reported, carrying the \`FINAL:<surface>:\` page names it found and the node names it excluded, verbatim.
2. Invent no surface, page name, or node name the output does not state; an entry whose exclusions are not stated gets \`"excluded": []\`.
3. If nothing above states the enumeration, write no answer at all.`;
}

/** What the reader child hands back, and how the seam reads it. */
export const GEOMETRY_EXTRACT_ANSWER: LaneAnswerContract<GeometryExtractReport> = {
  lane: 'geometry-extract',
  shape: GEOMETRY_EXTRACT_SHAPE,
  schema: geometryExtractReportSchema,
  repairPrompt: buildGeometryExtractRepairPrompt,
};

/** Carries which reason detail the caller should record, so the sink stays specific. */
export class GeometryExtractError extends Error {
  readonly reason: 'timeout' | 'dispatch-failed';

  constructor(reason: 'timeout' | 'dispatch-failed', message: string) {
    super(message);
    this.name = 'GeometryExtractError';
    this.reason = reason;
  }
}

const seam = createAnswerSeam<GeometryExtractInput, GeometryExtractReport>(
  buildGeometryExtractPrompt,
  {
    site: 'cr.geometry-extract-dispatch',
    contract: GEOMETRY_EXTRACT_ANSWER,
    onFailure: (f) => {
      throw new GeometryExtractError(
        f.reason,
        f.timedOut
          ? 'geometry-extract dispatch timed out'
          : `geometry-extract dispatch failed: ${f.detail ?? `exit ${f.exitCode}`}`,
      );
    },
  },
);

/** Test seam — production code never calls this. */
export const setGeometryExtractDispatcher = seam.setDispatcher;
export const dispatchGeometryExtract = seam.dispatch;
