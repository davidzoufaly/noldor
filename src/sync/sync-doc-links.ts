import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import matter from 'gray-matter';

const TAG_RE = /<!--\s*@feature:\s*(.+?)\s*-->/m;
const DOC_DIRS = ['docs/user/tutorials', 'docs/user/explanation', 'docs/user/how-to'];

/**
 * A doc file path paired with the feature slugs it tagged via `<!-- @feature: -->`.
 */
export interface TaggedDoc {
  path: string;
  tags: string[];
}

/**
 * Extract the slug list from a doc file's first `<!-- @feature: -->` comment.
 * Returns an empty array when no tag is present.
 *
 * @param content - Raw doc contents
 * @returns The list of tagged feature slugs
 */
export function extractFeatureTags(content: string): string[] {
  const match = content.match(TAG_RE);
  if (!match) {
    return [];
  }
  return match[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Group doc paths by tagged slug for writing back into feature MD `links.docs`.
 *
 * @param tagged - Doc files paired with their extracted tags
 * @returns A map from feature slug to the (sorted, deduped) list of doc paths
 */
export function buildSlugToDocsMap(tagged: TaggedDoc[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const { path, tags } of tagged) {
    for (const slug of tags) {
      const list = map.get(slug) ?? [];
      list.push(path);
      map.set(slug, list);
    }
  }
  for (const [slug, paths] of map) {
    map.set(slug, [...new Set(paths)].toSorted());
  }
  return map;
}

async function listMd(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => join(dir, e.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function collectTaggedDocs(repoRoot: string): Promise<TaggedDoc[]> {
  const tagged: TaggedDoc[] = [];
  for (const dir of DOC_DIRS) {
    const files = await listMd(dir);
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      const tags = extractFeatureTags(content);
      tagged.push({ path: relative(repoRoot, file), tags });
    }
  }
  return tagged;
}

async function updateFeatureMd(path: string, docsForFeature: string[]): Promise<boolean> {
  const raw = await readFile(path, 'utf8');
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const links = (data.links as Record<string, unknown> | undefined) ?? {};
  const current = Array.isArray(links.docs) ? (links.docs as string[]) : [];

  const next = [...docsForFeature].toSorted();
  const sortedCurrent = [...current].toSorted();
  const same = sortedCurrent.length === next.length && sortedCurrent.every((v, i) => v === next[i]);
  if (same) {
    return false;
  }

  links.docs = next;
  data.links = links;
  await writeFile(path, matter.stringify(parsed.content.replace(/^\n/, ''), data), 'utf8');
  return true;
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const tagged = await collectTaggedDocs(repoRoot);
  const map = buildSlugToDocsMap(tagged);

  let updated = 0;
  for (const [slug, paths] of map) {
    const featureMd = join('docs', 'features', `${slug}.md`);
    try {
      const changed = await updateFeatureMd(featureMd, paths);
      if (changed) {
        updated += 1;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        console.warn(`WARN: @feature: "${slug}" referenced but ${featureMd} does not exist.`);
      } else {
        throw error;
      }
    }
  }

  console.log(
    `Scanned ${tagged.length} doc file(s), wrote links.docs on ${updated} feature MD(s).`,
  );
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('sync-doc-links');
if (invokedDirect) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
