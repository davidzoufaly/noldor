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

import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';

import { parseReceiptWith } from '../core/blob-id.js';
import { specSlugFromFilename } from '../core/design-artifact-names.js';
import { errMessage } from '../core/err-message.js';
import { writeReceiptFile } from '../core/receipt-store.js';

/** Directory holding the per-design records, relative to the repo root. */
export const APPROVAL_DIR_SEGMENTS = ['.noldor', 'design-approval'] as const;

const gitOid = z.string().regex(/^[0-9a-f]{40}$|^[0-9a-f]{64}$/);
/** Whitespace-only text passes `.min(1)`; a blank reason/surface is no record at all. */
const nonBlank = z.string().refine((s) => s.trim().length > 0, 'must not be blank');

/**
 * A spec basename every reader may join onto the specs root. The spec naming
 * scheme alone is not containment — its slug group matches `/` and `..` — so
 * separators and dot-dot runs are refused outright.
 */
const specBasename = z
  .string()
  .refine(
    (name) => !/[/\\]/.test(name) && !name.includes('..') && specSlugFromFilename(name) !== null,
    'must be a bare spec basename',
  );

/**
 * Strict on both members, like `uiCaptureReceiptSchema`: an unknown field
 * means writer and reader disagree about what the record means. `surfaces`
 * names the approved surfaces; the verdict CLI checks it against the `FINAL:`
 * pages it reads from the `.pen` before writing.
 *
 * `pages` and `spec` are optional because records written before they existed
 * must keep parsing (state-file-schema-additive); every reader owns the absent
 * branch. `spec` is one object so a name can never travel without its blob.
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
      pages: z.array(nonBlank).optional(),
      spec: z.object({ name: specBasename, blob: gitOid }).strict().optional(),
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
 * policy for every reader — the guard (staged or HEAD bytes), the lane
 * (review-head bytes) and the verdict CLI (working-tree bytes) — so "absent"
 * and "malformed" collapse to the same refusal everywhere instead of drifting
 * per call site.
 */
export function parseApprovalBytes(bytes: Buffer | string): DesignApprovalRecord | null {
  return parseReceiptWith((value) => designApprovalRecordSchema.safeParse(value), bytes);
}

/**
 * The record as the working tree holds it — `record: null` when absent or
 * unusable — or the read error, kept apart because its remedy is the disk, not
 * a new verdict. Only `design verdict --check` / `--reconfirm` read here: they
 * act on the record the CLI wrote, before any commit holds it. The guard and
 * the lane read git bytes instead.
 */
export function readApproval(
  repoRoot: string,
  penBasename: string,
): { ok: true; record: DesignApprovalRecord | null } | { ok: false; error: string } {
  const rel = approvalRelPath(penBasename);
  const path = join(repoRoot, rel);
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (err) {
    // Only ENOENT means "no record": an unreadable parent directory is a read
    // failure, and reading it as absent would send the operator to re-verdict.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, record: null };
    return { ok: false, error: `${rel}: ${errMessage(err)}` };
  }
  try {
    return { ok: true, record: parseApprovalBytes(bytes) };
  } catch (err) {
    return { ok: false, error: `${rel}: ${errMessage(err)}` };
  }
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
