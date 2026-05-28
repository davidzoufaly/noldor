import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import matter from 'gray-matter';

const TAG_RE = /^\/\/\s*@tests:\s*(.+?)\s*$/m;
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.git']);

/**
 * A test file path paired with the feature slugs it tagged via `// @tests:`.
 */
export interface TaggedTest {
  path: string;
  tags: string[];
}

/**
 * Extract the slug list from a test file's first `// @tests:` comment.
 * Returns an empty array when no tag comment is present.
 *
 * @param content - Raw text content of the test file
 * @returns The list of tagged feature slugs
 */
export function extractTags(content: string): string[] {
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
 * Group test-file paths by the slug(s) they tag, producing a map suitable for
 * writing back into feature MD `links.tests` arrays.
 *
 * @param tagged - Test files paired with their extracted tags
 * @returns A map from feature slug to the (sorted, deduped) list of test paths
 */
export function buildSlugToTestsMap(tagged: TaggedTest[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const { path, tags } of tagged) {
    for (const slug of tags) {
      const existing = map.get(slug) ?? [];
      existing.push(path);
      map.set(slug, existing);
    }
  }
  for (const [slug, paths] of map) {
    map.set(slug, [...new Set(paths)].toSorted());
  }
  return map;
}

async function walkTests(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') {
      continue;
    }
    if (EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkTests(full, out);
    } else if (TEST_FILE_RE.test(entry.name)) {
      out.push(full);
    }
  }
}

async function collectTaggedTests(repoRoot: string): Promise<TaggedTest[]> {
  const files: string[] = [];
  await walkTests(repoRoot, files);
  const tagged: TaggedTest[] = [];
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const tags = extractTags(content);
    tagged.push({ path: relative(repoRoot, file), tags });
  }
  return tagged;
}

async function updateFeatureMd(path: string, testsForFeature: string[]): Promise<boolean> {
  const raw = await readFile(path, 'utf8');
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const links = (data.links as Record<string, unknown> | undefined) ?? {};
  const current = Array.isArray(links.tests) ? (links.tests as string[]) : [];

  const nextSorted = [...testsForFeature].toSorted();
  const currentSorted = [...current].toSorted();
  const same =
    currentSorted.length === nextSorted.length &&
    currentSorted.every((v, i) => v === nextSorted[i]);
  if (same) {
    return false;
  }

  links.tests = nextSorted;
  data.links = links;
  const next = matter.stringify(parsed.content.replace(/^\n/, ''), data);
  await writeFile(path, next, 'utf8');
  return true;
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const tagged = await collectTaggedTests(repoRoot);
  const map = buildSlugToTestsMap(tagged);

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
        console.warn(`WARN: @tests: "${slug}" referenced but ${featureMd} does not exist.`);
      } else {
        throw error;
      }
    }
  }

  console.log(
    `Scanned ${tagged.length} test file(s), wrote links.tests on ${updated} feature MD(s).`,
  );
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('sync-test-links');
if (invokedDirect) {
  void main();
}
