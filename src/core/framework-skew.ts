// Anchor-vs-installed framework version reasoning. The three-way answer — in
// sync, anchor behind, anchor ahead — is what a string `!==` cannot express, and
// that is what stranded `doctor` pointing an ahead anchor at an `upgrade` that
// correctly refuses to rewrite it backwards. `isAnchorLagging` is shared with
// `noldor upgrade` (whether to rewrite the anchor); `frameworkSkewDetail` words
// the `doctor` warning on top of it, and `missingCommandSkewHint` words the same
// skew at the one place a drifted consumer actually meets it — a scaffolded hook
// job naming a subcommand this version no longer has.
import semver from 'semver';

/**
 * An anchor lags when it is absent, unparseable, or semver-lower than the
 * installed version. Absent/unparseable counts as lagging because replacing it
 * is the only way out of that state.
 */
export function isAnchorLagging(anchored: string | null, installed: string): boolean {
  return anchored === null || semver.valid(anchored) === null || semver.lt(anchored, installed);
}

/** The three states an anchor can be in relative to the installed package. */
export type FrameworkSkew = 'in-sync' | 'anchor-behind' | 'anchor-ahead';

/**
 * Classify the anchor against the installed version — the shared decision every
 * skew message is worded from, so a second caller cannot re-derive "in sync"
 * slightly differently from the first.
 *
 * In-sync is a semver compare, not a string compare: a textually-different but
 * semver-equal anchor (`v1.2.0`, `1.2.0+build`) is neither behind nor ahead, so
 * a string `===` would drop it into the ahead branch and state the opposite of
 * the truth. The raw-string check stays as the fallback for an
 * unparseable-but-identical pair, which `semver.eq` would throw on.
 */
export function frameworkSkew(anchored: string | null, installed: string): FrameworkSkew {
  if (anchored === installed) return 'in-sync';
  if (anchored !== null && semver.valid(anchored) !== null && semver.eq(anchored, installed)) {
    return 'in-sync';
  }
  return isAnchorLagging(anchored, installed) ? 'anchor-behind' : 'anchor-ahead';
}

/**
 * Both halves of the behind-anchor recovery, in the order they must run.
 *
 * `upgrade` advances the anchor and applies the codemods; it does NOT re-sync
 * template-managed files, so a stale `lefthook/noldor.yml` survives it and the
 * hooks keep dying. `init --update` is what re-pulls the templates. Naming only
 * the first is what left a consumer with broken commits and a command that
 * reported success (bumbu, 2026-08-23).
 */
export const BEHIND_ANCHOR_REMEDY = "run 'noldor upgrade' then 'noldor init --update'";

/**
 * The advisory skew detail `doctor` prints, or `null` when the anchor is in sync
 * with the installed version. An anchor *ahead* of installed gets its own
 * message: `upgrade` cannot help there (it never rewrites an anchor backwards),
 * so the remedy is on the install side.
 */
export function frameworkSkewDetail(anchored: string | null, installed: string): string | null {
  switch (frameworkSkew(anchored, installed)) {
    case 'in-sync':
      return null;
    case 'anchor-behind':
      return `anchored ${anchored ?? '(unset)'} ≠ installed ${installed} — ${BEHIND_ANCHOR_REMEDY}`;
    case 'anchor-ahead':
      return `anchored ${anchored} is ahead of installed ${installed} — the install is behind, not the anchor`;
  }
}

/**
 * The diagnosis to append when a `noldor` invocation names a command or
 * subcommand that does not exist, or `null` when the versions are in sync and
 * the invocation really is a typo.
 *
 * This is the only surface a drifted consumer is guaranteed to see. A stale
 * scaffolded hook is precisely the state that cannot self-diagnose: `doctor`
 * would report the drift, but nothing routes the consumer to `doctor` — the
 * first symptom is a commit dying on `Unknown subcommand`, which reads as a
 * framework bug. Both skew directions can produce a missing command (a behind
 * anchor names one that was removed; an ahead anchor names one not shipped yet),
 * so both are worded rather than only the one `upgrade` can fix.
 */
export function missingCommandSkewHint(anchored: string | null, installed: string): string | null {
  const skew = frameworkSkew(anchored, installed);
  if (skew === 'in-sync') return null;
  const shape =
    skew === 'anchor-behind'
      ? `your repo is anchored at framework ${anchored ?? '(unset)'} but ${installed} is installed, ` +
        'so a scaffolded caller — typically a hook job in lefthook/noldor.yml — can name a ' +
        'subcommand this version has removed.\n' +
        `Remedy: ${BEHIND_ANCHOR_REMEDY} (the first advances the anchor and applies codemods, ` +
        'the second re-syncs the template-managed hook block).'
      : `your repo is anchored at framework ${anchored} but only ${installed} is installed, ` +
        'so a caller scaffolded by the newer framework can name a subcommand this version ' +
        'does not have yet.\n' +
        'Remedy: update the installed noldor package to ' +
        `${anchored} or newer — the install is behind, not the anchor.`;
  return `This may be framework version skew rather than a typo: ${shape}`;
}
