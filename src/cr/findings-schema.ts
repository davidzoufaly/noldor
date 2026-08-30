import { z } from 'zod';

import { artifactKindSchema, laneSchema } from '../core/lanes.js';
import { FINDING_CLASSES } from './finding-class.js';

export { artifactKindSchema, laneSchema };
export type { ArtifactKind, Lane } from '../core/lanes.js';

export const severitySchema = z.enum(['high', 'med', 'low']);
export type Severity = z.infer<typeof severitySchema>;

export const findingClassSchema = z.enum(FINDING_CLASSES);

export const findingSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().nonnegative().optional(),
  severity: severitySchema,
  message: z.string().min(1),
  suggestion: z.string().optional(),
  // Reviewer-assigned blocker classification, consumed by `cr autofix`. Optional
  // so every sink written before it existed still parses, and so the lanes that
  // do not classify (codex, manual, verifier) need no migration — an absent
  // `class` reads as `design` at the decision site, never as auto-fixable.
  class: findingClassSchema.optional(),
});
export type Finding = z.infer<typeof findingSchema>;

export const verifyVerdictValueSchema = z.enum(['pass', 'fail', 'cannot-verify']);
export type VerifyVerdictValue = z.infer<typeof verifyVerdictValueSchema>;

/**
 * The `ui-reviewer` lane's verdict vocabulary — deliberately its OWN enum rather
 * than members added to {@link verifyVerdictValueSchema}: that schema is the
 * verifier child's INPUT contract (`lanes/verify-dispatch.ts` imports it), so a
 * shared enum would let a verifier child emit `cannot-review` and fall through
 * `verify.ts`'s `verdict === 'fail'` branch as a FAIL.
 *
 * `not-applicable` = there was nothing to review (no UI in range, waived,
 * unadopted). `cannot-review` = there was, and the comparison could not be
 * performed — the honest outcome that must never read as a pass.
 */
export const uiReviewVerdictValueSchema = z.enum([
  'pass',
  'fail',
  'cannot-review',
  'not-applicable',
]);
export type UiReviewVerdictValue = z.infer<typeof uiReviewVerdictValueSchema>;

/**
 * Closed reason vocabulary for a sink that did not perform (or could not trust)
 * its review. An enum rather than free text because the Usage contract tells
 * operators to branch on it; `notes` carries the human sentence beside it.
 */
export const laneReasonCodeSchema = z.enum([
  // not-applicable classes
  'no-ui-paths',
  'design-skip',
  'no-consumer-config',
  'waived',
  // cannot-review classes
  'no-session-key',
  'no-design-artifact',
  'no-feature-pen',
  // Distinct from `no-feature-pen`: the design exists, but holds no `FINAL:` page
  // for the surfaces in scope. Different remediation — author the page vs author
  // the design — so an operator branching on `reason` must be able to tell them apart.
  'no-final-pages',
  'ambiguous-design',
  // Design-approval record states (Q-0196). Distinct because their remedies
  // differ: take a verdict at all, versus re-take it on the design as it stands.
  'design-unapproved',
  'design-approval-stale',
  // Consumer config exists but does not parse. Distinct from `no-consumer-config`
  // (feature unadopted): a broken config is a repo problem, not an opt-out.
  'config-unreadable',
  'surfaces-unmapped',
  'pen-unreadable',
  'scratch-unavailable',
  'dispatch-failed',
  'timeout',
  'malformed-output',
  'range-unresolvable',
  'fd-unreadable',
  'design-dir-unreadable',
  // cannot-review classes owned by the render-compare lane (spec R7). Each is a
  // distinct pipeline stage so an operator can tell "configure a recipe" from
  // "your app did not boot" from "the capture tool broke".
  'no-boot-recipe',
  'page-ambiguous',
  'boot-failed',
  'route-unreachable',
  'screenshot-failed',
  'export-failed',
  'dimension-mismatch',
  // The round computed its verdicts but could not persist the evidence images
  // that make them auditable — its own class, not a dispatch problem.
  'persist-failed',
  // integrity
  'pen-modified',
]);
export type LaneReasonCode = z.infer<typeof laneReasonCodeSchema>;

export const verifyEvidenceSchema = z.object({
  command: z.string().min(1),
  observed: z.string(),
});
export type VerifyEvidence = z.infer<typeof verifyEvidenceSchema>;

export const laneFindingsSchema = z.object({
  lane: laneSchema,
  artifact: z.string().min(1),
  kind: artifactKindSchema,
  slug: z.string().min(1),
  blockers: z.array(findingSchema).default([]),
  suggestions: z.array(findingSchema).default([]),
  summary: z.string().min(1),
  notes: z.array(z.string()).optional(),
  baseSha: z.string().optional(),
  fullReview: z.boolean().optional(),
  // Lane verdict payload (absent on the lanes that carry none). A union of the two
  // vocabularies, so a sink reader accepts either while each lane's own dispatch
  // parser still accepts only its own — and every pre-union sink still parses.
  verdict: z.union([verifyVerdictValueSchema, uiReviewVerdictValueSchema]).optional(),
  // Machine-readable companion to `verdict` for rounds that did not perform a
  // review. Optional: the lanes that always review emit no reason.
  reason: laneReasonCodeSchema.optional(),
  evidence: z.array(verifyEvidenceSchema).optional(),
  mismatches: z.array(z.string()).optional(),
  templateSha: z.string().optional(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
});
export type LaneFindings = z.infer<typeof laneFindingsSchema>;
