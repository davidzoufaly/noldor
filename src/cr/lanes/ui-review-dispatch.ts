// @tests: ui-design-review-lane
// Prompt + child contract for the `ui-reviewer` lane. The child opens the design
// itself through pencil MCP, because the review judges rendered pages and only
// pencil renders them; Node resolves the path. Parse half only;
// sink policy lives in ui-review.ts, mirroring the reviewer/verifier split.

import { z } from 'zod';

import { penBridgeRecipe } from '../../design/pen-bridge.js';
import type { LaneAnswerContract, RepairContext } from '../lane-answer.js';
import { createAnswerSeam } from '../lane-spawn.js';
import { repairEvidence } from './prompt-parts.js';

/**
 * One finding from the child. `designPage` + `designElement` are REQUIRED: a
 * design-fidelity finding that cannot name both sides it compared is not
 * actionable, and making them optional would let the model emit taste.
 */
export const uiFindingSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().nonnegative().optional(),
  severity: z.enum(['high', 'med', 'low']),
  message: z.string().min(1),
  designPage: z.string().min(1),
  designElement: z.string().min(1),
});
export type UiFinding = z.infer<typeof uiFindingSchema>;

/** Reason codes the CHILD may report. Every other code is parent-side. */
export const childReasonSchema = z.enum(['pen-unreadable', 'no-final-pages']);
export type ChildReason = z.infer<typeof childReasonSchema>;

/**
 * The child's payload as a discriminated union, so a syntactically valid but
 * semantically inconsistent report (a `pass` carrying findings, a `fail` with
 * none, a `cannot-review` without a recognized reason) fails the parse and is
 * handled as one class — `malformed-output` — instead of being half-honored.
 */
export const uiReviewReportSchema = z.discriminatedUnion('verdict', [
  // `.strict()` on every member: without it an unknown key is stripped, so a
  // contradictory `{verdict: "pass", reason: "pen-unreadable"}` would parse as a
  // clean pass — the exact false-trust the union exists to prevent.
  z.object({ verdict: z.literal('pass'), findings: z.tuple([]).default([]) }).strict(),
  z.object({ verdict: z.literal('fail'), findings: z.array(uiFindingSchema).min(1) }).strict(),
  z
    .object({
      verdict: z.literal('cannot-review'),
      findings: z.tuple([]).default([]),
      reason: childReasonSchema,
    })
    .strict(),
]);
export type UiReviewReport = z.infer<typeof uiReviewReportSchema>;

export interface UiDispatchInput {
  /** Scratch COPY of the design — never the repo's own file (pencil `execute` writes). */
  penPath: string;
  /** Surfaces in scope, or empty to mean "every `FINAL:` page in the file". */
  surfaces: string[];
  /** Whole-feature range; the child reads the diff itself. */
  baseSha: string;
  headSha: string;
  repoRoot: string;
  fdSummary: string;
  /** Wall-clock cap; {@link DEFAULT_DISPATCH_TIMEOUT_MS} when the caller omits it. */
  timeoutMs?: number;
}

const NORMATIVE = [
  "the `FINAL:` page's element hierarchy and the order of its named children",
  'the inventory of named components/elements — present in the design and absent from the rendered UI, or vice-versa',
  'literal text of labels, headings, button copy, and empty/error/loading messages, compared after trimming whitespace',
  'each in-scope `FINAL:` page as one authored state, under its own page name',
];

const NOT_NORMATIVE = [
  'pixel geometry, spacing values, color values, font choices, animation, and which elements are interactive — the design has no marking convention for these, so they are never findings',
  'a state or breakpoint the design never authored — its absence is not evidence about the code',
  'implementation-only symbols: helpers, providers, and components the changed files export but do not render on an in-scope surface',
  'copy that reaches the UI through localization or interpolation rather than as a literal',
];

export function buildUiReviewPrompt(input: UiDispatchInput): string {
  const scope =
    input.surfaces.length > 0
      ? `Surfaces in scope: ${input.surfaces.join(', ')}. Read the \`FINAL:<surface>: …\` pages for those surfaces only.`
      : 'No surface set was resolved for this round — read every `FINAL:` page in the file.';
  return `You are a UI-Design Reviewer. Judge whether the implementation in range ${input.baseSha}..${input.headSha} matches the design it was built from.

The design is a Pencil \`.pen\` file at \`${input.penPath}\`. Review it through pencil MCP, because you are judging the rendered pages: call \`get_app_state\` (with \`include_schema\` and \`include_canvas_design\`) for the schema, then \`execute({ filePath: "${input.penPath}" })\` with a snippet that reads the pages. Do not read it with a file-reading tool — its raw JSON is not what renders. ${scope}

${penBridgeRecipe(input.penPath)}

That path is a scratch COPY. Do not edit it, and do not open or edit anything under the repository's own design directories.

The code is at \`${input.repoRoot}\` — read the diff yourself with git over the range above.

Feature context:
${input.fdSummary}

NORMATIVE — a contradiction here is a finding:
${NORMATIVE.map((n) => `- ${n}`).join('\n')}

NOT NORMATIVE — never a finding:
${NOT_NORMATIVE.map((n) => `- ${n}`).join('\n')}

Every finding must name both sides it compared: the design page and the element or label (\`designPage\`, \`designElement\`), plus the code file. A finding you cannot ground on both sides is not actionable — drop it. Judge conformance to what the design pins, never whether the design itself is good.

If you cannot read the design at all — after the bridge-wake step above, not before it — report \`cannot-review\` with reason \`pen-unreadable\`. If you can read the file but it holds no \`FINAL:\` page for the scope above, report \`cannot-review\` with reason \`no-final-pages\`. Both are honest outcomes — never guess a verdict from the code alone.

Report in exactly one of three shapes, with NO other keys:
- pass: \`verdict\` "pass" and an empty \`findings\` array.
- fail: \`verdict\` "fail" and a non-empty \`findings\` array, each entry carrying \`file\`, \`severity\` ("high" | "med" | "low"), \`message\`, \`designPage\`, \`designElement\`, and optionally \`line\`.
- cannot-review: \`verdict\` "cannot-review", an empty \`findings\` array, and \`reason\` ("pen-unreadable" | "no-final-pages").

Emit no key beyond the ones your shape lists — not \`reason\` on a pass, not a \`summary\` or \`notes\` field. The shapes are validated strictly, so one extra key makes the whole report unreadable.`;
}

/** The example the answer instruction shows the child — valid JSON, so an echo still parses. */
export const UI_REVIEW_SHAPE =
  '{"verdict": "fail", "findings": [{"file": "src/ui/Panel.tsx", "line": 42, "severity": "high", "message": "...", "designPage": "FINAL:app: default", "designElement": "Submit"}]}';

/**
 * The repair round's prompt: restate the reviewer's report as a valid answer. It opens no
 * design, reads no code, and never upgrades a hedged report into `pass`.
 */
export function buildUiReviewRepairPrompt(ctx: RepairContext): string {
  return `A previous UI-Design Reviewer finished its review, but its answer was rejected: ${ctx.error}. Your ONLY job is to restate that reviewer's conclusion as a valid answer — do not open the design, do not read the code, do not review anything yourself.

${repairEvidence(ctx)}

Transcription rules:
1. Use exactly one of the three shapes: pass with an empty findings array; fail with at least one finding naming its file, severity, message, designPage and designElement; or cannot-review with reason pen-unreadable or no-final-pages.
2. Never upgrade a partial or hedged report into pass, and invent no finding the output does not state.
3. If nothing above clearly states a verdict, write no answer at all.`;
}

/** What the ui-reviewer child hands back, and how the seam reads it. */
export const UI_REVIEW_ANSWER: LaneAnswerContract<UiReviewReport> = {
  lane: 'ui-reviewer',
  shape: UI_REVIEW_SHAPE,
  schema: uiReviewReportSchema,
  placeholderFields: [{ list: 'findings', text: 'message' }],
  repairPrompt: buildUiReviewRepairPrompt,
};

/** Carries which reason code the lane should record, so the sink stays specific. */
export class UiDispatchError extends Error {
  readonly reason: 'timeout' | 'dispatch-failed';

  constructor(reason: 'timeout' | 'dispatch-failed', message: string) {
    super(message);
    this.name = 'UiDispatchError';
    this.reason = reason;
  }
}

const seam = createAnswerSeam<UiDispatchInput, UiReviewReport>(buildUiReviewPrompt, {
  site: 'cr.ui-review-dispatch',
  contract: UI_REVIEW_ANSWER,
  onFailure: (f) => {
    throw new UiDispatchError(
      f.reason,
      f.timedOut
        ? 'ui-review dispatch timed out'
        : `ui-review dispatch failed: ${f.detail ?? `exit ${f.exitCode}`}`,
    );
  },
});

/** Test seam — production code never calls this. */
export const setUiDispatcher = seam.setDispatcher;
export const dispatchUiReview = seam.dispatch;
