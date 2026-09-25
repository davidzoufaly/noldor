import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { walkRepo } from '../core/fd-load.js';
import { defineInvariant } from './types.js';
import type { Invariant, InvariantViolation } from './types.js';

/**
 * Split a call's argument list on top-level commas.
 *
 * Naive but sufficient for the text-scan invariants: nesting inside quotes,
 * parens or template holes is the only thing that would mis-split. A trailing
 * comma yields a last element that is blank.
 *
 * @param args - The text between a call's parens.
 * @returns One string per argument, untrimmed.
 */
export function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
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
    } else if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

/**
 * Build an invariant that runs a per-file text scan over every `.ts` file
 * under `<repoRoot>/src`.
 *
 * @param name - Invariant id, as reported.
 * @param description - One-line summary for the runner's listing.
 * @param repoRoot - Repository root whose `src/` tree is scanned.
 * @param scan - Violations for one file, given its repo-relative path and text.
 * @returns A plugin instance bound to that root.
 */
export function defineSrcScanInvariant(
  name: string,
  description: string,
  repoRoot: string,
  scan: (relPath: string, text: string) => InvariantViolation[],
): Invariant {
  return defineInvariant(name, description, async () => {
    const violations: InvariantViolation[] = [];
    const files: string[] = [];
    await walkRepo(join(repoRoot, 'src'), files);
    for (const abs of files) {
      if (!abs.endsWith('.ts')) continue;
      violations.push(...scan(relative(repoRoot, abs), await readFile(abs, 'utf8')));
    }
    return violations;
  });
}
