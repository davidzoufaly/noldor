import { z } from 'zod';

import type { GateTier } from '../core/size-routing.js';

/** A roadmap entry eligible for parallel prep (size M/L/XL, no spec yet). */
export interface PrepEntry {
  readonly slug: string;
  readonly name: string;
  readonly size: string;
  readonly tier: GateTier;
  readonly area: string;
  readonly parent?: string;
  readonly deps: readonly string[];
  readonly body: string;
}

export interface OpenQuestion {
  readonly question: string;
  readonly recommendation: string;
  readonly rationale: string;
}

/** What a drafting child writes to `<slug>.meta.json` alongside its spec/plan. */
export interface DraftMeta {
  readonly summary: string;
  readonly confidence: 'high' | 'med' | 'low';
  readonly risks: readonly string[];
  readonly openQuestions: readonly OpenQuestion[];
}

/**
 * Runtime validator for a child-written `<slug>.meta.json`. A drafting child is
 * an independent `claude --print` process — its output is untrusted, and
 * valid-JSON-but-wrong-shape meta (e.g. `summary: null`, missing `openQuestions`)
 * would otherwise reach `renderIndex` and throw on `d.summary.replace` /
 * `d.openQuestions.length`, losing the whole batch's review surface after all
 * spawn cost is spent. `prep-fanout` `safeParse`s against this and falls back to
 * a safe default on failure. Matches {@link DraftMeta} field-for-field.
 */
export const openQuestionSchema = z.object({
  question: z.string(),
  recommendation: z.string(),
  rationale: z.string(),
});

export const draftMetaSchema = z.object({
  summary: z.string(),
  confidence: z.enum(['high', 'med', 'low']),
  risks: z.array(z.string()),
  openQuestions: z.array(openQuestionSchema),
});

/** One fully-drafted feature: discovery facts + the child's meta + staging file paths. */
export interface FeatureDraft extends DraftMeta {
  readonly slug: string;
  readonly name: string;
  readonly tier: GateTier;
  readonly size: string;
  readonly area: string;
  readonly parent?: string;
  readonly deps: readonly string[];
  /** repo-root-relative staging spec path */
  readonly specFile: string;
  /** repo-root-relative staging plan path, or '' for specs-only */
  readonly planFile: string;
  /** false when the child failed / wrote no spec */
  readonly complete: boolean;
}

export interface StagingManifest {
  readonly today: string;
  readonly batchDir: string;
  readonly entries: readonly FeatureDraft[];
}
