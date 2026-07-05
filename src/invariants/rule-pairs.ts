/**
 * Seed list of rule-pair invariants for the /garden contradiction detector.
 *
 * Each invariant declares a canonical phrasing (`patternA`/`patternB`) that
 * must appear in BOTH documents if either is present. If exactly one side
 * matches, the detector flags the pair as a candidate contradiction.
 *
 * Operators add new invariants here as drift incidents recur.
 */

import type { InvariantSeverity } from './types.js';

/**
 * One rule-pair invariant. Both docs must agree on the canonical phrasing.
 *
 * @remarks
 * Detector semantics:
 * - both patterns match → consistent (not flagged)
 * - exactly one matches → flagged (action: manual-edit)
 * - neither matches → silent (rule absent in both, out of scope)
 *
 * `severity` governs the graceful-degradation path when exactly one side
 * matches. Pairs that reference a consumer-owned doc (e.g. `README.md`) can
 * legitimately be asymmetric in a fresh consumer repo — the noldor-scaffolded
 * side carries the phrasing, the domain doc has no such section. Marking such a
 * pair `warn` surfaces the drift without hard-failing the commit. Absent →
 * `error` (blocking), preserving the strict gate for noldor-owned doc pairs.
 */
export interface RulePairInvariant {
  readonly name: string;
  readonly docA: string;
  readonly docB: string;
  readonly patternA: RegExp;
  readonly patternB: RegExp;
  readonly message: string;
  readonly severity?: InvariantSeverity;
}

/**
 * Seed list, v1. Order is not significant.
 */
export const INVARIANTS: readonly RulePairInvariant[] = [
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
    // docB is the consumer-owned README; a fresh consumer whose domain README
    // has no test section is a legitimate asymmetry, not drift. Soft-warn so
    // the bootstrap commit is not hard-failed (friction #11 / Q-0017).
    severity: 'warn',
  },
] as const;
