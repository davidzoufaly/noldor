/**
 * Seed list of rule-pair invariants for the /garden contradiction detector.
 *
 * Each invariant declares a canonical phrasing (`patternA`/`patternB`) that
 * must appear in BOTH documents if either is present. If exactly one side
 * matches, the detector flags the pair as a candidate contradiction.
 *
 * Operators add new invariants here as drift incidents recur.
 */

/**
 * One rule-pair invariant. Both docs must agree on the canonical phrasing.
 *
 * @remarks
 * Detector semantics:
 * - both patterns match → consistent (not flagged)
 * - exactly one matches → flagged (action: manual-edit)
 * - neither matches → silent (rule absent in both, out of scope)
 */
export interface Invariant {
  readonly name: string;
  readonly docA: string;
  readonly docB: string;
  readonly patternA: RegExp;
  readonly patternB: RegExp;
  readonly message: string;
}

/**
 * Seed list, v1. Order is not significant.
 */
export const INVARIANTS: readonly Invariant[] = [
  {
    docA: 'docs/noldor/workflow.md',
    docB: 'docs/noldor/versioning.md',
    message:
      'docs/noldor/workflow.md and docs/noldor/versioning.md must agree that `pnpm release` owns the `introduced`/`updated` fields.',
    name: 'introduced/updated field ownership',
    patternA: /owns.+(introduced|updated)|(introduced|updated).+owns/i,
    patternB: /owns.+(introduced|updated)|(introduced|updated).+owns/i,
  },
  {
    docA: 'docs/noldor/workflow.md',
    docB: 'docs/noldor/feature-md-schema.md',
    message:
      'docs/noldor/workflow.md and docs/noldor/feature-md-schema.md must agree on the canonical feature MD path pattern `docs/features/<slug>.md`.',
    name: 'feature MD schema location',
    patternA: /docs\/features\/<slug>\.md/,
    patternB: /docs\/features\/<slug>\.md/,
  },
  {
    docA: 'docs/noldor/git-and-commits.md',
    docB: 'README.md',
    message:
      'docs/noldor/git-and-commits.md and README.md must both reference `pnpm test` as the canonical test command.',
    name: 'bootstrap commands',
    patternA: /pnpm test\b/,
    patternB: /pnpm test\b/,
  },
] as const;
