import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { walkRepo } from '../core/fd-load.js';
import { defineInvariant } from './types.js';
import type { Invariant, InvariantViolation } from './types.js';

// A `localeCompare` call with no locale argument collates by the MACHINE locale. Under `cs_CZ`
// Czech treats `ch` as one letter sorting after `h`, so `'Charlie'` orders
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
 * Whether a call's argument text carries a second top-level argument.
 *
 * A trailing comma after the first argument (the multi-line call style the
 * formatter emits) is not a second argument.
 */
function hasLocaleArg(args: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i]!;
    if (quote !== null) {
      if (ch === quote && args[i - 1] !== '\\') quote = null;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
    } else if (ch === ',' && depth === 0 && args.slice(i + 1).trim() !== '') {
      return true;
    }
  }
  return false;
}

/** The argument text of the call opening at `start`, up to its closing paren. */
function argsAt(text: string, start: number): string {
  let depth = 1;
  let quote: string | null = null;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (quote !== null) {
      if (ch === quote && text[i - 1] !== '\\') quote = null;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')' && --depth === 0) {
      return text.slice(start, i);
    }
  }
  return text.slice(start);
}

/**
 * Violations in one file's source text.
 *
 * @param relPath - Repo-relative path, reported on each violation.
 * @param text - The file's source.
 * @returns One violation per `localeCompare` call that names no locale.
 */
export function scanSource(relPath: string, text: string): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (let at = text.indexOf(CALL); at !== -1; at = text.indexOf(CALL, at + CALL.length)) {
    if (hasLocaleArg(argsAt(text, at + CALL.length))) continue;
    out.push({
      file: relPath,
      line: text.slice(0, at).split('\n').length,
      message:
        "localeCompare with no locale sorts by the machine locale (cs_CZ collates 'ch' after 'h') — pin it: a.localeCompare(b, 'en')",
    });
  }
  return out;
}

/**
 * Build the pinned-localeCompare invariant for a specific repo root.
 *
 * @param repoRoot - Repository root whose `src/` tree should be scanned.
 * @returns A plugin instance bound to that root.
 */
export function makeLocaleComparePinnedInvariant(repoRoot: string): Invariant {
  return defineInvariant(
    'locale-compare-pinned',
    'every localeCompare call in src/ names a fixed locale, so sort order does not depend on the machine',
    async () => {
      const violations: InvariantViolation[] = [];
      const files: string[] = [];
      await walkRepo(join(repoRoot, 'src'), files);
      for (const abs of files) {
        if (!abs.endsWith('.ts') && !abs.endsWith('.tsx')) continue;
        violations.push(...scanSource(relative(repoRoot, abs), await readFile(abs, 'utf8')));
      }
      return violations;
    },
  );
}

/** Pre-built singleton using `process.cwd()` as repo root. */
export const localeComparePinned: Invariant = makeLocaleComparePinnedInvariant(process.cwd());
