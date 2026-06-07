// Detects whether two `docs/sdd-report.md` revisions differ only in the
// non-deterministic review-skip count line. The release script (`index.ts`)
// uses this to skip its dirty-report abort when the regen's sole change is that
// rolling counter, which bumps by 1 per in-flight branch commit.

/** Matches the exact line emitted by `sdd-report.ts` for the review-skip count. */
const COUNT_LINE_RE = /^Gated commits missing `Noldor-Reviewed` trailer: \d+$/m;

/** Stable placeholder both sides collapse to before comparison. */
const MASK = 'Gated commits missing `Noldor-Reviewed` trailer: <count>';

/**
 * Returns `true` when `head` and `working` are identical, or differ *only* in
 * the review-skip count line; `false` on any other delta.
 *
 * Masking is anchored to the literal line `sdd-report.ts` writes. If that format
 * ever changes, the mask no-ops on the side missing the pattern, the masked
 * strings won't match, and this returns `false` — failing safe toward the
 * release script's existing abort behavior.
 */
export function onlyReviewSkipCountChanged(head: string, working: string): boolean {
  return head.replace(COUNT_LINE_RE, MASK) === working.replace(COUNT_LINE_RE, MASK);
}
