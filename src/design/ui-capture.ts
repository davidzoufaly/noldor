// @tests: pendev-ui-design-phase
// The UI-capture receipt: one file per surface at
// `.noldor/ui-capture/<surface>.json`, written ONLY by a capture that exited 0.
//
// Two proofs live here and they answer different questions. ORDERING is the
// file's own commit — `git log -1 -- <receipt>` — which advances only on a
// successful capture and, unlike a stored sha, is recomputed in whatever
// history is present (this repo squash-merges every PR, so a branch sha would
// be unreachable in a fresh clone and the check would degrade to `skipped`
// forever). BINDING is `baselineDigest`: without it an operator could commit
// the freshly written receipt while leaving the regenerated `.pen` out of the
// commit, and the surface would read `fresh` over a baseline HEAD never got.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { z } from 'zod';

import { dirname } from 'node:path';

import { atomicWriteFileSync } from '../core/atomic-write.js';
import { parseSlug } from '../core/slug.js';
import { slugPath, pathErrorMessage } from '../core/slug-paths.js';

/** Directory holding the per-surface receipts, relative to the repo root. */
export const RECEIPT_DIR_SEGMENTS = ['.noldor', 'ui-capture'] as const;

export const uiCaptureReceiptSchema = z
  .object({
    capturedAt: z.string().min(1),
    /** sha256 of the `.pen` the capture produced, lowercase hex. */
    baselineDigest: z.string().regex(/^[0-9a-f]{64}$/),
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

/** sha256 of `bytes`, lowercase hex — the `baselineDigest` encoding. */
export function digestBytes(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
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
    const parsed = uiCaptureReceiptSchema.safeParse(JSON.parse(readFileSync(path.path, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
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
  // The atomic write puts its temp file beside the target, so the directory has
  // to exist first — on a repo capturing its first surface it does not.
  mkdirSync(dirname(path.path), { recursive: true });
  atomicWriteFileSync(path.path, `${JSON.stringify(receipt, null, 2)}\n`);
  return { ok: true, path: path.path };
}
