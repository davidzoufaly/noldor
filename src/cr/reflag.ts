/**
 * Re-flag rules — why a review loop looks like it is oscillating.
 *
 * Shaped after `src/core/split-suggestion.ts`: exported constants, one function
 * per rule, no I/O, no clock. The caller fetches; this module reasons. That is
 * what makes every rule testable from literals with no fixture repo, and it
 * keeps I/O failure handling out of a module whose whole contract is that it
 * cannot fail.
 *
 * ADVISORY WITH TEETH. A signal never suppresses a finding, never edits a sink,
 * and never moves an exit code. It is reported; the operator decides.
 */
import type { CutScope } from './cut-scan.js';
import type { FindingLocation } from './findings-schema.js';

/** A blocker reduced to what the rules need. */
export interface RuleBlocker {
  readonly id: string;
  readonly severity: 'high' | 'med' | 'low';
  readonly message: string;
  readonly locations?: readonly FindingLocation[];
}

/** One reason a blocker looks like a re-flag. */
export interface ReflagSignal {
  readonly rule: 'R1' | 'R2' | 'R3';
  readonly blockerId: string;
  readonly message: string;
}

/**
 * A rule reports one of THREE outcomes, not two.
 *
 * `split-suggestion.ts` emits only fired/clear because its input is always
 * available. Here an input can be missing — a file that would not scan, a range
 * that is not a fast-forward, a git call that failed — and a two-arm shape
 * would encode "could not tell" as silence, which is the one reading a detector
 * must never produce.
 *
 * `fired` carries an optional `omitted` for the same reason the third arm
 * exists at all: a rule can both find something AND fail to look somewhere. One
 * blocker points at a file that would not scan while another lands in a scope —
 * without this the result is `fired` with only the second, and the first
 * blocker's "could not tell" becomes exactly the silence the three arms were
 * meant to prevent.
 */
export type RuleResult =
  | {
      readonly outcome: 'fired';
      readonly signals: readonly ReflagSignal[];
      readonly omitted?: string;
    }
  | { readonly outcome: 'clear' }
  | { readonly outcome: 'omitted'; readonly reason: string };

const CLEAR: RuleResult = { outcome: 'clear' };

/**
 * Shared by every rule: no signals is `clear`, never an empty `fired`.
 *
 * With an `omitted` reason and no signals the answer is the `omitted` arm — a
 * rule that looked nowhere has nothing to report as clear.
 */
export function fired(signals: readonly ReflagSignal[], omitted?: string): RuleResult {
  if (signals.length === 0)
    return omitted === undefined ? CLEAR : { outcome: 'omitted', reason: omitted };
  return omitted === undefined
    ? { outcome: 'fired', signals }
    : { outcome: 'fired', signals, omitted };
}

/**
 * The inclusive line span a location covers. A bullet naming `path:10-20`
 * parses to `line: 10, endLine: 20` ({@link extractLocations}), and both
 * range-matching rules count ANY overlap: a finding about lines 10-20 IS a
 * finding about the cut declared at 15-18. Matching the start line alone would
 * make the parsed `endLine` decorative.
 *
 * `undefined` when the location names no line at all — a file-only location
 * cannot be compared against a line span, and guessing "the whole file" would
 * fire on every marker in it.
 */
function lineSpan(loc: FindingLocation): { start: number; end: number } | undefined {
  if (loc.line === undefined) return undefined;
  const end = loc.endLine !== undefined && loc.endLine > loc.line ? loc.endLine : loc.line;
  return { start: loc.line, end };
}

/** Human-readable form of a span, for a signal message. */
function spanLabel(span: { start: number; end: number }): string {
  return span.start === span.end ? `${span.start}` : `${span.start}-${span.end}`;
}

/**
 * R1 — repeat. A blocker whose id appeared in a prior round.
 *
 * `priorRounds` is one id list per prior round. `undefined` means the ledger
 * recorded no ids (every round written before that field existed), which is
 * `omitted` rather than `clear`: the rule genuinely could not run. An EMPTY
 * array is different and IS clear — a first round has no history, and "nothing
 * repeated because nothing came before" is a real answer.
 */
export function ruleR1(
  blockers: readonly RuleBlocker[],
  priorRounds: readonly (readonly string[])[] | undefined,
): RuleResult {
  if (priorRounds === undefined)
    return { outcome: 'omitted', reason: 'no recorded blocker ids in the ledger' };
  const prior = new Set(priorRounds.flat());
  return fired(
    blockers
      .filter((b) => prior.has(b.id))
      .map((b) => ({
        rule: 'R1' as const,
        blockerId: b.id,
        message: `blocker repeats a prior round — the same finding survived a fix: ${b.message}`,
      })),
  );
}

/**
 * R3 — contradiction. A blocker located on a line the series introduced.
 *
 * `introducedByFile` is measured CUMULATIVELY by the caller, from the series'
 * first round's `headSha` to current `HEAD`. A single prior round's range is
 * expressed in that fix's coordinates and every later fix shifts them, so from
 * round 3 on a per-round range both misses and misfires; one cumulative range
 * keeps introduced lines in the same coordinate space as a finding's location.
 *
 * `undefined` means the caller could not produce a trustworthy range — most
 * often because the series is not a fast-forward (a rebase onto a moved
 * `origin/main` puts every upstream-added line inside it). That is `omitted`,
 * never `clear`.
 */
export function ruleR3(
  blockers: readonly RuleBlocker[],
  introducedByFile: ReadonlyMap<string, ReadonlySet<number>> | undefined,
): RuleResult {
  if (introducedByFile === undefined)
    return {
      outcome: 'omitted',
      reason: 'introduced-line range unavailable — the series is not a fast-forward',
    };
  const signals: ReflagSignal[] = [];
  for (const b of blockers) {
    for (const loc of b.locations ?? []) {
      const span = lineSpan(loc);
      if (span === undefined) continue;
      const introduced = introducedByFile.get(loc.file);
      if (introduced === undefined) continue;
      // A span is "about a line this series introduced" if ANY line in it was.
      //
      // Whichever side is SMALLER gets iterated, and that is a bound rather than
      // a micro-optimisation: a span's endpoints come from reviewer prose and
      // nothing caps them, so a bullet naming `src/x.ts:10-1000000000` would
      // otherwise walk a billion integers to answer "clear". The introduced set
      // is bounded by real file content, so scanning it instead makes the work
      // proportional to the repository rather than to LLM output.
      let hit: number | undefined;
      if (span.end - span.start <= introduced.size) {
        for (let n = span.start; n <= span.end; n++) {
          if (introduced.has(n)) {
            hit = n;
            break;
          }
        }
      } else {
        for (const n of introduced) {
          if (n >= span.start && n <= span.end && (hit === undefined || n < hit)) hit = n;
        }
      }
      if (hit !== undefined) {
        signals.push({
          rule: 'R3',
          blockerId: b.id,
          message:
            `blocker at ${loc.file}:${spanLabel(span)} is about line ${hit}, ` +
            `which this series introduced`,
        });
        break;
      }
    }
  }
  return fired(signals);
}

/**
 * R2 — cut-site. A blocker located inside a documented cut marker's scope.
 *
 * This is the signal that would have caught the Q-0146 case: codex re-flagged
 * documented cut sites five times in a single review.
 *
 * `scopesByFile` and `unscannable` both arrive as data — the module opens
 * nothing. A blocker whose file could not be examined yields `omitted` naming
 * that file, never `clear`.
 *
 * `unscannable` maps a file to the caller's REASON rather than listing bare
 * paths, because only the caller knows which one it hit: a file can fail to
 * scan (brace depth did not balance) or fail to read at all (a changed path
 * that turned out to be a symlink, refused before the read). Naming a single
 * invented cause here sent an operator looking at the wrong problem.
 */
export function ruleR2(
  blockers: readonly RuleBlocker[],
  scopesByFile: ReadonlyMap<string, readonly CutScope[]>,
  unscannable: ReadonlyMap<string, string>,
): RuleResult {
  const signals: ReflagSignal[] = [];
  const blockedHit = new Set<string>();
  for (const b of blockers) {
    for (const loc of b.locations ?? []) {
      if (unscannable.has(loc.file)) {
        blockedHit.add(loc.file);
        continue;
      }
      const span = lineSpan(loc);
      if (span === undefined) continue;
      // Overlap, not containment: a finding spanning 10-20 is about the cut
      // declared at 15-18 even though it starts outside it.
      const hit = (scopesByFile.get(loc.file) ?? []).find(
        (s) => span.start <= s.endLine && span.end >= s.startLine,
      );
      if (hit) {
        signals.push({
          rule: 'R2',
          blockerId: b.id,
          message:
            `blocker at ${loc.file}:${spanLabel(span)} sits inside a noldor:cut scope ` +
            `declared at ${loc.file}:${hit.line} — "${hit.reason}"`,
        });
        break;
      }
    }
  }
  // Reported even when signals fired: see RuleResult. A file nobody could scan
  // is news whether or not some other blocker landed.
  const omitted =
    blockedHit.size > 0
      ? `could not examine ${[...blockedHit]
          .sort()
          .map((f) => `${f} (${unscannable.get(f) ?? 'reason not recorded'})`)
          .join(', ')}`
      : undefined;
  return fired(signals, omitted);
}
