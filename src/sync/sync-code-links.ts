// @fd: dynamic-fd-file-pointers-via-frontmatter

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import matter from 'gray-matter';

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

/** One stale FD: its cached array vs. what the scan would write. */
export interface ProjectionDrift {
  slug: string;
  scanned: string[];
  cached: string[];
}

/** A directory entry (no file extension and no trailing tag) is left untouched. */
function isDirEntry(p: string): boolean {
  return !CODE_FILE_RE.test(p);
}

/**
 * Compare the scanned projection against the cached `links.code` of each FD.
 * Directory entries in the cache are preserved (a tag can't live on a dir), so
 * they neither count as drift nor get dropped.
 *
 * @param scanned - slug → code paths derived from `// @fd:` tags
 * @param cached - slug → current `links.code` arrays
 * @returns One ProjectionDrift per FD whose file-level cache != scan
 */
export function diffProjection(
  scanned: Map<string, string[]>,
  cached: Map<string, string[]>,
): ProjectionDrift[] {
  const drift: ProjectionDrift[] = [];
  const slugs = new Set([...scanned.keys(), ...cached.keys()]);
  for (const slug of [...slugs].toSorted()) {
    const want = (scanned.get(slug) ?? []).toSorted();
    const have = (cached.get(slug) ?? []).filter((p) => !isDirEntry(p)).toSorted();
    if (want.length !== have.length || want.some((v, i) => v !== have[i])) {
      drift.push({ slug, scanned: want, cached: cached.get(slug) ?? [] });
    }
  }
  return drift;
}

async function updateFeatureMd(path: string, codeForFeature: string[]): Promise<boolean> {
  const raw = await readFile(path, 'utf8');
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const links = (data.links as Record<string, unknown> | undefined) ?? {};
  const current = Array.isArray(links.code) ? (links.code as string[]) : [];
  // Preserve directory entries — tags can't live on directories.
  const dirs = current.filter((p) => !CODE_FILE_RE.test(p));
  const nextSorted = [...new Set([...codeForFeature, ...dirs])].toSorted();
  const currentSorted = [...current].toSorted();
  if (
    currentSorted.length === nextSorted.length &&
    currentSorted.every((v, i) => v === nextSorted[i])
  ) {
    return false;
  }
  links.code = nextSorted;
  data.links = links;
  await writeFile(path, matter.stringify(parsed.content.replace(/^\n/, ''), data), 'utf8');
  return true;
}

async function loadCachedCode(featuresDir: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  let entries: string[] = [];
  try {
    entries = (await readdir(featuresDir)).filter((f) => f.endsWith('.md'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const f of entries) {
    const parsed = matter(await readFile(join(featuresDir, f), 'utf8'));
    const links = (parsed.data.links ?? {}) as Record<string, unknown>;
    out.set(basename(f, '.md'), Array.isArray(links.code) ? (links.code as string[]) : []);
  }
  return out;
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const repoRoot = process.cwd();
  const featuresDir = join('docs', 'features');
  const scanned = buildSlugToCodeMap(await collectTaggedCode(repoRoot));

  if (check) {
    const cached = await loadCachedCode(featuresDir);
    const drift = diffProjection(scanned, cached);
    if (drift.length === 0) {
      console.log('links.code is in sync with // @fd: tags.');
      return;
    }
    for (const d of drift) {
      console.error(`\n${d.slug}: links.code stale`);
      console.error(`  scanned: ${d.scanned.join(', ') || '(none)'}`);
      console.error(`  cached:  ${d.cached.join(', ') || '(none)'}`);
    }
    console.error(
      `\n${drift.length} FD(s) have stale links.code. Run \`pnpm noldor sync code-links\`.`,
    );
    process.exitCode = 1;
    return;
  }

  let updated = 0;
  for (const [slug, paths] of scanned) {
    const featureMd = join(featuresDir, `${slug}.md`);
    try {
      if (await updateFeatureMd(featureMd, paths)) updated += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(`WARN: @fd: "${slug}" referenced but ${featureMd} does not exist.`);
      } else {
        throw error;
      }
    }
  }
  console.log(`Scanned tagged code, wrote links.code on ${updated} feature MD(s).`);
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('sync-code-links');
if (invokedDirect) {
  void main();
}
