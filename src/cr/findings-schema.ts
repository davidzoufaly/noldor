import { z } from 'zod';

export const severitySchema = z.enum(['high', 'med', 'low']);
export type Severity = z.infer<typeof severitySchema>;

export const findingSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().nonnegative().optional(),
  severity: severitySchema,
  message: z.string().min(1),
  suggestion: z.string().optional(),
});
export type Finding = z.infer<typeof findingSchema>;

export const laneSchema = z.enum(['manual', 'codex', 'subagent', 'standalone', 'verify']);
export type Lane = z.infer<typeof laneSchema>;

export const verifyVerdictValueSchema = z.enum(['pass', 'fail', 'cannot-verify']);
export type VerifyVerdictValue = z.infer<typeof verifyVerdictValueSchema>;

export const verifyEvidenceSchema = z.object({
  command: z.string().min(1),
  observed: z.string(),
});
export type VerifyEvidence = z.infer<typeof verifyEvidenceSchema>;

export const artifactKindSchema = z.enum(['spec', 'plan', 'code']);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

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
  // verify-lane verdict payload (absent on every other lane)
  verdict: verifyVerdictValueSchema.optional(),
  evidence: z.array(verifyEvidenceSchema).optional(),
  mismatches: z.array(z.string()).optional(),
  templateSha: z.string().optional(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
});
export type LaneFindings = z.infer<typeof laneFindingsSchema>;
