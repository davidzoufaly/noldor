// @tests: ui-design-review-lane
// Prompt + child contract for the `ui-reviewer` lane. The child opens the design
// itself through pencil MCP — `.pen` files are encrypted, so Node can resolve a
// path but never read content (see src/design/ui-sync-cli.ts). Parse half only;
// sink policy lives in ui-review.ts, mirroring the reviewer/verifier split.

import { z } from 'zod';

import { parseFencedJson } from '../extract-json.js';
import { createDispatcherSeam } from '../lane-spawn.js';
import { fencedJsonInstruction } from './prompt-parts.js';

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

The design is a Pencil \`.pen\` file at \`${input.penPath}\`. It is encrypted — the ONLY way to read it is pencil MCP: call \`get_app_state\` (with \`include_schema\` and \`include_canvas_design\`) for the schema, then \`execute({ filePath: "${input.penPath}" })\` with a snippet that reads the pages. Never open it with a file-reading tool. ${scope}

That path is a scratch COPY. Do not edit it, and do not open or edit anything under the repository's own design directories.

The code is at \`${input.repoRoot}\` — read the diff yourself with git over the range above.

Feature context:
${input.fdSummary}

NORMATIVE — a contradiction here is a finding:
${NORMATIVE.map((n) => `- ${n}`).join('\n')}

NOT NORMATIVE — never a finding:
${NOT_NORMATIVE.map((n) => `- ${n}`).join('\n')}

Every finding must name both sides it compared: the design page and the element or label (\`designPage\`, \`designElement\`), plus the code file. A finding you cannot ground on both sides is not actionable — drop it. Judge conformance to what the design pins, never whether the design itself is good.

If you cannot read the design at all, report \`cannot-review\` with reason \`pen-unreadable\`. If you can read the file but it holds no \`FINAL:\` page for the scope above, report \`cannot-review\` with reason \`no-final-pages\`. Both are honest outcomes — never guess a verdict from the code alone.

${fencedJsonInstruction(
  `// exactly one of these three shapes, with NO other keys:
{"verdict": "pass", "findings": []}
{"verdict": "fail", "findings": [{"file": "...", "line": 1, "severity": "high" | "med" | "low",
                                  "message": "...", "designPage": "...", "designElement": "..."}]}
{"verdict": "cannot-review", "findings": [], "reason": "pen-unreadable" | "no-final-pages"}`,
)}

Emit no key beyond the ones its shape lists — not \`reason\` on a \`pass\`, not a \`summary\` or \`notes\` field. The shapes are validated strictly, so one extra key makes the whole report unreadable.`;
}

/**
 * Last fenced ```json block wins; null on absence, bad JSON, or schema mismatch.
 * All three are one class for the caller (`malformed-output`) — the distinction
 * changes nothing it can do.
 */
export const parseUiReviewReport = (md: string): UiReviewReport | null =>
  parseFencedJson(md, uiReviewReportSchema);

/** Carries which reason code the lane should record, so the sink stays specific. */
export class UiDispatchError extends Error {
  constructor(
    readonly reason: 'timeout' | 'dispatch-failed',
    message: string,
  ) {
    super(message);
    this.name = 'UiDispatchError';
  }
}

const seam = createDispatcherSeam<UiDispatchInput>(buildUiReviewPrompt, {
  role: 'ui-reviewer',
  site: 'cr.ui-review-dispatch',
  onFailure: (f) => {
    throw new UiDispatchError(
      f.reason,
      f.timedOut ? 'ui-review dispatch timed out' : `ui-review dispatch failed: exit ${f.exitCode}`,
    );
  },
});

/** Test seam — production code never calls this. */
export const setUiDispatcher = seam.setDispatcher;
export const dispatchUiReview = seam.dispatch;
