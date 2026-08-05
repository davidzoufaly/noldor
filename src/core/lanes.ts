import { z } from 'zod';

/**
 * CR review lanes. Two are role-routed and carry their runner-role name:
 * `reviewer` (→ reviewer role, was `subagent`) and `verifier` (→ verifier role,
 * was `verify`). The other three are non-role literals: `manual` (human stdin),
 * `codex` (hard-pinned to the codex runner — role config can't re-route it), and
 * `standalone` (escalate-only iTerm deep-review, not an orchestrate lane).
 * `reviewer` is the only fully-unattended lane — see DEFAULT_CR_LANES in ./config.ts.
 * Lives in core/ because the repo-wide config loader validates `crLanes` against it.
 */
const CANONICAL_LANES = ['manual', 'codex', 'reviewer', 'standalone', 'verifier'] as const;

/** The canonical lane names as a plain array (the preprocess-wrapped `laneSchema`
 * has no `.options`, so callers that need to enumerate lane names use this). */
export const LANE_NAMES: readonly string[] = CANONICAL_LANES;

/** Legacy lane name → canonical role-ref. Consumed by the preprocess + `0.7.0` migration. */
export const LANE_ALIASES: Record<string, string> = { subagent: 'reviewer', verify: 'verifier' };

/** Canonical → legacy, for back-compat sink-filename lookup (orchestrate.ts). */
export const LEGACY_BY_CANONICAL: Record<string, string> = {
  reviewer: 'subagent',
  verifier: 'verify',
};

/**
 * Preprocess maps a legacy lane name to its canonical role-ref before enum
 * validation, so a pre-0.7.0 `crLanes` block (`subagent`/`verify`) still parses
 * — the `0.7.0` migration rewrites the on-disk values, but validation never
 * breaks in the interim.
 */
export const laneSchema = z.preprocess(
  (v) => (typeof v === 'string' && v in LANE_ALIASES ? LANE_ALIASES[v] : v),
  z.enum(CANONICAL_LANES),
);
export type Lane = z.infer<typeof laneSchema>;

/** Reviewable artifact kinds — the keys of a `crLanes` config block. */
export const artifactKindSchema = z.enum(['spec', 'plan', 'code']);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

/**
 * Artifact kinds whose review may never be skipped: `reviewer` is unioned into
 * whatever lane set an operator picks or a `crLanes.<kind>` block declares, so
 * no spec or plan can reach implementation unreviewed. `code` is deliberately
 * absent — its reviewer pass is already enforced downstream by the
 * `Noldor-Reviewed-Subagent` receipt the pre-push hook validates against
 * `HEAD^{tree}`.
 */
export const REVIEWER_MANDATORY_KINDS: readonly ArtifactKind[] = ['spec', 'plan'];

/**
 * Union `reviewer` into `lanes` when `kind` mandates it. Order-preserving and
 * idempotent — appends only when the lane is absent, so an operator's own
 * ordering (`manual` first, say) survives.
 */
export function withMandatoryReviewer(kind: ArtifactKind, lanes: readonly Lane[]): Lane[] {
  if (!REVIEWER_MANDATORY_KINDS.includes(kind) || lanes.includes('reviewer')) return [...lanes];
  return [...lanes, 'reviewer'];
}

/**
 * The `crLanes` kinds that declare a lane set without `reviewer` — the configs
 * `pnpm noldor validate noldor-config` refuses. Runtime lane resolution
 * self-heals such a block via {@link withMandatoryReviewer}; this is the loud
 * half of the pair, so the drift gets fixed in the config instead of being
 * silently corrected on every run. Kinds the block never declares are fine:
 * absence falls back to `DEFAULT_CR_LANES`, which is reviewer-only.
 */
export function missingMandatoryReviewer(
  crLanes: Partial<Record<ArtifactKind, readonly Lane[]>> | undefined,
): ArtifactKind[] {
  if (!crLanes) return [];
  return REVIEWER_MANDATORY_KINDS.filter((kind) => {
    const lanes = crLanes[kind];
    return lanes !== undefined && !lanes.includes('reviewer');
  });
}
