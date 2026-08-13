// Anchor-vs-installed framework version reasoning. The three-way answer — in
// sync, anchor behind, anchor ahead — is what a string `!==` cannot express, and
// that is what stranded `doctor` pointing an ahead anchor at an `upgrade` that
// correctly refuses to rewrite it backwards. `isAnchorLagging` is shared with
// `noldor upgrade` (whether to rewrite the anchor); `frameworkSkewDetail` words
// the `doctor` warning on top of it.
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
 * The advisory skew detail `doctor` prints, or `null` when the anchor is in sync
 * with the installed version. An anchor *ahead* of installed gets its own
 * message: `upgrade` cannot help there (it never rewrites an anchor backwards),
 * so the remedy is on the install side.
 *
 * In-sync is a semver compare, not a string compare: a textually-different but
 * semver-equal anchor (`v1.2.0`, `1.2.0+build`) is neither lagging nor ahead, so
 * a string `===` would drop it into the ahead branch and state the opposite of
 * the truth. The raw-string check stays as the fallback for an
 * unparseable-but-identical pair, which `semver.eq` would throw on.
 */
export function frameworkSkewDetail(anchored: string | null, installed: string): string | null {
  if (anchored === installed) return null;
  if (anchored !== null && semver.valid(anchored) !== null && semver.eq(anchored, installed)) {
    return null;
  }
  if (isAnchorLagging(anchored, installed)) {
    return `anchored ${anchored ?? '(unset)'} ≠ installed ${installed} — run 'noldor upgrade'`;
  }
  return `anchored ${anchored} is ahead of installed ${installed} — the install is behind, not the anchor`;
}
