/**
 * Size → gate-path routing policy.
 *
 * Encodes the rule that prep effort should scale with entry size: small
 * entries are mechanical and ship without a design spec, while medium-and-up
 * entries warrant one. This is the single source of truth for the size→path
 * mapping that `/noldor-gate` Step 0 prose used to compute inline; {@link getSuggestions}
 * stamps each surfaced roadmap entry with its {@link sizeToPath} result so the
 * gate reads a value instead of re-deriving it.
 *
 * Policy:
 * - **XS / S** → no FD, no spec. Route to `fast-track` (code) — or `micro-chore`
 *   when the entry's `Touches:` clause keeps the whole diff on that lane (see
 *   {@link entryToPath}). Without a clause the size alone can't tell docs from
 *   code, so the downgrade stays the operator's call.
 * - **M** → `specs-only` (spec, no plan).
 * - **L / XL** → `full` (spec + plan).
 *
 * Missing or unrecognized sizes default to the spec-bearing `specs-only` tier:
 * the policy never *silently* drops review for an entry whose size it can't read.
 */

import { isMicroChoreAllowed } from './allowlist.js';

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
 * `fast-track` is the default no-FD path. This helper never returns
 * `micro-chore` because size alone can't tell docs from code; {@link entryToPath}
 * can, from the paths the entry declares.
 */
export function sizeToPath(size: string | undefined, hasParent: boolean): GatePath {
  if (sizeSkipsSpec(size)) return 'fast-track';
  if (sizeToTier(size) === 'full') return hasParent ? 'full-attach' : 'full-new';
  return hasParent ? 'specs-only-attach' : 'specs-only-new';
}

/**
 * Suggested gate path for an entry, from its size and the paths its `Touches:`
 * clause declares: {@link sizeToPath}, except that an XS/S entry whose every
 * declared path is on the micro-chore lane ({@link isMicroChoreAllowed}) routes
 * to `micro-chore`.
 *
 * That lane is where a skill edit has to go. `checks shared-files` refuses
 * `.claude/skills/**` from a `.worktrees/` checkout, so a fast-track session
 * builds its worktree, retires the roadmap block, and only then has the real
 * commit refused. A pure-doc entry lands on the same lane because the policy
 * already sends pure docs there.
 *
 * An empty `touches` routes by size: an entry that declares nothing gives the
 * router no evidence, and guessing paths from the prose would misroute every
 * entry that merely mentions a skill. Spec-bearing sizes keep their path
 * whatever they touch: a lane rule may not drop an M entry's spec review.
 */
export function entryToPath(
  size: string | undefined,
  hasParent: boolean,
  touches: string[],
): GatePath {
  const bySize = sizeToPath(size, hasParent);
  return bySize === 'fast-track' && isMicroChoreAllowed(touches) ? 'micro-chore' : bySize;
}

/**
 * Wall-clock budget multipliers per size, applied to the drain's base
 * `--iteration-timeout`. Bigger entries take longer for the same reason they
 * route to a heavier gate path: more code, more CR rounds.
 */
const SIZE_TIMEOUT_MULTIPLIER: ReadonlyMap<string, number> = new Map([
  ['XS', 1],
  ['S', 2],
  ['M', 3],
  ['L', 4],
  ['XL', 4],
]);

/** Multiplier used when the size is missing or unrecognized — see {@link sizeToTimeoutMs}. */
const UNSIZED_TIMEOUT_MULTIPLIER = 4;

/**
 * Per-entry wall-clock budget for a drain iteration, derived from the same
 * `size:` field {@link sizeToPath} reads. `baseMs` is the XS budget (the drain's
 * `--iteration-timeout` default, 30 min); every other size scales up from it.
 *
 * The failure this closes: a batch of S entries on a flat XS-sized cap is killed
 * mid-CR and burns one retry each. Under-budgeting is the expensive direction —
 * a killed child leaves a branch of finished-but-undelivered work — while
 * over-budgeting only delays the kill of a genuinely hung child, which the
 * spawn caps still bound.
 *
 * A missing or unrecognized size therefore gets the LARGEST multiplier, not the
 * base: the sources that omit the axis (`plansSource`) drain spec-bearing M/L/XL
 * FDs, so treating "unsized" as "smallest" would systematically under-budget the
 * longest work. Note this is the opposite lean from {@link sizeToTier}, where the
 * conservative direction is more review; here it is more time.
 *
 * The result is rounded to a whole millisecond so it can be handed to a timer.
 */
export function sizeToTimeoutMs(size: string | undefined, baseMs: number): number {
  const multiplier =
    SIZE_TIMEOUT_MULTIPLIER.get((size ?? '').toUpperCase()) ?? UNSIZED_TIMEOUT_MULTIPLIER;
  return Math.round(baseMs * multiplier);
}
