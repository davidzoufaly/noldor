import type { Dirent } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import matter from 'gray-matter';

import { extractSpecSlug } from '../core/fd-load.js';

/**
 * A spec file path paired with the feature slug derived from its filename.
 */
export interface TaggedSpec {
  path: string;
  slug: string;
}

/**
 * Walk `docs/design/specs/` and pair each spec MD with its derived
 * feature slug (filename without date prefix and `-design` suffix).
 *
 * @param dir - Directory containing spec MDs.
 * @returns Spec paths relative to cwd plus their derived slugs.
 */
export async function collectTaggedSpecs(dir: string): Promise<TaggedSpec[]> {
  const out: TaggedSpec[] = [];
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const slug = extractSpecSlug(entry.name);
    if (slug.length === 0) continue;
    out.push({ path: join(dir, entry.name), slug });
  }
  return out;
}

/**
 * Update a feature MD's `links.spec` field to the given path. Returns
 * true when the file was rewritten, false when the field already
 * matched.
 *
 * @param featureMdPath - Path to the feature MD.
 * @param specPath - Spec path to set as `links.spec`.
 */
export async function updateFeatureMd(featureMdPath: string, specPath: string): Promise<boolean> {
  const raw = await readFile(featureMdPath, 'utf8');
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const links = (data.links as Record<string, unknown> | undefined) ?? {};
  const current = typeof links.spec === 'string' ? links.spec : undefined;
  if (current === specPath) return false;

  links.spec = specPath;
  data.links = links;
  const next = matter.stringify(parsed.content.replace(/^\n/, ''), data);
  await writeFile(featureMdPath, next, 'utf8');
  return true;
}

async function main(): Promise<void> {
  const specs = await collectTaggedSpecs('docs/design/specs');
  let updated = 0;
  let missing = 0;
  for (const { path, slug } of specs) {
    const featureMd = join('docs', 'features', `${slug}.md`);
    try {
      const changed = await updateFeatureMd(featureMd, path);
      if (changed) updated += 1;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        missing += 1;
      } else {
        throw error;
      }
    }
  }
  const tail = missing > 0 ? ` (${missing} spec(s) had no matching feature MD)` : '';
  console.log(
    `Scanned ${specs.length} spec file(s), wrote links.spec on ${updated} feature MD(s)${tail}.`,
  );
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('sync-spec-links');
if (invokedDirect) {
  void main();
}
