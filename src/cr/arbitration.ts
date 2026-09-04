/**
 * The arbitration record — what a spent round cap terminates in.
 *
 * 23 of this repo's 41 unique `Noldor-Path-Override` trailers name a CR round
 * or a convergence failure, and every one of them is free text. This record is
 * the machine-readable half: the round history, the blockers left standing, the
 * signals that explain them, and one operator disposition per blocker.
 *
 * NOT tracked by git. `.gitignore` ignores `.noldor/cr/`, so the record is
 * local like the ledger and the sinks it is built from. That is what keeps its
 * tree binding non-self-referential — committing never changes the record, so
 * the tree it binds is stable — and pre-push runs in the same checkout, so the
 * file is there when the guard looks. The cost is that the record does not
 * travel with the PR; the trailer is what reaches `main`.
 */
import { createHash } from 'node:crypto';

import { z } from 'zod';

import { slugKindJsonPath } from '../core/slug-paths.js';
import type { Slug } from '../core/slug.js';
import { artifactKindSchema } from './findings-schema.js';
import type { ArtifactKind } from './findings-schema.js';

/**
 * What an operator can say about a blocker they are not fixing.
 *
 * A closed vocabulary rather than free text, because the whole point is that a
 * later reader — or a detector — can tell "I judged this wrong" from "I agree
 * and accept the debt". The `note` beside it carries the sentence.
 */
export const DISPOSITIONS = ['accepted', 'rejected', 'deferred'] as const;
export const dispositionSchema = z.enum(DISPOSITIONS);
export type Disposition = z.infer<typeof dispositionSchema>;

export const arbitrationBlockerSchema = z.object({
  /** `fingerprintBlocker` id — the same key a signal points at. */
  id: z.string().min(1),
  severity: z.enum(['high', 'med', 'low']),
  message: z.string().min(1),
  /** Every lane that filed this logical finding. One id can have several. */
  lanes: z.array(z.string().min(1)).min(1),
});

export const arbitrationRoundSchema = z.object({
  round: z.number().int().positive(),
  verdict: z.enum(['green', 'red']),
  headSha: z.string(),
});

export const arbitrationDispositionSchema = z.object({
  blockerId: z.string().min(1),
  disposition: dispositionSchema,
  note: z.string().optional(),
});

export const arbitrationRecordSchema = z
  .object({
    /** Schema version. Present from the first write so a later shape can migrate. */
    version: z.literal(1),
    slug: z.string().min(1),
    kind: artifactKindSchema,
    /**
     * `HEAD^{tree}` at the moment the cap refused — what this arbitration is
     * ABOUT. A later commit changes the tree, which is what makes the record go
     * stale rather than silently standing for work it never saw.
     */
    boundTree: z.string().min(1),
    rounds: z.array(arbitrationRoundSchema),
    blockers: z.array(arbitrationBlockerSchema),
    /** Opaque here — the detector owns their shape; this record transports them. */
    signals: z.array(z.record(z.unknown())),
    dispositions: z.array(arbitrationDispositionSchema),
  })
  .strict()
  .superRefine((rec, ctx) => {
    const ids = new Set(rec.blockers.map((b) => b.id));
    const seen = new Set<string>();
    for (const d of rec.dispositions) {
      // One disposition per blocker: an id identifies a LOGICAL finding, so the
      // operator arbitrates it once even when two lanes filed it. Two entries
      // for one id would leave "which one counts" undefined.
      if (seen.has(d.blockerId))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate disposition for blocker ${d.blockerId}`,
          path: ['dispositions'],
        });
      seen.add(d.blockerId);
      if (!ids.has(d.blockerId))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `disposition names unknown blocker ${d.blockerId}`,
          path: ['dispositions'],
        });
    }
  });
export type ArbitrationRecord = z.infer<typeof arbitrationRecordSchema>;

/**
 * Path for a `slug`+`kind` pair.
 *
 * A SUBDIRECTORY of `.noldor/cr`, and that is load-bearing: `aggregate`
 * collects every `.noldor/cr/<slug>-<kind>-*.json` regular file as a lane sink,
 * so a record named `<slug>-<kind>-arbitration.json` beside them would match
 * that glob, `inferLaneFromFilename` would return null, and a bogus
 * `non-conforming filename` HIGH blocker would land in every aggregate for the
 * pair — turning green runs red. `autofix-ledger.ts` records that exact
 * incident and its remedy; this reuses it rather than minting a second one.
 */
export function arbitrationPath(cwd: string, slug: Slug, kind: ArtifactKind): string {
  return slugKindJsonPath(cwd, ['.noldor', 'cr', 'arbitration'], slug, kind, 'arbitration record');
}

/** Every unresolved blocker carries exactly one disposition. */
export function isFilled(rec: ArbitrationRecord): boolean {
  if (rec.blockers.length === 0) return false;
  const disposed = new Set(rec.dispositions.map((d) => d.blockerId));
  return rec.blockers.every((b) => disposed.has(b.id));
}

/**
 * The record's own digest — what the trailer names and the guard re-derives.
 *
 * Canonicalised by sorting object keys before serialising, so a rewrite that
 * only reorders keys does not invalidate an arbitration. Every field is
 * included, `dispositions` explicitly: the digest is computed AFTER the operator
 * fills them, which is why nothing here is excluded. Filling in a skeleton
 * changes the digest by design — the trailer names the FILLED record.
 *
 * This does not bind the record to a tree; `boundTree` does that, and the guard
 * checks both.
 */
export function recordDigest(rec: ArbitrationRecord): string {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon);
    if (v !== null && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, canon(val)]),
      );
    return v;
  };
  return createHash('sha256')
    .update(JSON.stringify(canon(rec)))
    .digest('hex')
    .slice(0, 12);
}

/** The marker that distinguishes a structured override from a free-text one. */
export const ARBITRATION_MARKER = 'cr-arbitration';

const TRAILER_RE = new RegExp(`^${ARBITRATION_MARKER}\\s+([0-9a-f]{12})(?:\\s|$)`);

/**
 * The record digest named by a `Noldor-Path-Override` value, or `null`.
 *
 * `null` for every override written before this existed, which is what keeps
 * this additive: an unrecognised value is a free-text override, and the guard
 * decides separately whether that is acceptable here.
 */
export function parseArbitrationTrailer(value: string): string | null {
  const m = TRAILER_RE.exec(value.trim());
  return m?.[1] ?? null;
}
