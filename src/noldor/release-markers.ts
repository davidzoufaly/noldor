import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import matter from 'gray-matter';

/**
 * Fill the `introduced` field on a Noldor page's frontmatter when missing.
 *
 * Differs from `scripts/release/release-markers.ts` (FD-only, phase=done-gated):
 * Noldor pages have no `phase` field. Per-page change history lives in
 * `git log --follow`; there is no `updated` semantics.
 *
 * @param md - Raw page contents
 * @param newVersion - Version being released (without the `v` prefix)
 * @returns The (possibly updated) page contents
 */
export function fillNoldorMarker(md: string, newVersion: string): string {
  const parsed = matter(md);
  const data = parsed.data as Record<string, unknown>;

  if (data.introduced !== undefined) {
    return md;
  }

  data.introduced = newVersion;
  return matter.stringify(parsed.content.replace(/^\n/, ''), data);
}

/**
 * Walk `docs/noldor/`, fill `introduced` on any page lacking it, and
 * write modified files back in place.
 *
 * @param newVersion - Version being released (without the `v` prefix)
 * @returns Paths of pages that were rewritten
 */
export async function fillAllNoldorMarkers(newVersion: string): Promise<string[]> {
  const dir = 'docs/noldor';
  const entries = await readdir(dir, { withFileTypes: true });
  const touched: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }
    const path = join(dir, entry.name);
    const original = await readFile(path, 'utf8');
    const updated = fillNoldorMarker(original, newVersion);
    if (updated !== original) {
      await writeFile(path, updated, 'utf8');
      touched.push(path);
    }
  }

  return touched;
}
