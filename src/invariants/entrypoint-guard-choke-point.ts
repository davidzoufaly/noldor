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
// WHAT IT MATCHES, on one line and nothing wider: a bare `import.meta.url`
// beside an indexed argv read. Those are the two ingredients of a
// direct-invocation guard, and needing both on one line is what keeps the rule
// sound in both directions.
//
// Two earlier shapes were tried and both failed, each in a way worth recording
// so neither is reinvented:
//
//   - Keying on an equality OPERATOR near the mention. It missed
//     `import.meta.url.startsWith(...)` and `.endsWith(...)` — the most literal
//     way to put the swept template back, with no operator at all — missed a
//     comparison whose operator opened the next line, and BLOCKED the sanctioned
//     `isEntrypoint(import.meta.url) && argv.length === 2`, where an unrelated
//     equality merely shared the line.
//   - Judging a WINDOW of lines. Proximity cuts both ways: one sanctioned call
//     then exempted every hand-rolled guard within two lines of it — including
//     one pasted from this check's own violation message — while an innocent
//     `const script = process.argv[1]` two lines from a `new URL(…,
//     import.meta.url)` asset read was refused.
//
// Hence per-line, and hence the exemption counts occurrences rather than
// searching for the sanctioned text: a line is clear only when EVERY mention on
// it is inside `isEntrypoint(...)`, so a bare guard cannot hide beside a
// sanctioned one, nor behind a trailing comment that names it.
//
// Non-guard uses stay silent for free, with no allowlist to maintain, because
// none indexes argv: `dirname(fileURLToPath(import.meta.url))` for a directory,
// `new URL('./x.json', import.meta.url)` for an asset,
// `import.meta.url.endsWith('.ts')` for a runtime probe.
//
// Blind spots, stated rather than papered over. This is a text scan (TypeScript 7
// dropped the in-process compiler API — see `public-api-tsdoc.ts`), so:
//
//   - a guard wrapped across lines splits the ingredients and evades it. This is
//     the price of dropping the window, taken knowingly: the false-negative
//     direction leaves a defect to be caught later, while the window's false
//     positives refused correct code and would have got the check waived.
//   - a guard reaching either ingredient through a local alias evades it —
//     `const url = import.meta.url; if (url === hand) { … }`, or an argv copy;
//   - a guard reading the script path by another spelling evades it —
//     `argv.at(1)`, or `const [, script] = process.argv`.
//
// Zero violations here does not prove the policy holds. What keeps those gaps
// narrow is that none of those shapes exists today and none is what an author
// reaches for; what keeps them honest is that they are written down.

const MENTION = 'import.meta.url';

/** The one sanctioned way to spell the guard. */
const SANCTIONED = `isEntrypoint(${MENTION})`;

/**
 * The entrypoint ingredient: an indexed argv read.
 *
 * A direct-invocation guard has to read the script path out of argv. Matching
 * bare `argv` instead reported `dirname(fileURLToPath(import.meta.url))` sitting
 * beside an unrelated `process.argv.length` — a false positive on correct code,
 * which is the direction that gets a blocking check waived.
 */
const ENTRY_ARGV_RE = /\bargv\[/;

/** Occurrences of `needle` in `haystack`. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

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
  if (t.startsWith('//') || t.startsWith('*')) return true;
  // `/*` opens a comment, but only runs to the end of the line when nothing
  // closes it: `/* note */ if (…) {}` carries executable code, and blanking the
  // whole line would let a hand-rolled guard through behind a two-word prefix.
  return t.startsWith('/*') && !t.includes('*/');
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
 * A line is a violation when it mentions `import.meta.url`, at least one of
 * those mentions is not inside `isEntrypoint(...)`, and the same line indexes
 * argv. Both ingredients on one line is the signal; see this file's header for
 * the two shapes this replaced and why each was unsound.
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
    const mentions = count(line, MENTION);
    if (mentions === 0) continue;
    // Every mention on this line is the sanctioned call, so there is no bare
    // `import.meta.url` left for a hand-rolled guard to use.
    if (mentions === count(line, SANCTIONED)) continue;
    if (!ENTRY_ARGV_RE.test(line)) continue;
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
