// @fd: dynamic-fd-file-pointers-via-frontmatter

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { loadConsumerConfig } from '../core/consumer-config.js';

const TAG_RE = /^\/\/\s*@fd:\s*(.+?)\s*$/m;
const CODE_FILE_RE = /\.(ts|tsx|js|jsx)$/;
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.git', '__tests__']);
const DEFAULT_SCAN_ROOTS = ['packages', 'apps', 'scripts', 'src'];

/** A code file path paired with the FD slugs it tagged via `// @fd:`. */
export interface TaggedCode {
  path: string;
  tags: string[];
}

/**
 * Extract the slug list from a code file's first `// @fd:` comment.
 * Returns an empty array when no tag comment is present.
 *
 * @param content - Raw text content of the code file
 * @returns The list of tagged feature slugs
 */
export function extractFdTags(content: string): string[] {
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
 * Group code-file paths by the slug(s) they tag, producing a map suitable for
 * writing back into feature MD `links.code` arrays.
 *
 * @param tagged - Code files paired with their extracted tags
 * @returns A map from feature slug to the (sorted, deduped) list of code paths
 */
export function buildSlugToCodeMap(tagged: TaggedCode[]): Map<string, string[]> {
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

/** Scan roots: consumer `scanPaths` when configured, else the default roster. */
export function scanRoots(): string[] {
  const { scanPaths } = loadConsumerConfig();
  return scanPaths.length > 0 ? scanPaths : DEFAULT_SCAN_ROOTS;
}

async function walkCode(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkCode(full, out);
    } else if (CODE_FILE_RE.test(entry.name) && !TEST_FILE_RE.test(entry.name)) {
      out.push(full);
    }
  }
}

/** Walk the scan roots and pair each code file with its `// @fd:` tags. */
export async function collectTaggedCode(repoRoot: string): Promise<TaggedCode[]> {
  const files: string[] = [];
  for (const root of scanRoots()) {
    await walkCode(join(repoRoot, root), files);
  }
  const tagged: TaggedCode[] = [];
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    tagged.push({ path: relative(repoRoot, file), tags: extractFdTags(content) });
  }
  return tagged;
}
