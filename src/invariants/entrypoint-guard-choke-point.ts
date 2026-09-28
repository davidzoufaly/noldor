import { defineSrcScanInvariant, maskNonCode, splitArgs } from './source-scan.js';
import type { Invariant, InvariantViolation } from './types.js';

// Whether a module was run directly is decided in one place,
// `src/core/cli-entry.ts`. A hand-written guard that decides wrongly runs
// nothing and exits 0, so the failure looks like success. Three attempts to
// recognise a *wrong* comparison in text did not converge: an operator near the
// mention, a window of lines, and per-line co-occurrence all misjudged real
// shapes in both directions. This check asks a narrower question with an exact
// answer: does code outside the helper touch argv slot 1 at all? No guard can
// be written without that ingredient, so a hit is always real.
//
// Aliases (`const a = process.argv; a[1]`, `process['argv']`, `argv` imported
// from `node:process`) and whole-array copies are out of reach; nothing in
// `src/` reaches slot 1 that way.

const HELPER = 'src/core/cli-entry.ts';

const SLOT_ONE_READS = [
  /\bprocess\s*\.\s*argv\s*(?:\?\.\s*)?\[\s*1\s*\]/g,
  /\bprocess\s*\.\s*argv\s*(?:\?\.|\.)\s*at\s*\(\s*1\s*\)/g,
  /\bprocess\s*\.\s*argv\s*(?:\?\.|\.)\s*slice\s*\(\s*1\s*[,)]/g,
];

const DESTRUCTURED = /=\s*process\s*\.\s*argv\b(?!\s*(?:\?|\.|\[))/g;

const MESSAGE =
  'reads argv[1] by hand — use isEntrypoint(import.meta.url), invokedDirectly(stem) or runIfDirect(stem, label, main) from src/core/cli-entry.ts';

function isExempt(relPath: string): boolean {
  return relPath === HELPER || relPath.includes('/__tests__/') || relPath.endsWith('.test.ts');
}

/** The array pattern ending just before `end`, or null when none closes there. */
function arrayPatternBefore(masked: string, end: number): string | null {
  let close = end - 1;
  while (close >= 0 && /\s/.test(masked[close]!)) close--;
  if (masked[close] !== ']') return null;
  let depth = 0;
  for (let open = close; open >= 0; open--) {
    if (masked[open] === ']') depth++;
    else if (masked[open] === '[' && --depth === 0) return masked.slice(open + 1, close);
  }
  return null;
}

function bindsSlotOne(pattern: string): boolean {
  const slots = splitArgs(pattern).map((slot) => slot.trim());
  return slots[0]!.startsWith('...') || (slots.length > 1 && slots[1] !== '');
}

function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}

/**
 * Violations in one file's source text.
 *
 * @param relPath - Repo-relative path, reported on each violation.
 * @param text - The file's source.
 * @returns One violation per code read of argv slot 1, or a single
 *   `could not lex` violation when the mask cannot be trusted.
 */
export function scanSource(relPath: string, text: string): InvariantViolation[] {
  if (isExempt(relPath)) return [];
  const { masked, clean } = maskNonCode(text);
  if (!clean) {
    return [
      {
        file: relPath,
        message:
          'could not lex this file (a literal runs into a newline or past the end), so argv reads cannot be ruled out',
      },
    ];
  }
  const offsets: number[] = [];
  for (const re of SLOT_ONE_READS) {
    for (const m of masked.matchAll(re)) offsets.push(m.index);
  }
  for (const m of masked.matchAll(DESTRUCTURED)) {
    const pattern = arrayPatternBefore(masked, m.index);
    if (pattern !== null && bindsSlotOne(pattern)) offsets.push(m.index);
  }
  return offsets
    .sort((a, b) => a - b)
    .map((at) => ({ file: relPath, line: lineAt(text, at), message: MESSAGE }));
}

/**
 * Build the entrypoint-guard choke-point invariant for a specific repo root.
 *
 * @param repoRoot - Repository root whose `src/` tree should be scanned.
 * @returns A plugin instance bound to that root.
 */
export function makeEntrypointGuardChokePointInvariant(repoRoot: string): Invariant {
  return defineSrcScanInvariant(
    'entrypoint-guard-choke-point',
    'only src/core/cli-entry.ts reads argv[1], so every direct-invocation guard goes through one tested helper',
    repoRoot,
    scanSource,
  );
}

/** Pre-built singleton using `process.cwd()` as repo root. */
export const entrypointGuardChokePoint: Invariant = makeEntrypointGuardChokePointInvariant(
  process.cwd(),
);
