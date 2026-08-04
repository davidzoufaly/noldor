// @tests: doc-gardening-skill
// Filename→slug parsers for dated design artifacts (`docs/design/{specs,plans}/`).
// Lives in core because both `src/garden` (staleness detectors) and `src/design`
// (flip-time archival) need them, and core is the only module every domain may
// import (`core-is-foundation` boundary rule).

const PLAN_FILE_RE = /^\d{4}-\d{2}-\d{2}-(.+?)(?:-part\d+)?\.md$/;
const SPEC_FILE_RE = /^\d{4}-\d{2}-\d{2}-(.+?)-design\.md$/;

/**
 * Derive the feature slug from a plan filename.
 *
 * @param filename - The basename, e.g. `2026-04-19-tooltips.md` or
 *   `2026-04-23-feature-md-framework-part1.md`.
 * @returns The slug (`tooltips`, `feature-md-framework`) or `null` if
 *   the filename does not match the plan naming convention.
 */
export function planSlugFromFilename(filename: string): string | null {
  const match = PLAN_FILE_RE.exec(filename);
  return match?.[1] ?? null;
}

/**
 * Derive the feature slug from a spec filename.
 *
 * @param filename - The basename, e.g. `2026-04-23-feature-md-framework-design.md`.
 * @returns The slug (`feature-md-framework`) or `null` if the filename does
 *   not match the spec naming convention.
 */
export function specSlugFromFilename(filename: string): string | null {
  const match = SPEC_FILE_RE.exec(filename);
  return match?.[1] ?? null;
}
