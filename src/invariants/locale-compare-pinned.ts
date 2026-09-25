import { defineSrcScanInvariant, splitArgs } from './source-scan.js';
import type { Invariant, InvariantViolation } from './types.js';

// A `localeCompare` call with no locale argument collates by the MACHINE
// locale. Under `cs_CZ` Czech treats `ch` as one letter sorting after `h`, so `'Charlie'` orders
// after `'Delta'` on an operator's Mac and before it on an `en_US` CI runner —
// and every committed artifact built from that sort churns with whoever
// regenerated it last. The fix is a second argument naming the locale
// (`a.localeCompare(b, 'en')`); this check keeps the unpinned form from coming
// back. Blocking, unlike the advisory slug-path scan: the shape it looks for is
// exact, so a hit is always a real unpinned call, never a guess.
//
// A text scan, like its siblings (no in-process TS compiler API under TS 7 —
// see `public-api-tsdoc.ts`). It cannot see a call made through a reference
// (`const cmp = String.prototype.localeCompare`); nothing in `src/` does that.

// Joined from parts so this module does not match its own scan.
const CALL = ['.locale', 'Compare('].join('');

/**
 * The argument text of the call whose `(` sits just before `start`.
 *
 * Counts parens only, not quotes: no comparator in `src/` is handed a string
 * literal containing a paren, which is the one shape this would miscount.
 */
function argsAt(text: string, start: number): string {
  let depth = 1;
  let i = start;
  for (; i < text.length && depth > 0; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
  }
  return text.slice(start, i - 1);
}

/**
 * Violations in one file's source text.
 *
 * @param relPath - Repo-relative path, reported on each violation.
 * @param text - The file's source.
 * @returns One violation per `localeCompare` call that names no locale.
 */
export function scanSource(relPath: string, text: string): InvariantViolation[] {
  const unpinned: number[] = [];
  for (let at = text.indexOf(CALL); at !== -1; at = text.indexOf(CALL, at + CALL.length)) {
    // A trailing comma (the formatter's multi-line style) splits off a blank
    // last element, which is not a locale argument.
    const args = splitArgs(argsAt(text, at + CALL.length)).filter((arg) => arg.trim() !== '');
    if (args.length < 2) unpinned.push(at);
  }
  return unpinned.map((at) => ({
    file: relPath,
    line: text.slice(0, at).split('\n').length,
    message:
      "localeCompare with no locale sorts by the machine locale (cs_CZ collates 'ch' after 'h') — pin it: a.localeCompare(b, 'en')",
  }));
}

/**
 * Build the pinned-localeCompare invariant for a specific repo root.
 *
 * @param repoRoot - Repository root whose `src/` tree should be scanned.
 * @returns A plugin instance bound to that root.
 */
export function makeLocaleComparePinnedInvariant(repoRoot: string): Invariant {
  return defineSrcScanInvariant(
    'locale-compare-pinned',
    'every localeCompare call in src/ names a fixed locale, so sort order does not depend on the machine',
    repoRoot,
    scanSource,
  );
}

/** Pre-built singleton using `process.cwd()` as repo root. */
export const localeComparePinned: Invariant = makeLocaleComparePinnedInvariant(process.cwd());
