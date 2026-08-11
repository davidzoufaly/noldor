// @fd: dynamic-fd-file-pointers-via-frontmatter

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import matter from 'gray-matter';

import { scanRoots } from '../core/repo-paths.js';

const TAG_RE = /^\/\/\s*@fd:\s*(.+?)\s*$/m;
const CODE_FILE_RE = /\.(ts|tsx|js|jsx)$/;
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.git', '__tests__']);

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

// Compatibility re-export: the provider moved to src/core/repo-paths.ts
// (single definition). Existing importers keep this path; new code should
// import from '../core/repo-paths.js' directly.
export { scanRoots };

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
 * they neither count as drift nor get dropped. An FD that {@link projectLinksCode}
 * would refuse to rewrite is not drift either: reporting it would claim a
 * staleness that `sync code-links` deliberately declines to fix, so `--check`
 * would go permanently red on every untagged consumer with no command able to
 * clear it. {@link taglessKeptSlugs} surfaces those FDs instead.
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
    const current = cached.get(slug) ?? [];
    if (projectLinksCode(want, current).skipped) continue;
    const have = current.filter((p) => !isDirEntry(p)).toSorted();
    if (want.length !== have.length || want.some((v, i) => v !== have[i])) {
      drift.push({ slug, scanned: want, cached: current });
    }
  }
  return drift;
}

/**
 * The FDs a plain `sync code-links` run would leave alone: no `// @fd:` tag
 * matched them, yet their `links.code` still holds file entries. Keeps the
 * `--check` report honest about what the write path skips.
 *
 * @param scanned - slug → code paths derived from `// @fd:` tags
 * @param cached - slug → current `links.code` arrays
 * @returns The affected slugs, sorted
 */
export function taglessKeptSlugs(
  scanned: Map<string, string[]>,
  cached: Map<string, string[]>,
): string[] {
  const kept: string[] = [];
  for (const [slug, current] of cached) {
    if (projectLinksCode(scanned.get(slug) ?? [], current).skipped) kept.push(slug);
  }
  return kept.toSorted();
}

/**
 * What the scan projects onto one FD's `links.code` — either the array to write
 * or a refusal to write it at all.
 */
export type LinksCodeProjection = { skipped: true } | { skipped: false; next: string[] };

/**
 * Project one FD's scanned tags onto its cached `links.code`, guarding the
 * total-wipe case. Directory entries are always preserved (a tag can't live on
 * a directory), and a scan that matched no tags never clears a cache that still
 * holds file entries unless `force` says so — that combination is the signature
 * of a consumer repo with no `// @fd:` tags at all, where an unguarded write
 * silently erases every hand-curated `links.code` array in one run.
 *
 * @param scanned - Code paths this FD's `// @fd:` tags produced (possibly empty)
 * @param current - The FD's existing `links.code` array
 * @param force - Clear file entries even when the scan matched nothing
 * @returns The array to write, or `{ skipped: true }` when the write is refused
 */
export function projectLinksCode(
  scanned: string[],
  current: string[],
  force = false,
): LinksCodeProjection {
  const dirs = current.filter(isDirEntry);
  if (scanned.length === 0 && !force && current.length > dirs.length) {
    return { skipped: true };
  }
  return { skipped: false, next: [...new Set([...scanned, ...dirs])].toSorted() };
}

/** Whether an FD was rewritten, left alone, or protected from a total wipe. */
type UpdateOutcome = 'updated' | 'unchanged' | 'skipped';

async function updateFeatureMd(
  path: string,
  codeForFeature: string[],
  force: boolean,
): Promise<UpdateOutcome> {
  const raw = await readFile(path, 'utf8');
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const links = (data.links as Record<string, unknown> | undefined) ?? {};
  const current = Array.isArray(links.code) ? (links.code as string[]) : [];
  const projection = projectLinksCode(codeForFeature, current, force);
  if (projection.skipped) {
    return 'skipped';
  }
  const nextSorted = projection.next;
  const currentSorted = [...current].toSorted();
  if (
    currentSorted.length === nextSorted.length &&
    currentSorted.every((v, i) => v === nextSorted[i])
  ) {
    return 'unchanged';
  }
  links.code = nextSorted;
  data.links = links;
  await writeFile(path, matter.stringify(parsed.content.replace(/^\n/, ''), data), 'utf8');
  return 'updated';
}

/** Load each FD's current `links.code` array, keyed by slug, from `featuresDir`. */
export async function loadCachedCode(featuresDir: string): Promise<Map<string, string[]>> {
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

/**
 * Print the FDs the write path leaves alone. Both branches route through this
 * so `--check` and a plain run describe the same set the same way, on stdout —
 * it is a state of the repo, not a failure.
 */
function reportTaglessKept(kept: string[]): void {
  if (kept.length === 0) return;
  for (const slug of kept) {
    console.log(`  ${slug}: skipped (no tags, existing links kept)`);
  }
  console.log(
    `${kept.length} FD(s) kept their existing links.code — no \`// @fd:\` tag matched them. ` +
      'Tag the sources, or re-run with `--force` to clear those arrays.',
  );
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const force = process.argv.includes('--force');
  const repoRoot = process.cwd();
  const featuresDir = join('docs', 'features');
  const scanned = buildSlugToCodeMap(await collectTaggedCode(repoRoot));

  if (check) {
    const cached = await loadCachedCode(featuresDir);
    const drift = diffProjection(scanned, cached);
    reportTaglessKept(taglessKeptSlugs(scanned, cached));
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

  // Drive the write from the union of scanned + cached slugs. A slug whose
  // `// @fd:` tags were all removed survives only in `cached`; iterating it with
  // an empty path list is what lets `--force` clear the stale file entries (dir
  // entries are preserved). Clearing needs `--force` because the same code path,
  // run in a repo with no `// @fd:` tags anywhere, would otherwise wipe every
  // FD's curated links.code — so without the flag those FDs are reported and
  // left alone, and `diffProjection` excludes them for the same reason.
  const cached = await loadCachedCode(featuresDir);
  const slugs = new Set([...scanned.keys(), ...cached.keys()]);
  let updated = 0;
  const skipped: string[] = [];
  for (const slug of [...slugs].toSorted()) {
    const featureMd = join(featuresDir, `${slug}.md`);
    const paths = scanned.get(slug) ?? [];
    try {
      const outcome = await updateFeatureMd(featureMd, paths, force);
      if (outcome === 'updated') updated += 1;
      if (outcome === 'skipped') skipped.push(slug);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(`WARN: @fd: "${slug}" referenced but ${featureMd} does not exist.`);
      } else {
        throw error;
      }
    }
  }
  console.log(`Scanned tagged code, wrote links.code on ${updated} feature MD(s).`);
  reportTaglessKept(skipped);
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('sync-code-links');
if (invokedDirect) {
  void main();
}
