// @tests: pendev-ui-design-phase
// The `.noldor` receipt-store trio shared by the UI-capture receipt and the
// design-approval record: a slug-contained path, a lenient disk read, and an
// atomic write that returns a result. Lifted (Q-0196) when the record module
// reproduced `ui-capture.ts`'s shapes verbatim — two copies of a containment
// choke point is how one of them drifts.

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { atomicWriteFileSync } from './atomic-write.js';
import { errMessage } from './err-message.js';
import { parseSlug } from './slug.js';
import { slugPath, pathErrorMessage } from './slug-paths.js';

/**
 * Guarded absolute path of a receipt keyed by `name` under `segments`. The
 * name is resolved to a {@link Slug} and routed through {@link slugPath} — the
 * repo's containment choke point — before it ever reaches the filesystem, so a
 * caller-supplied key cannot address a file outside the store.
 */
export function receiptFilePath(
  repoRoot: string,
  segments: readonly string[],
  name: string,
): { ok: true; path: string } | { ok: false; message: string } {
  const parsed = parseSlug(name);
  if (!parsed.ok) return { ok: false, message: parsed.error.message };
  const built = slugPath(repoRoot, [...segments], parsed.slug, { suffix: '.json' });
  return built.ok
    ? { ok: true, path: built.path }
    : { ok: false, message: pathErrorMessage(built.error) };
}

/**
 * A receipt as it sits on disk, or `null` when there is no usable one (absent,
 * unreadable, unparseable, schema mismatch). The causes are deliberately
 * collapsed: every caller degrades a `null` the same way, so none needs a
 * truncated file told apart from a schema mismatch.
 */
export function readReceiptFile<T>(
  repoRoot: string,
  segments: readonly string[],
  name: string,
  parseBytes: (bytes: Buffer | string) => T | null,
): T | null {
  const path = receiptFilePath(repoRoot, segments, name);
  if (!path.ok) return null;
  try {
    return parseBytes(readFileSync(path.path));
  } catch {
    return null;
  }
}

/**
 * Write a receipt. Atomic (temp + rename) because the store's readers share
 * the directory with concurrent writers and a torn receipt is exactly the
 * failure class these stores exist to remove. An existing file is overwritten.
 */
export function writeReceiptFile(
  repoRoot: string,
  segments: readonly string[],
  name: string,
  value: unknown,
): { ok: true; path: string } | { ok: false; message: string } {
  const path = receiptFilePath(repoRoot, segments, name);
  if (!path.ok) return path;
  try {
    // The atomic write puts its temp file beside the target, so the directory
    // has to exist first — on a store's first write it does not.
    mkdirSync(dirname(path.path), { recursive: true });
    atomicWriteFileSync(path.path, `${JSON.stringify(value, null, 2)}\n`);
  } catch (err) {
    // The filesystem is the boundary this function owns and it advertises a
    // result type: EACCES or ENOSPC surface as a failed write, not a crash.
    return { ok: false, message: `could not write ${path.path}: ${errMessage(err)}` };
  }
  return { ok: true, path: path.path };
}
