import { createHash } from 'node:crypto';
import { readFileNoFollowAsync, slugPath } from '../core/slug-paths.js';
import { readSession } from '../core/session.js';
import type { Slug } from '../core/slug.js';
import { mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

import { writeJsonAtomic } from './atomic-write.js';
import { artifactKindSchema } from './findings-schema.js';
import type { ArtifactKind, Finding } from './findings-schema.js';

/**
 * Maximum auto-fix rounds per gate session, per `slug`+`kind`. A CONSTANT, not a
 * config knob: `docs/vision.md` ("opinionated, not configurable") and one
 * posture knob (`autonomous.onBlockers`) is enough.
 *
 * THE CAP IS THE LIVE BOUND. The no-progress fingerprint stop is a cheap extra,
 * not the primary one: the re-round runs `orchestrate --base-sha <prior head>`,
 * so round 2's reviewer reads only the fix diff and orchestrate overwrites the
 * sinks — a round-1 blocker therefore rarely reappears with an identical
 * `severity|file|message` tuple for the fingerprint to catch. It earns its keep
 * on a FULL re-review (`--full-review`, or a lane that ignores `baseSha`), where
 * an unfixed blocker does come back verbatim.
 */
export const AUTOFIX_ROUND_CAP = 2;

export const roundVerdictSchema = z.enum(['green', 'red']);
export type RoundVerdict = z.infer<typeof roundVerdictSchema>;

export const autofixRoundSchema = z.object({
  round: z.number().int().positive(),
  /**
   * The head this round REVIEWED, written by `cr orchestrate` and never
   * rewritten. It is the entry's identity — `record` annotates by matching it,
   * and both seam ledger rules exclude the round being decided by it — so it
   * must stay stable. May be `''` when git was unavailable.
   */
  headSha: z.string(),
  /**
   * The tip AFTER this round's fix, written by `cr autofix record`.
   *
   * A separate field rather than a rewrite of {@link autofixRoundSchema.shape.headSha},
   * which is what two readers want (`resolveBaseSha`'s ledger rung and
   * `record`'s own `diffRange` rung) but which would destroy identity: the next
   * round's entry carries that same post-fix tip as its own reviewed head, so
   * both entries would answer to one sha and the seam rules would exclude both.
   */
  fixHeadSha: z.string().optional(),
  fingerprint: z.string().min(1),
  /**
   * Whether the round found anything. `green` iff the round's `aggregate` for
   * the pair reported `ok` — which already folds in a blocking lane, an
   * unresolved expected lane and a malformed sink.
   *
   * OPTIONAL, and absent reads as `red` ({@link roundVerdict}). Every entry
   * written before this field existed came from `cr autofix record`, which only
   * ever ran after a fix — so its round had blockers, and `red` is both the
   * truth about those entries and the fail-safe direction for the cap.
   */
  verdict: roundVerdictSchema.optional(),
  /**
   * The closing round: the single dispatch allowed past the cap once a fix
   * changed `HEAD`. Its own field rather than a value in {@link
   * autofixRoundSchema.shape.stopped} because `stopped` is caller-writable free
   * text (`cr autofix record --stopped <reason>`, a documented public flag), so
   * a sentinel living there could be forged into a permanent refusal for the
   * pair. Only `cr orchestrate` writes this.
   */
  closingRound: z.boolean().optional(),
  applied: z.number().int().nonnegative(),
  deferred: z.number().int().nonnegative(),
  diffStat: z.string(),
  /**
   * The git range `diffStat` was measured over. Recorded because the ladder has
   * a lossy rung: round 1 has no prior `headSha`, so it falls back to
   * `HEAD~1..HEAD` — "the last commit", which under-reports whenever the fix was
   * split across commits (noldor's own scope rules split `src/**` from a
   * `docs/noldor/**` twin routinely). Optional so ledgers written before it
   * existed still parse.
   */
  diffRange: z.string().optional(),
  /** Why the loop stopped at this round, when it did. */
  stopped: z.string().optional(),
});
export type AutofixRound = z.infer<typeof autofixRoundSchema>;

export const autofixLedgerSchema = z.object({
  slug: z.string().min(1),
  kind: artifactKindSchema,
  /**
   * `startedAt` of the gate session that owns this round series, copied from
   * `.noldor/session.json`. Scopes the cap to one session — see
   * {@link isSameSeries}.
   */
  sessionStartedAt: z.string(),
  rounds: z.array(autofixRoundSchema),
});
export type AutofixLedger = z.infer<typeof autofixLedgerSchema>;

/**
 * A ledger whose CONTENT could not be parsed — distinct from any other fs
 * error on purpose. Only a parse failure may trigger the quarantine in
 * `autofix-cli.ts`: renaming a file away because it could not be *read*
 * (EACCES, EIO, a transient lock) would restart the round series on transient
 * infra, which is a fail-open cap reset — the one direction this design refuses.
 */
export class LedgerParseError extends Error {
  readonly path: string;

  constructor(path: string, cause: unknown) {
    super(`autofix ledger at ${path} is malformed: ${(cause as Error)?.message ?? String(cause)}`);
    this.name = 'LedgerParseError';
    this.path = path;
  }
}

/**
 * Ledger directory. A SUBDIRECTORY of `.noldor/cr`, not a sibling of the lane
 * sinks, and that is load-bearing: `aggregate()` collects every
 * `.noldor/cr/<slug>-<kind>-*.json` regular file as a lane sink, so a ledger
 * named `<slug>-<kind>-autofix.json` beside them matched that glob,
 * `inferLaneFromFilename` returned null for it, and a bogus
 * `non-conforming filename` HIGH blocker landed in every aggregate for the pair
 * — turning green code-stage runs red. `aggregate` skips non-files, so nesting
 * removes the whole collision class (the existing `archive/` dir is skipped the
 * same way).
 */
export function ledgerDir(cwd: string): string {
  return join(cwd, '.noldor', 'cr', 'autofix');
}

/**
 * Ledger path for a `slug`+`kind` pair.
 *
 * Branded slug in, so a refusal here means a symlink or relocated root under
 * `.noldor/cr/autofix` — repository tampering, not a bad argument.
 */
export function ledgerPath(cwd: string, slug: Slug, kind: ArtifactKind): string {
  const built = slugPath(cwd, ['.noldor', 'cr', 'autofix'], slug, { suffix: `-${kind}.json` });
  if (!built.ok) throw new Error(`cannot resolve autofix ledger: ${built.error.kind}`);
  return built.path;
}

/** Quarantine path a malformed ledger is renamed to. */
export function quarantinePath(cwd: string, slug: Slug, kind: ArtifactKind): string {
  return `${ledgerPath(cwd, slug, kind)}.bad`;
}

/**
 * The SINGLE session-match predicate. Both {@link readLedger} and
 * {@link appendRound} route their session verdict through here: reader and
 * writer must key on the same value or the scoping is decorative, and two
 * hand-written comparisons can drift apart silently.
 */
export function isSameSeries(ledger: AutofixLedger, sessionStartedAt: string): boolean {
  return ledger.sessionStartedAt === sessionStartedAt;
}

/**
 * The session key both writers scope their series by, resolved from the gate's
 * session marker. Lives beside {@link isSameSeries} for the same reason that
 * predicate is shared: reader and writer must key on the same value, and two
 * hand-written `readSession(cwd)?.startedAt` expressions in different modules
 * drift apart silently.
 *
 * The `''` fallback is deliberate for COUNTING. Rounds then accumulate across
 * unrelated sessionless runs of one pair, which over-counts — it caps early,
 * never late, and early is the safe direction for a loop bound. It is NOT safe
 * for the closing-round sentinel, which is a permanent refusal rather than a
 * conservative cap: see {@link hasClosingRound}.
 */
export function sessionKey(cwd: string): string {
  return readSession(cwd)?.startedAt ?? '';
}

/** Verdict of a recorded round; an entry written before the field existed reads `red`. */
export function roundVerdict(round: AutofixRound): RoundVerdict {
  return round.verdict ?? 'red';
}

/**
 * Rounds that found something — the only ones the cap counts.
 *
 * Takes the rounds rather than the ledger so a caller can count a SUBSET: the
 * seam counts among rounds excluding the one being decided, while the cap counts
 * the whole series.
 */
export function redRounds(rounds: readonly AutofixRound[]): number {
  return rounds.filter((r) => roundVerdict(r) === 'red').length;
}

/**
 * Whether this series has already spent its closing round.
 *
 * Always `false` for a sessionless series. The sentinel refuses every later
 * dispatch regardless of `HEAD`, so under the shared `''` key of
 * {@link sessionKey} one sessionless run's closing round would lock out every
 * future sessionless dispatch for the pair — a permanent wedge, not the
 * conservative early cap that fallback is justified by. A sessionless series
 * therefore never records the sentinel and its refusal always lifts on a
 * changed head.
 */
export function hasClosingRound(ledger: AutofixLedger | null, sessionStartedAt: string): boolean {
  if (sessionStartedAt === '') return false;
  return (ledger?.rounds ?? []).some((r) => r.closingRound === true);
}

/**
 * Whether `entryHead` is the round `headSha` names.
 *
 * PREFIX match in either direction, because an abbreviated sha is legal
 * everywhere else in this subsystem: `--since` is validated as 4-40 hex and the
 * usage string advertises that, so exact equality would hard-fail `record` on a
 * `--since abc1234` that used to work. Exported so the cap's own head
 * comparison uses one predicate — comparing exactly there while matching by
 * prefix here would read an abbreviated form of an unchanged head as a change,
 * and hand out a closing round nobody earned.
 */
export function headMatches(entryHead: string, headSha: string): boolean {
  if (entryHead === '' || headSha === '') return false;
  return entryHead.startsWith(headSha) || headSha.startsWith(entryHead);
}

/**
 * The entry for `headSha`, or `null`. Identity, never position: `cr autofix
 * record` annotates the round it actually reviewed rather than "the last one",
 * so a delayed or retried run cannot attach its counts to a later round, and
 * the seam's ledger rules can exclude the round being decided without assuming
 * it sits at the end (`plan` may run over sinks no dispatch produced).
 */
export function roundForHead(ledger: AutofixLedger | null, headSha: string): AutofixRound | null {
  const rounds = ledger?.rounds ?? [];
  // No sha means git was unreachable, so identity is simply unavailable and
  // position is all there is. `record` must still annotate something — dropping
  // the counts would disarm `prior-deferred` — so it takes the last entry, which
  // is the round orchestrate just wrote.
  if (headSha === '') return rounds.at(-1) ?? null;
  // The LAST match, not the first. A head repeats whenever a dispatch runs twice
  // without a commit between — a crashed lane re-run, an uncommitted fix — and
  // the round being annotated is always the most recent one at that head.
  // Taking the first would land `record`'s counts on an older round, leaving the
  // current one's placeholder `deferred: 0` in place and disarming that guard.
  return rounds.findLast((r) => headMatches(r.headSha, headSha)) ?? null;
}

/** Every round except the one for `headSha` — what both seam ledger rules compare against. */
export function roundsExcludingHead(
  ledger: AutofixLedger | null,
  headSha: string,
): readonly AutofixRound[] {
  const rounds = ledger?.rounds ?? [];
  // With no sha the current round cannot be identified, so every entry is
  // compared. That is the conservative direction here in a way it is not for
  // {@link roundForHead}: these rules are STOPS, and comparing against more
  // history can only make the seam decline sooner.
  if (headSha === '') return rounds;
  // Exclude exactly ONE entry — the same one {@link roundForHead} resolves.
  // Filtering every entry at that head would blind the rules to an earlier round
  // that ran at the same sha, which is precisely the repeat `no-progress` exists
  // to catch.
  const current = rounds.findLast((r) => headMatches(r.headSha, headSha));
  if (!current) return rounds;
  return rounds.filter((r) => r !== current);
}

/**
 * Stable fingerprint of a blocker set, used for the no-progress stop.
 *
 * Sorted before hashing so lane ordering cannot change the value. `line` is
 * deliberately EXCLUDED: code-stage blockers carry one, and an unrelated edit
 * elsewhere in the file shifts it, so including it would make an unfixed blocker
 * fingerprint as progress and the no-progress stop would never fire.
 */
export function fingerprintBlockers(blockers: readonly Finding[]): string {
  const tuples = blockers.map((b) => `${b.severity}|${b.file}|${b.message}`).sort();
  return createHash('sha1').update(tuples.join('\n')).digest('hex');
}

/**
 * Read the round series owned by the current session.
 *
 * `null` when the file is absent, or when it belongs to a different session —
 * a stale series reads as "no prior rounds", which is what keeps the cap
 * per-session rather than permanent on a `slug`+`kind` pair (those repeat across
 * attach sessions and manual re-runs in the shared main workspace).
 *
 * Throws {@link LedgerParseError} on malformed content: an unknown round count
 * must fail toward declining, never toward another round. Every OTHER fs error
 * propagates as itself, so callers can tell "corrupt" from "could not read".
 */
export async function readLedger(
  cwd: string,
  slug: Slug,
  kind: ArtifactKind,
  sessionStartedAt: string,
): Promise<AutofixLedger | null> {
  const path = ledgerPath(cwd, slug, kind);
  let raw: string;
  try {
    raw = await readFileNoFollowAsync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err; // EACCES / EIO / … — NOT a parse failure, so no quarantine upstream
  }
  let ledger: AutofixLedger;
  try {
    ledger = autofixLedgerSchema.parse(JSON.parse(raw));
  } catch (err) {
    throw new LedgerParseError(path, err);
  }
  return isSameSeries(ledger, sessionStartedAt) ? ledger : null;
}

/**
 * Append `round` to the current session's series.
 *
 * THE WRITER OWNS THE SESSION KEY. On an absent file, or one belonging to a
 * different session, the series is REPLACED (`rounds: [round]`) rather than
 * appended to. Appending blindly to a stale ledger would leave the old
 * `sessionStartedAt` in place, so every subsequent `readLedger` in this session
 * would keep returning `null`, `rounds.length` would stay 0, and both the cap
 * and the no-progress stop would go dead for the whole session — the loop bound
 * defeated by the very scoping meant to make it usable.
 *
 * Throws {@link LedgerParseError} on a malformed existing file rather than
 * replacing it: this is an exported function, and a caller who skipped the read
 * must not be able to destroy unparseable state. It never renames — quarantine
 * belongs to `plan` alone.
 *
 * Read-modify-write over a shared file: {@link writeJsonAtomic} makes the write
 * atomic but not the RMW, so concurrent runs against the same `slug`+`kind` can
 * drop a round. Unsupported, consistent with the sinks; parallel drain assigns
 * each child a distinct slug, so the supported concurrency model never reaches
 * this.
 */
export async function appendRound(
  cwd: string,
  slug: Slug,
  kind: ArtifactKind,
  sessionStartedAt: string,
  round: Omit<AutofixRound, 'round'>,
): Promise<AutofixLedger> {
  const prior = await readLedger(cwd, slug, kind, sessionStartedAt);
  const rounds = prior ? [...prior.rounds] : [];
  const next: AutofixLedger = {
    slug,
    kind,
    sessionStartedAt,
    rounds: [...rounds, { ...round, round: rounds.length + 1 }],
  };
  await mkdir(ledgerDir(cwd), { recursive: true });
  await writeJsonAtomic(ledgerPath(cwd, slug, kind), next);
  return next;
}

/** Raised when `cr autofix record` has no round to annotate. */
export class NoRoundForHeadError extends Error {
  readonly headSha: string;

  constructor(headSha: string) {
    super(
      `no recorded round for head ${headSha || '(unknown)'} — ` +
        `cr orchestrate appends the round entry, so record must follow a dispatch`,
    );
    this.name = 'NoRoundForHeadError';
    this.headSha = headSha;
  }
}

/**
 * Write the seam's counts onto the round it reviewed, identified by `headSha`.
 *
 * `cr orchestrate` is the only appender; `record` runs after a fix and annotates.
 * Two appending writers would have needed a deduplication key, and the only one
 * available does not work — `record` fingerprints the blockers it just FIXED
 * while orchestrate fingerprints the NEXT round's, so a `(headSha, fingerprint)`
 * pair matches only in the no-progress case, and an auto-fix cycle would burn
 * two entries of a three-entry budget.
 *
 * `headSha` is re-pointed to `patch.headSha` (the post-fix tip) because two
 * readers depend on an entry's head meaning "the tip after this round's fix":
 * `resolveBaseSha`'s ledger rung and `record`'s own `diffRange` rung.
 *
 * Throws {@link NoRoundForHeadError} rather than no-op'ing: a silent miss would
 * lose the applied/deferred counts that `prior-deferred` reads, and a guard
 * resting on a count that was never written is a guard that never fires.
 */
export async function annotateRound(
  cwd: string,
  slug: Slug,
  kind: ArtifactKind,
  sessionStartedAt: string,
  reviewedHead: string,
  patch: Pick<AutofixRound, 'fixHeadSha' | 'applied' | 'deferred' | 'diffStat'> &
    Partial<Pick<AutofixRound, 'diffRange' | 'stopped'>>,
): Promise<AutofixLedger> {
  const prior = await readLedger(cwd, slug, kind, sessionStartedAt);
  const target = roundForHead(prior, reviewedHead);
  if (!prior || !target) throw new NoRoundForHeadError(reviewedHead);
  const next: AutofixLedger = {
    ...prior,
    rounds: prior.rounds.map((r) => (r.round === target.round ? { ...r, ...patch } : r)),
  };
  await mkdir(ledgerDir(cwd), { recursive: true });
  await writeJsonAtomic(ledgerPath(cwd, slug, kind), next);
  return next;
}

/**
 * Rename a malformed ledger aside so the NEXT session starts a fresh series
 * instead of hitting the same wall. Session scoping alone cannot do this: the
 * parse throws before `sessionStartedAt` can be compared, and the gate's
 * clean-exit cleanup never ran precisely because the session that corrupted the
 * file did not exit clean.
 *
 * Returns the quarantine path on success, `null` when the rename itself failed
 * — the caller still exits non-zero either way, so a failed quarantine costs
 * the self-heal, not correctness.
 */
export async function quarantineLedger(
  cwd: string,
  slug: Slug,
  kind: ArtifactKind,
): Promise<string | null> {
  const dest = quarantinePath(cwd, slug, kind);
  try {
    await rename(ledgerPath(cwd, slug, kind), dest);
    return dest;
  } catch {
    return null;
  }
}
