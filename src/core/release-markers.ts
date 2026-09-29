import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import matter from 'gray-matter';

/**
 * Fill the `introduced` field on a Noldor page's frontmatter when missing.
 *
 * Differs from `src/release/release-markers.ts` (FD-only, phase=done-gated):
 * Noldor pages have no `phase` field. Per-page change history lives in
 * `git log --follow`; there is no `updated` semantics.
 *
 * @param md - Raw page contents
 * @param newVersion - Version being released (without the `v` prefix)
 * @returns The (possibly updated) page contents
 */
export function fillNoldorMarker(md: string, newVersion: string): string {
  const parsed = matter(md);
  // Copy before mutating: gray-matter caches parses by input string, so writing
  // into `parsed.data` would make an identical twin read as already stamped.
  const data = { ...(parsed.data as Record<string, unknown>) };

  if (data.introduced !== undefined) {
    return md;
  }

  data.introduced = newVersion;
  return matter.stringify(parsed.content.replace(/^\n/, ''), data);
}

/** Noldor page roots the release stamps: the pages and their `templates/` twins. */
export const NOLDOR_PAGE_DIRS = ['docs/noldor', 'templates/docs/noldor'] as const;

/**
 * Walk every Noldor page root, fill `introduced` on any page lacking it, and
 * write modified files back in place.
 *
 * The `templates/docs/noldor/` twin is stamped in the same pass so a page and
 * its twin stay byte-identical and `check-template-sync` accepts the release
 * commit. A consumer repo has no `templates/` tree; a missing root is skipped.
 *
 * @param newVersion - Version being released (without the `v` prefix)
 * @param cwd - Repo root the page roots resolve against
 * @returns Repo-relative paths of pages that were rewritten
 */
export async function fillAllNoldorMarkers(newVersion: string, cwd = '.'): Promise<string[]> {
  const touched: string[] = [];

  for (const dir of NOLDOR_PAGE_DIRS) {
    const names = await readdir(join(cwd, dir)).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return [];
      throw err;
    });
    for (const path of names.filter((n) => n.endsWith('.md')).map((n) => join(dir, n))) {
      const original = await readFile(join(cwd, path), 'utf8');
      const updated = fillNoldorMarker(original, newVersion);
      if (updated === original) continue;
      await writeFile(join(cwd, path), updated, 'utf8');
      touched.push(path);
    }
  }

  return touched;
}
