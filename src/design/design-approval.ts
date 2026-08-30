// @tests: pendev-ui-design-phase
// The design-approval record: one file per design artifact at
// `.noldor/design-approval/<pen-stem>.json`, written only by the verdict step
// of /noldor-spec step 1.5 (via `design verdict`). A discriminated union on
// `outcome`, because a UI-bearing session has two legitimate ways to commit a
// `.pen` — ratified, or explicitly waived when the editor was unreachable —
// and both need a tree-visible trace. `penBlob` binds the record to the exact
// blob the verdict covered, so an edit after the verdict invalidates it and an
// archive `git mv` (tree entry, not blob) does not.
//
// Keyed by the `.pen` STEM, not the dialogue key: the key is not injective —
// two sessions on the same parent+enhancement produce two dated `.pen` files
// sharing one key, and a key-addressed record would let the later verdict
// silently overwrite the earlier archived design's only record.

import { basename } from 'node:path';
import { z } from 'zod';

import { parseReceiptWith } from '../core/blob-id.js';
import { writeReceiptFile } from '../core/receipt-store.js';

/** Directory holding the per-design records, relative to the repo root. */
export const APPROVAL_DIR_SEGMENTS = ['.noldor', 'design-approval'] as const;

const gitOid = z.string().regex(/^[0-9a-f]{40}$|^[0-9a-f]{64}$/);
/** Whitespace-only text passes `.min(1)`; a blank reason/surface is no record at all. */
const nonBlank = z.string().refine((s) => s.trim().length > 0, 'must not be blank');

/**
 * Strict on both members, like `uiCaptureReceiptSchema`: an unknown field
 * means writer and reader disagree about what the record means. `surfaces` is
 * descriptive metadata, not a verified claim — the authoritative set is the
 * `FINAL:` pages inside an encrypted file no check can read — so the schema
 * requires non-empty, non-blank and duplicate-free and nothing more.
 */
export const designApprovalRecordSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('approved'),
      at: z.string().datetime(),
      penBlob: gitOid,
      surfaces: z
        .array(nonBlank)
        .nonempty()
        .refine((s) => new Set(s).size === s.length, 'duplicate surfaces'),
      reservation: nonBlank.optional(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal('waived'),
      at: z.string().datetime(),
      penBlob: gitOid,
      reason: nonBlank,
    })
    .strict(),
]);

export type DesignApprovalRecord = z.infer<typeof designApprovalRecordSchema>;

/** Record path relative to the repo root, for git pathspecs and staged-set lookups. */
export function approvalRelPath(penBasename: string): string {
  return `${APPROVAL_DIR_SEGMENTS.join('/')}/${basename(penBasename, '.pen')}.json`;
}

/**
 * Record bytes → validated record, or `null` for anything unusable. One parse
 * policy for every reader — the guard (staged or HEAD bytes) and the lane
 * (review-head bytes) — so "absent" and "malformed" collapse to the same
 * refusal everywhere instead of drifting per call site.
 *
 * Deliberately no disk-read companion: both production readers take record
 * bytes out of git (the index or a tree), never off the working tree, so a
 * `readApproval(repoRoot, ...)` would be API surface nothing needs.
 */
export function parseApprovalBytes(bytes: Buffer | string): DesignApprovalRecord | null {
  return parseReceiptWith((value) => designApprovalRecordSchema.safeParse(value), bytes);
}

/**
 * Write a design's record (atomic, slug-contained; see the receipt store —
 * the stem comes from a caller-supplied `--pen` argument, Q-0097 discipline).
 * An existing record for the same stem is OVERWRITTEN: re-taking the verdict
 * on a revised design is the normal remedy for a stale record, and
 * refuse-if-exists would make that state unrecoverable.
 */
export function writeApproval(
  repoRoot: string,
  penBasename: string,
  record: DesignApprovalRecord,
): { ok: true; path: string } | { ok: false; message: string } {
  return writeReceiptFile(repoRoot, APPROVAL_DIR_SEGMENTS, basename(penBasename, '.pen'), record);
}
