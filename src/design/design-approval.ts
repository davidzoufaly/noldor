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

import { mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { z } from 'zod';

import { atomicWriteFileSync } from '../core/atomic-write.js';
import { parseReceiptWith } from '../core/blob-id.js';
import { errMessage } from '../core/err-message.js';
import { parseSlug } from '../core/slug.js';
import { slugPath, pathErrorMessage } from '../core/slug-paths.js';

/** Directory holding the per-design records, relative to the repo root. */
export const APPROVAL_DIR_SEGMENTS = ['.noldor', 'design-approval'] as const;

const gitOid = z.string().regex(/^[0-9a-f]{40}$|^[0-9a-f]{64}$/);

/**
 * Strict on both members, like `uiCaptureReceiptSchema`: an unknown field
 * means writer and reader disagree about what the record means. `surfaces` is
 * descriptive metadata, not a verified claim — the authoritative set is the
 * `FINAL:` pages inside an encrypted file no check can read — so the schema
 * requires non-empty and nothing more (dedup is the writer's job).
 */
export const designApprovalRecordSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('approved'),
      at: z.string().min(1),
      penBlob: gitOid,
      surfaces: z.array(z.string().min(1)).nonempty(),
      reservation: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal('waived'),
      at: z.string().min(1),
      penBlob: gitOid,
      reason: z.string().min(1),
    })
    .strict(),
]);

export type DesignApprovalRecord = z.infer<typeof designApprovalRecordSchema>;

/** `<stem>.json` basename for a feature `.pen` basename; the 1:1 record name. */
export function approvalRecordName(penBasename: string): string {
  return `${basename(penBasename, '.pen')}.json`;
}

/** Record path relative to the repo root, for git pathspecs and staged-set lookups. */
export function approvalRelPath(penBasename: string): string {
  return `${APPROVAL_DIR_SEGMENTS.join('/')}/${approvalRecordName(penBasename)}`;
}

/**
 * Guarded absolute path of a design's record. The stem is derived from a
 * caller-supplied `--pen` argument, so it is resolved to a {@link Slug} and
 * routed through {@link slugPath} — the repo's containment choke point —
 * before it ever reaches the filesystem (Q-0097 discipline: never build a
 * path from an unvalidated argument).
 */
export function approvalPath(
  repoRoot: string,
  penBasename: string,
): { ok: true; path: string } | { ok: false; message: string } {
  const parsed = parseSlug(basename(penBasename, '.pen'));
  if (!parsed.ok) return { ok: false, message: parsed.error.message };
  const built = slugPath(repoRoot, [...APPROVAL_DIR_SEGMENTS], parsed.slug, { suffix: '.json' });
  return built.ok
    ? { ok: true, path: built.path }
    : { ok: false, message: pathErrorMessage(built.error) };
}

/**
 * Record bytes → validated record, or `null` for anything unusable. One parse
 * policy for every reader — the guard (staged or HEAD bytes), the lane
 * (review-head bytes) and the disk read below — so "absent" and "malformed"
 * collapse to the same refusal everywhere instead of drifting per call site.
 */
export function parseApprovalBytes(bytes: Buffer | string): DesignApprovalRecord | null {
  return parseReceiptWith((value) => designApprovalRecordSchema.safeParse(value), bytes);
}

/**
 * A design's record as it sits on disk, or `null` when there is no usable one
 * (absent, unreadable, unparseable, schema mismatch — deliberately collapsed;
 * every caller degrades a `null` the same way).
 */
export function readApproval(repoRoot: string, penBasename: string): DesignApprovalRecord | null {
  const path = approvalPath(repoRoot, penBasename);
  if (!path.ok) return null;
  try {
    return parseApprovalBytes(readFileSync(path.path));
  } catch {
    return null;
  }
}

/**
 * Write a design's record. Atomic (temp + rename) because the pre-commit guard
 * reads the directory a concurrent verdict may be writing. An existing record
 * for the same stem is OVERWRITTEN: re-taking the verdict on a revised design
 * is the normal remedy for a stale record, and refuse-if-exists would make
 * that state unrecoverable.
 */
export function writeApproval(
  repoRoot: string,
  penBasename: string,
  record: DesignApprovalRecord,
): { ok: true; path: string } | { ok: false; message: string } {
  const path = approvalPath(repoRoot, penBasename);
  if (!path.ok) return path;
  try {
    // The atomic write puts its temp file beside the target, so the directory
    // has to exist first — on a repo recording its first verdict it does not.
    mkdirSync(dirname(path.path), { recursive: true });
    atomicWriteFileSync(path.path, `${JSON.stringify(record, null, 2)}\n`);
  } catch (err) {
    // The filesystem is the boundary this function owns and it advertises a
    // result type; EACCES/ENOSPC surface as a failed verdict, not a crash.
    return { ok: false, message: `could not write ${path.path}: ${errMessage(err)}` };
  }
  return { ok: true, path: path.path };
}
