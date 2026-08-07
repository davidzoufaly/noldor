import { createHash } from 'node:crypto';
import { mkdir, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

import { writeJsonAtomic } from './atomic-write.js';
import { artifactKindSchema } from './findings-schema.js';
import type { ArtifactKind, Finding } from './findings-schema.js';

/**
 * Maximum auto-fix rounds per gate session, per `slug`+`kind`. A CONSTANT, not a
 * config knob: `docs/vision.md` ("opinionated, not configurable") and one
 * posture knob (`autonomous.onBlockers`) is enough. The cap is only the
 * backstop — the no-progress fingerprint stop usually fires first, because the
 * failure that matters is a blocker that keeps coming back, not merely cost.
 */
export const AUTOFIX_ROUND_CAP = 2;

export const autofixRoundSchema = z.object({
  round: z.number().int().positive(),
  /** `HEAD` when the round was recorded; the next round's `--base-sha`. May be `''` when git was unavailable. */
  headSha: z.string(),
  fingerprint: z.string().min(1),
  applied: z.number().int().nonnegative(),
  deferred: z.number().int().nonnegative(),
  diffStat: z.string(),
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
  constructor(
    readonly path: string,
    cause: unknown,
  ) {
    super(`autofix ledger at ${path} is malformed: ${(cause as Error)?.message ?? String(cause)}`);
    this.name = 'LedgerParseError';
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

/** Ledger path for a `slug`+`kind` pair. */
export function ledgerPath(cwd: string, slug: string, kind: ArtifactKind): string {
  return join(ledgerDir(cwd), `${slug}-${kind}.json`);
}

/** Quarantine path a malformed ledger is renamed to. */
export function quarantinePath(cwd: string, slug: string, kind: ArtifactKind): string {
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
  slug: string,
  kind: ArtifactKind,
  sessionStartedAt: string,
): Promise<AutofixLedger | null> {
  const path = ledgerPath(cwd, slug, kind);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
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
  slug: string,
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
  slug: string,
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
