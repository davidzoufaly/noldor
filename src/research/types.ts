import { z } from 'zod';

/** One independent research question; `id` is the findings-file stem. */
export const taskSpecSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be a kebab-case filename stem'),
    question: z.string().min(1),
    /** Paths/globs to focus on — a hint for the agent, not a sandbox. */
    scope: z.array(z.string().min(1)).default([]),
    /** Self-contained background; children never inherit session history. */
    context: z.string().optional(),
    /** What a good answer contains. */
    expects: z.string().optional(),
  })
  .strict();
export type TaskSpec = z.infer<typeof taskSpecSchema>;

export const tasksFileSchema = z.object({ tasks: z.array(taskSpecSchema).min(1) }).strict();

/** The fenced-JSON trailer every researcher must end its final message with. */
export const researchMetaSchema = z
  .object({
    status: z.enum(['answered', 'partial', 'blocked']),
    headline: z.string().min(1),
    confidence: z.enum(['low', 'med', 'high']).default('med'),
    refs: z.array(z.string()).default([]),
  })
  .strict();
export type ResearchMeta = z.infer<typeof researchMetaSchema>;

/** Applied whenever the envelope cannot be parsed — raw output is still preserved. */
export const FALLBACK_META: ResearchMeta = {
  status: 'blocked',
  headline: 'unparsed output',
  confidence: 'low',
  refs: [],
};

/** Per-task outcome computed by the CLI (the only writer). */
export interface ResearchResult {
  readonly id: string;
  readonly question: string;
  /** Spawn succeeded (exit 0, no timeout) AND the envelope parsed. */
  readonly ok: boolean;
  /** 'ok' | 'timeout' | 'exit <n>' | 'error: <msg>' */
  readonly spawnStatus: string;
  readonly meta: ResearchMeta;
  /** Batch-dir-relative findings filename. */
  readonly findingsFile: string;
}

export interface ResearchManifest {
  readonly startedAt: string;
  readonly batchDir: string;
  readonly results: readonly ResearchResult[];
}
