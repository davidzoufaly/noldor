// @tests: doc-gardening-skill
// Filename→slug parsers for dated design artifacts (`docs/design/{specs,plans}/`).
// Lives in core because both `src/garden` (staleness detectors) and `src/design`
// (flip-time archival) need them, and core is the only module every domain may
// import (`core-is-foundation` boundary rule).

const PLAN_FILE_RE = /^\d{4}-\d{2}-\d{2}-(.+?)(?:-part\d+)?\.md$/;
const SPEC_FILE_RE = /^\d{4}-\d{2}-\d{2}-(.+?)-design\.md$/;

/**
 * Sibling directory a shipped design artifact is filed into.
 *
 * Single source of truth: `noldor design archive` moves artifacts here,
 * `sync-fd-resources` repoints `links.spec` / `links.plan` here, and the
 * commit-msg trailer gate accepts a spec found here. All three must agree —
 * a divergence would desync archival from the gate that validates it.
 */
export const ARCHIVE_DIR = 'archive';

/**
 * Directory holding the per-surface UI baseline `.pen` files.
 *
 * Single source of truth: the freshness check reads `<dir>/<surface>.pen`,
 * `design ui-sync` stages the same path, `design pen-bridge` ranks it, and the
 * pre-commit `.pen` write-guard refuses edits under it from a feature worktree.
 * Lives in core so the pre-commit path can reach it without loading the
 * freshness engine (and its `minimatch` dependency).
 */
export const UI_BASELINE_DIR = 'docs/design/ui/baseline';

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

const PEN_FILE_RE = /^\d{4}-\d{2}-\d{2}-(.+?)\.pen$/;

/**
 * Derive the dialogue key from a feature UI-design filename
 * (`2026-08-19-<key>.pen`). Baseline files (`baseline/<surface>.pen`) are
 * undated and deliberately do not match — they are never archived.
 *
 * @param filename - The basename, e.g. `2026-08-19-my-feature.pen`.
 * @returns The dialogue key (`my-feature`) or `null` when the filename does
 *   not match the feature-pen naming convention.
 */
export function penSlugFromFilename(filename: string): string | null {
  const match = PEN_FILE_RE.exec(filename);
  return match?.[1] ?? null;
}

/** Canonical feature UI-design filename for a dialogue key. */
export function penFileName(date: string, key: string): string {
  return `${date}-${key}.pen`;
}
