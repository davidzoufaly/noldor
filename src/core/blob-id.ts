// @tests: pendev-ui-design-phase
// Git-blob identity helpers shared by the UI-capture receipt and the
// design-approval record. Lifted out of `design/ui-capture.ts` (Q-0196) so the
// approval record's writer, the shared-files guard and the ui-reviewer lane do
// not each re-derive the hash or a second parse policy that can drift.

import { execFileSync } from 'node:child_process';

/**
 * Git's object id for the file at `relPath`, as git would store it — filters
 * and eol conversion applied, because `--path` makes `hash-object` honour the
 * same attributes the index does. That is the whole point of hashing this way:
 * the comparison at verdict time is against the blob git STORED, and a raw
 * byte hash would diverge permanently under `core.autocrlf`, a `text=auto`
 * attribute, a clean filter, or LFS. `write` also stores the object, so the
 * text stays retrievable by that id before any commit holds it. `null` when git
 * cannot answer.
 */
export function blobIdOfWorktreeFile(
  repoRoot: string,
  relPath: string,
  opts: { write?: boolean } = {},
): string | null {
  const write = opts.write === true ? ['-w'] : [];
  try {
    return execFileSync('git', ['hash-object', ...write, '--path', relPath, '--', relPath], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

/**
 * The same attribute-aware id as {@link blobIdOfWorktreeFile}, over bytes the
 * caller already read — so the id names exactly the content the caller
 * inspected, not whatever the file holds a moment later.
 */
export function blobIdOfBytes(repoRoot: string, relPath: string, bytes: Buffer): string | null {
  try {
    return execFileSync('git', ['hash-object', '--stdin', '--path', relPath], {
      cwd: repoRoot,
      input: bytes,
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

/**
 * The lenient-read policy for a `.noldor` receipt/record: bytes → validated
 * value, or `null` for anything unusable (unparseable JSON, schema mismatch).
 * The causes are deliberately collapsed — every caller degrades a `null` the
 * same way (skipped verdict, refused commit, `design-unapproved` terminal), so
 * none needs a truncated file told apart from a schema mismatch.
 */
export function parseReceiptWith<T>(
  parse: (value: unknown) => { success: true; data: T } | { success: false },
  bytes: Buffer | string,
): T | null {
  try {
    const parsed = parse(JSON.parse(bytes.toString()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
