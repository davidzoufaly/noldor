// @fd: main-module-guard-fails-on-percent-encoded-paths
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { walkRepo } from '../core/fd-load.js';
import { defineInvariant } from './types.js';
import type { Invariant, InvariantViolation } from './types.js';

// BLOCKING ON PURPOSE — unlike `slug-path-choke-point.ts`, whose shape this
// borrows, this emits `severity: 'error'`. There is no type-system enforcement
// standing behind it: nothing stops a new entrypoint from comparing
// `import.meta.url` by hand, and when that comparison is wrong the module runs
// nothing and exits 0, so the failure is invisible by construction. An advisory
// would be a check that cannot refuse the one thing it exists to refuse.
//
// The class demonstrably regrows. Thirty-five sites carried a broken
// `file://${process.argv[1]}` template; over the three weeks the defect sat
// filed, two migrated away and two new ones arrived carrying it.
//
// It matches the COMPARISON, not one spelling of it. A check keyed on the
// template would pass a `'file://' + process.argv[1]` concatenation, pass a
// `fileURLToPath` path compare against `process.argv[1]`, and pass whatever
// spelling comes next — while the goal claims no site bypasses the helper.
// (Naming those shapes in prose rather than in code is deliberate: this scan
// reads its own file, and a comment quoting a comparison verbatim reports it.
// A reword is the right price for a check that fails closed.)
//
// Blind spot, stated rather than papered over: this is a text scan (TypeScript 7
// dropped the in-process compiler API — see `public-api-tsdoc.ts`), so a
// comparison that reaches `import.meta.url` through a local alias evades it:
//
//   const url = import.meta.url;
//   if (url === somethingHandBuilt) { … }
//
// Zero violations here does not prove the policy holds. What makes that gap
// narrow rather than fatal is that no such alias exists today and the direct
// form is the one every entrypoint actually reaches for.

/** `===`, `!==`, `==`, `!=` — and nothing else. */
const EQUALITY_RE = /[=!]=/;

/**
 * True for the trees that construct these comparisons deliberately: the test
 * files that assert this scan's own behaviour would otherwise report
 * themselves.
 */
function isExempt(relPath: string): boolean {
  return relPath.includes('__tests__') || relPath.endsWith('.test.ts');
}

/**
 * Violations in one file's source text.
 *
 * A line mentioning `import.meta.url` is a violation when an equality operator
 * appears on that same line, or when the previous line ends with one — the
 * second case catching a comparison wrapped across lines, in either operand
 * order. Deliberately not a wider window: a `dirname(fileURLToPath(...))` line
 * followed by an unrelated `if (a === b)` is a legitimate pair, and reporting it
 * would make this a check people waive.
 *
 * Non-comparison uses never match, which is why the helper's own file needs no
 * exemption: `isEntrypoint` compares `moduleUrl`, a parameter.
 *
 * @param relPath - Repo-relative path, used for the exemption check and report.
 * @param text - The file's source.
 * @returns One blocking violation per hand-rolled comparison.
 */
export function scanSource(relPath: string, text: string): InvariantViolation[] {
  if (isExempt(relPath)) return [];
  const out: InvariantViolation[] = [];
  const lines = text.split('\n');
  for (const [i, line] of lines.entries()) {
    if (!line.includes('import.meta.url')) continue;
    const continued = EQUALITY_RE.test((lines[i - 1] ?? '').trimEnd().slice(-3));
    if (!EQUALITY_RE.test(line) && !continued) continue;
    out.push({
      file: relPath,
      line: i + 1,
      severity: 'error',
      message:
        'compares import.meta.url by hand — gate direct invocation on ' +
        'isEntrypoint(import.meta.url) from src/core/cli-entry.ts, which puts both ' +
        'sides through one encoder so a path needing percent-encoding cannot ' +
        'silently disable the body',
    });
  }
  return out;
}

/**
 * Build the entrypoint-guard choke-point invariant for a specific repo root.
 *
 * @param repoRoot - Repository root whose `src/` tree should be scanned.
 * @returns A plugin instance bound to that root.
 */
export function makeEntrypointGuardChokePointInvariant(repoRoot: string): Invariant {
  return defineInvariant(
    'entrypoint-guard-choke-point',
    'blocks hand-rolled import.meta.url comparisons outside src/core/cli-entry.ts',
    async () => {
      const violations: InvariantViolation[] = [];
      const files: string[] = [];
      await walkRepo(join(repoRoot, 'src'), files);
      for (const abs of files) {
        if (!abs.endsWith('.ts')) continue;
        violations.push(...scanSource(relative(repoRoot, abs), await readFile(abs, 'utf8')));
      }
      return violations;
    },
  );
}

/** Pre-built singleton using `process.cwd()` as repo root. */
export const entrypointGuardChokePoint: Invariant = makeEntrypointGuardChokePointInvariant(
  process.cwd(),
);
