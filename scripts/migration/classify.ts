/**
 * Pure classification logic for the framework/product doc split.
 * No I/O. Unit-testable. Consumed by `classify-feature-track.ts` (entrypoint).
 *
 * Spec: docs/superpowers/specs/2026-05-28-framework-doc-extraction-design.md
 */

export type Track = 'framework' | 'product' | 'ambiguous';

/**
 * Regex from spec § Categorisation heuristic. Slug-prefix matcher.
 *
 * Excluded prefixes (YAGNI): `auto-`, `garden-`, `specs-` — no current matches.
 * Add them back via one-line edit when first match lands.
 */
export const FRAMEWORK_PREFIX_RE = /^(dashboard|noldor|gate|release|triage|sdd|framework|doc|fd)-/;

export interface ClassifyInput {
  readonly slug: string;
  readonly name: string;
  readonly area: string;
}

/**
 * Classify a feature by area + slug/name prefix.
 *
 * Rule (spec):
 * 1. `area === 'tooling'` (AND)
 * 2. `slug` (canonical) OR `name` matches `FRAMEWORK_PREFIX_RE`.
 *
 * Tie-breaker: slug wins. Reader tries slug first; falls back to name only
 * when slug fails to match.
 *
 * @returns `framework` (both clauses pass), `product` (area guard fails),
 *          `ambiguous` (area=tooling but slug/name don't prefix-match).
 */
export function classifyFeature(input: ClassifyInput): Track {
  if (input.area !== 'tooling') return 'product';

  // Slug wins. Try canonical form first.
  if (FRAMEWORK_PREFIX_RE.test(input.slug)) return 'framework';

  // Fall back to name. Normalise to slug-form for the regex.
  const nameAsSlug = input.name.toLowerCase().replace(/\s+/g, '-');
  if (FRAMEWORK_PREFIX_RE.test(nameAsSlug)) return 'framework';

  // area=tooling but no prefix match → operator decides.
  return 'ambiguous';
}

/**
 * Roadmap and backlog entries share the same shape as features
 * (slug + name + area at schema-C top level). Same classification rule;
 * alias the function for caller clarity.
 */
export const classifyRoadmapEntry = classifyFeature;

export interface ClassifyPlanOrSpecInput {
  readonly filename: string;
  readonly featureTracks: ReadonlyMap<string, Track>;
}

/**
 * Plans + specs are named `YYYY-MM-DD-<slug>-design.md` (or just `<slug>.md`
 * for plans). The owning FD's track determines the plan/spec track.
 *
 * Matches the longest slug that appears as a substring (handles cases where
 * a short slug is a prefix of a longer one, e.g. `dashboard` ⊂ `dashboard-foo`).
 *
 * @returns inherited track, or `'ambiguous'` if no known FD slug matches.
 */
export function classifyPlanOrSpec(input: ClassifyPlanOrSpecInput): Track {
  const slugs = [...input.featureTracks.keys()].toSorted((a, b) => b.length - a.length);
  for (const slug of slugs) {
    if (input.filename.includes(slug)) {
      return input.featureTracks.get(slug) ?? 'ambiguous';
    }
  }
  return 'ambiguous';
}
