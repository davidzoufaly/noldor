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
 * Directory holding feature UI-design `.pen` files (dated, per dialogue key) —
 * the parent of {@link UI_BASELINE_DIR} and of its own `archive/`. The
 * design-approval guard and `design verdict` both scope "feature `.pen`" to
 * this prefix, so it lives beside the other naming constants rather than being
 * re-spelled at each site.
 */
export const UI_DESIGN_DIR = 'docs/design/ui';

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

/**
 * Derive the authored date from a spec filename.
 *
 * Reuses {@link SPEC_FILE_RE} to confirm the shape, then returns the leading
 * ten characters — the regex matches the date prefix but captures only the
 * slug, and adding a second capture group would change every existing caller's
 * match indices.
 *
 * Exists because the date is the only floor a stub detector can trust: the
 * spec body's `**Date:**` line is author-typed and no validator enforces it,
 * whereas the filename shape is checked wherever a spec is resolved.
 *
 * @param filename - The basename, e.g. `2026-08-28-foo-design.md`
 * @returns `YYYY-MM-DD`, or `null` when the filename is not a spec name. A
 *   regex-shaped but impossible calendar date (`2026-02-31`) is returned as
 *   written — callers comparing it lexically against a floor do not care, and
 *   rejecting it here would silently exempt the artifact instead.
 */
export function specDateFromFilename(filename: string): string | null {
  return SPEC_FILE_RE.test(filename) ? filename.slice(0, 10) : null;
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
