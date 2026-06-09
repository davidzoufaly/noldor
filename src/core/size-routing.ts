/**
 * Size → gate-path routing policy.
 *
 * Encodes the rule that prep effort should scale with entry size: small
 * entries are mechanical and ship without a design spec, while medium-and-up
 * entries warrant one. This is the single source of truth for the size→path
 * mapping that `/gate` Step 0 prose used to compute inline; {@link getSuggestions}
 * stamps each surfaced roadmap entry with its {@link sizeToPath} result so the
 * gate reads a value instead of re-deriving it.
 *
 * Policy:
 * - **XS / S** → no FD, no spec. Route to `fast-track` (code) — or `micro-chore`
 *   when the diff is pure-doc (an operator judgment the size alone can't make).
 * - **M** → `specs-only` (spec, no plan).
 * - **L / XL** → `full` (spec + plan).
 *
 * Missing or unrecognized sizes default to the spec-bearing `specs-only` tier:
 * the policy never *silently* drops review for an entry whose size it can't read.
 */

export type GateTier = 'specs-only' | 'full';

export type GatePath =
  | 'micro-chore'
  | 'fast-track'
  | 'specs-only-new'
  | 'specs-only-attach'
  | 'full-new'
  | 'full-attach';

const NO_SPEC_SIZES: ReadonlySet<string> = new Set(['XS', 'S']);
const FULL_SIZES: ReadonlySet<string> = new Set(['L', 'XL']);

/**
 * True when an entry of this size skips the spec stage entirely — it carries no
 * FD and routes to `fast-track` / `micro-chore`. False for M/L/XL and for any
 * missing/unknown size (those keep a spec).
 */
export function sizeSkipsSpec(size: string | undefined): boolean {
  return NO_SPEC_SIZES.has(size ?? '');
}

/**
 * Tier for spec-bearing sizes: `full` (spec + plan) for L/XL, `specs-only`
 * (spec, no plan) for M. Only meaningful when {@link sizeSkipsSpec} is false —
 * XS/S carry no FD and so have no tier; calling this on them returns the
 * `specs-only` default but the result is never used for routing (see
 * {@link sizeToPath}, which short-circuits on the no-spec sizes first).
 */
export function sizeToTier(size: string | undefined): GateTier {
  return FULL_SIZES.has(size ?? '') ? 'full' : 'specs-only';
}

/**
 * Suggested gate path for a roadmap/backlog entry, per the size→path policy.
 * XS/S → `fast-track` (parent ignored — no-FD paths have no parent). Otherwise
 * the tier from {@link sizeToTier} picks `specs-only-*` / `full-*`, and
 * `hasParent` selects the `-attach` vs `-new` variant.
 *
 * `fast-track` is the default no-FD path; the operator downgrades to
 * `micro-chore` at gate time when the diff is pure-doc. This helper never
 * returns `micro-chore` because size alone can't tell docs from code.
 */
export function sizeToPath(size: string | undefined, hasParent: boolean): GatePath {
  if (sizeSkipsSpec(size)) return 'fast-track';
  if (sizeToTier(size) === 'full') return hasParent ? 'full-attach' : 'full-new';
  return hasParent ? 'specs-only-attach' : 'specs-only-new';
}
