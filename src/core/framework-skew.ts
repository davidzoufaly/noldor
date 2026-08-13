// Anchor-vs-installed framework version reasoning, shared by `noldor doctor`
// (advisory warning) and `noldor upgrade` (whether to rewrite the anchor).
// Both need the same three-way answer — in sync, anchor behind, anchor ahead —
// and a string `!==` cannot tell the last two apart, which is what stranded
// `doctor` pointing an ahead anchor at an `upgrade` that correctly refuses to
// rewrite it backwards.
import semver from 'semver';

/**
 * An anchor lags when it is absent, unparseable, or semver-lower than the
 * installed version. Absent/unparseable counts as lagging because replacing it
 * is the only way out of that state.
 */
export function isAnchorLagging(anchored: string | null, installed: string): boolean {
  return anchored === null || semver.valid(anchored) === null || semver.lt(anchored, installed);
}

/**
 * The advisory skew detail `doctor` prints, or `null` when the anchor matches
 * the installed version. An anchor *ahead* of installed gets its own message:
 * `upgrade` cannot help there (it never rewrites an anchor backwards), so the
 * remedy is on the install side.
 */
export function frameworkSkewDetail(anchored: string | null, installed: string): string | null {
  if (anchored === installed) return null;
  if (isAnchorLagging(anchored, installed)) {
    return `anchored ${anchored ?? '(unset)'} ≠ installed ${installed} — run 'noldor upgrade'`;
  }
  return `anchored ${anchored} is ahead of installed ${installed} — the install is behind, not the anchor`;
}
