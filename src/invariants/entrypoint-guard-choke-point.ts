// @fd: main-module-guard-fails-on-percent-encoded-paths
import { defineSourceScanInvariant } from './source-scan.js';
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
// WHAT IT MATCHES is co-occurrence, not an operator. A direct-invocation guard
// needs two ingredients: this module's identity and the script path. So the rule
// is `import.meta.url` near `argv[1]`, unless the sanctioned call is right
// there. Keying on equality instead was tried and is worse in both directions:
// it missed a comparison whose operator opened the next line, missed
// `import.meta.url.startsWith(...)` and `.endsWith(...)` entirely — the most
// literal way to reintroduce the very template this feature deletes — and it
// BLOCKED the sanctioned `isEntrypoint(import.meta.url) && argv.length === 2`,
// because an unrelated equality shared the line. A blocking check whose false
// positive rejects correct code is worse than the defect it hunts.
//
// Non-guard uses stay silent for free, without an allowlist to maintain, because
// none of them indexes argv: `dirname(fileURLToPath(import.meta.url))` for a
// directory, `new URL('./x.json', import.meta.url)` for an asset,
// `import.meta.url.endsWith('.ts')` for a runtime probe.
//
// Blind spots, stated rather than papered over. This is a text scan (TypeScript 7
// dropped the in-process compiler API — see `public-api-tsdoc.ts`), so:
//
//   - a guard spread across more than WINDOW lines separates the two
//     ingredients far enough to evade it;
//   - a guard reaching either ingredient through a local alias evades it —
//     `const url = import.meta.url; if (url === hand) { … }`, or an argv copy;
//   - a guard reading the script path by some other spelling evades it —
//     `argv.at(1)`, or `const [, script] = process.argv`.
//
// Zero violations here does not prove the policy holds. What keeps those gaps
// narrow is that neither shape exists today and neither is what an author
// reaches for; what keeps them honest is that they are written down.

/**
 * Lines either side of an `import.meta.url` mention that count as "near".
 *
 * Two covers every wrapped form the formatter produces, including an operator
 * opening the following line. It is deliberately small: the co-occurrence test
 * is specific enough that a wider window would still be sound, but a narrow one
 * keeps the reported line close to the offending expression.
 */
const WINDOW = 2;

/** The one sanctioned way to spell the guard. */
const SANCTIONED = 'isEntrypoint(import.meta.url)';

/**
 * The entrypoint ingredient: slot 1 of argv specifically, not `argv` at large.
 *
 * A direct-invocation guard has to read the script path, which is always
 * `argv[1]`. Matching bare `argv` instead reported
 * `dirname(fileURLToPath(import.meta.url))` sitting near an unrelated
 * `process.argv.length` — a false positive on correct code, which is the failure
 * direction that gets a blocking check waived.
 */
const ENTRY_ARGV_RE = /\bargv\[1\]/;

/**
 * True for a line that is entirely a comment.
 *
 * Prose is not a guard: a commented-out comparison does not execute, so the
 * files most likely to *discuss* this pattern — the helper's own TSDoc, the
 * router's dispatch note, this very file — would otherwise all report
 * themselves, and the only remedies would be rewording every explanation or
 * exempting the files that hold them. Exempting `src/core/cli-entry.ts` in
 * particular would bless the one file where a reintroduced hand-rolled guard
 * does the most damage.
 *
 * Only whole-line comments are dropped. A trailing `//` tail is deliberately
 * left in place: cutting at `//` would truncate `'file://' + argv[1]` — the
 * literal shape being hunted — and turn a real guard invisible. The residue is
 * that `code; // import.meta.url and argv[1]` reports, which is a false positive
 * and so fails in the safe direction.
 */
function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

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
 * A mention of `import.meta.url` is a violation when `argv` appears within
 * {@link WINDOW} lines of it and the sanctioned call does not. Those are the two
 * ingredients of a direct-invocation guard, so their co-occurrence is the signal;
 * matching an operator instead both missed string-method spellings and rejected
 * correct code that happened to compare something else on the same line.
 *
 * The helper's own file needs no exemption: `isEntrypoint` names `moduleUrl`, a
 * parameter, and never `import.meta.url`.
 *
 * @param relPath - Repo-relative path, used for the exemption check and report.
 * @param text - The file's source.
 * @returns One blocking violation per hand-rolled guard.
 */
export function scanSource(relPath: string, text: string): InvariantViolation[] {
  if (isExempt(relPath)) return [];
  const out: InvariantViolation[] = [];
  // Comment lines are blanked rather than removed, so reported line numbers
  // still point at the real line in the file.
  const lines = text.split('\n').map((line) => (isCommentLine(line) ? '' : line));
  for (const [i, line] of lines.entries()) {
    if (!line.includes('import.meta.url')) continue;
    const near = lines.slice(Math.max(0, i - WINDOW), i + WINDOW + 1).join('\n');
    if (near.includes(SANCTIONED) || !ENTRY_ARGV_RE.test(near)) continue;
    out.push({
      file: relPath,
      line: i + 1,
      severity: 'error',
      message:
        'derives direct invocation from import.meta.url and argv by hand — gate on ' +
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
  return defineSourceScanInvariant(
    'entrypoint-guard-choke-point',
    'blocks hand-rolled import.meta.url comparisons outside src/core/cli-entry.ts',
    repoRoot,
    scanSource,
  );
}

/** Pre-built singleton using `process.cwd()` as repo root. */
export const entrypointGuardChokePoint: Invariant = makeEntrypointGuardChokePointInvariant(
  process.cwd(),
);
