// @tests: pendev-ui-design-phase
// The UI-capture receipt: one file per surface at
// `.noldor/ui-capture/<surface>.json`, written ONLY by a capture that exited 0.
//
// Two proofs live here and they answer different questions. ORDERING is the
// file's own commit — `git log -1 -- <receipt>` — which advances only on a
// successful capture and, unlike a stored sha, is recomputed in whatever
// history is present (this repo squash-merges every PR, so a branch sha would
// be unreachable in a fresh clone and the check would degrade to `skipped`
// forever). BINDING is `baselineBlob`: without it an operator could commit
// the freshly written receipt while leaving the regenerated `.pen` out of the
// commit, and the surface would read `fresh` over a baseline HEAD never got.

import { mkdirSync, readFileSync } from 'node:fs';
import { z } from 'zod';

import { dirname } from 'node:path';

import { atomicWriteFileSync } from '../core/atomic-write.js';
import { blobIdOfWorktreeFile, parseReceiptWith } from '../core/blob-id.js';
import { errMessage } from '../core/err-message.js';
import { parseSlug } from '../core/slug.js';
import { slugPath, pathErrorMessage } from '../core/slug-paths.js';

// Re-exported from `core/blob-id.ts` (its home since Q-0196 lifted it for the
// design-approval record) so this module's existing consumers keep their import.
export { blobIdOfWorktreeFile };

/** Directory holding the per-surface receipts, relative to the repo root. */
export const RECEIPT_DIR_SEGMENTS = ['.noldor', 'ui-capture'] as const;

export const uiCaptureReceiptSchema = z
  .object({
    capturedAt: z.string().min(1),
    /**
     * Git's own object id for the `.pen` the capture produced — 40 hex under
     * sha1, 64 under a sha256 repo.
     *
     * Git's id, not a sha256 over the file's bytes, because the comparison at
     * verdict time is against the blob git STORED. Any transform between
     * working tree and object store — `core.autocrlf` (on by default in
     * Git-for-Windows), a `text=auto` attribute, a clean filter, LFS — would
     * make a raw byte hash differ from the stored blob permanently, minting a
     * blocking `stale` that no re-capture can clear. Both sides are computed by
     * git, so both see the same transforms.
     */
    baselineBlob: z.string().regex(/^[0-9a-f]{40}$|^[0-9a-f]{64}$/),
    command: z.string().min(1),
  })
  .strict();

export type UiCaptureReceipt = z.infer<typeof uiCaptureReceiptSchema>;

/**
 * Guarded path of a surface's receipt. The surface name is resolved to a
 * {@link Slug} and routed through {@link slugPath} — the repo's containment
 * choke point — before it ever reaches the filesystem. Config keys already
 * match `SURFACE_NAME_RE`, which admits no separators or `..`; this is the
 * second lock, not the first.
 */
export function receiptPath(
  repoRoot: string,
  surface: string,
): { ok: true; path: string } | { ok: false; message: string } {
  const parsed = parseSlug(surface);
  if (!parsed.ok) return { ok: false, message: parsed.error.message };
  const built = slugPath(repoRoot, [...RECEIPT_DIR_SEGMENTS], parsed.slug, { suffix: '.json' });
  return built.ok
    ? { ok: true, path: built.path }
    : { ok: false, message: pathErrorMessage(built.error) };
}

/** Path of a surface's receipt relative to the repo root, for `git log` pathspecs. */
export function receiptRelPath(surface: string): string {
  return `${RECEIPT_DIR_SEGMENTS.join('/')}/${surface}.json`;
}

/**
 * A surface's receipt as it sits on disk, or `null` when there is no usable one
 * (absent, unreadable, unparseable, schema mismatch). `null` is deliberately
 * indistinguishable across those causes at THIS layer: the evaluator turns an
 * unreadable receipt into `skipped`, never into a blocking verdict, so no
 * caller needs to tell them apart. Absence is answered by the caller's own
 * HEAD probe, not by this function.
 */
export function readReceipt(repoRoot: string, surface: string): UiCaptureReceipt | null {
  const path = receiptPath(repoRoot, surface);
  if (!path.ok) return null;
  try {
    return parseReceiptBytes(readFileSync(path.path));
  } catch {
    return null;
  }
}

/**
 * Receipt bytes → validated receipt, or `null` for anything unusable. Lives
 * beside the schema so the freshness evaluator — which reads the blob out of
 * HEAD rather than off disk — shares one parse policy instead of carrying a
 * second copy that can drift from this one.
 *
 * The causes are deliberately collapsed: every one of them degrades to
 * `skipped` at the verdict, so no caller needs a truncated file told apart from
 * a schema mismatch.
 */
export function parseReceiptBytes(bytes: Buffer | string): UiCaptureReceipt | null {
  return parseReceiptWith((value) => uiCaptureReceiptSchema.safeParse(value), bytes);
}

/**
 * Write a surface's receipt. Atomic (temp + rename) because the freshness
 * readers and a concurrent capture of another surface share the directory, and
 * a torn receipt is exactly the failure class this feature exists to remove.
 * One file per surface means there is no read-merge-write and no other
 * surface's entry to lose.
 */
export function writeReceipt(
  repoRoot: string,
  surface: string,
  receipt: UiCaptureReceipt,
): { ok: true; path: string } | { ok: false; message: string } {
  const path = receiptPath(repoRoot, surface);
  if (!path.ok) return path;
  try {
    // The atomic write puts its temp file beside the target, so the directory
    // has to exist first — on a repo capturing its first surface it does not.
    mkdirSync(dirname(path.path), { recursive: true });
    atomicWriteFileSync(path.path, `${JSON.stringify(receipt, null, 2)}\n`);
  } catch (err) {
    // The filesystem is the boundary this function owns, and it advertises a
    // result type: letting EACCES or ENOSPC escape would abort a whole
    // multi-surface capture on one unwritable receipt instead of recording that
    // surface as failed and continuing with the rest.
    return { ok: false, message: `could not write ${path.path}: ${errMessage(err)}` };
  }
  return { ok: true, path: path.path };
}
