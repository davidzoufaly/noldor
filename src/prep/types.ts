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
