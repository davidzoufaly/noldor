// @fd: feature-md-links-overhaul

import { readFile, readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import matter from 'gray-matter';

import { atomicWriteFile } from '../core/atomic-write.js';

/** Where a scan root came from, which decides whether its absence is fatal. */
export type RootOrigin = 'configured' | 'default';

/** One directory to walk, tagged with why it is in the list. */
export interface ScanRoot {
  path: string;
  origin: RootOrigin;
}

/**
 * Everything that differs between `links.code`, `links.tests` and `links.docs`.
 * The engine holds the policy; an adapter holds only the facts about its kind.
 */
export interface LinkAdapter {
  /** Destination `links.*` field. */
  key: 'code' | 'tests' | 'docs';
  /** Line-anchored tag pattern; capture group 1 is the comma-separated slug list. */
  tagRe: RegExp;
  /** Directories to walk, each labelled by origin. */
  roots: (cwd: string) => ScanRoot[];
  /** True when a filename should be read for tags. */
  eligible: (name: string) => boolean;
  /**
   * True when a cached entry is not the scan's to own, so it survives every
   * projection. Code returns true for directory entries (a tag cannot live on a
   * directory); tests and docs have no such case.
   */
  preserve: (path: string) => boolean;
  /**
   * True when a cached entry lives under a root no operator can tag — a
   * templated tree synced from the framework. Such entries are excluded from
   * the tagless-kept report, which would otherwise be a permanent notice with
   * no operator-reachable fix.
   */
  unownable: (path: string) => boolean;
  /** Human name used in warnings, e.g. `// @fd:`. */
  tagLabel: string;
}

/** A scanned file path paired with the slugs it tagged. */
export interface TaggedFile {
  path: string;
  tags: string[];
}

/**
 * Extract the slug list from a file's first tag match. Returns `[]` when the
 * file carries no tag.
 *
 * @param content - Raw file contents
 * @param tagRe - The adapter's tag pattern
 * @returns Tagged feature slugs, trimmed and non-empty
 */
export function extractTagsWith(content: string, tagRe: RegExp): string[] {
  const match = content.match(tagRe);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Group scanned paths by the slug(s) they tag.
 *
 * @param tagged - Files paired with their extracted tags
 * @returns slug → sorted, deduplicated path list
 */
export function buildSlugMap(tagged: TaggedFile[]): Map<string, string[]> {
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

/**
 * Why a scan cannot be trusted to describe the repo. An unreadable input must
 * never look like "no tags anywhere", because that is indistinguishable from a
 * repo whose tags were all deleted — and the second reading clears links.
 */
export interface ScanFailure {
  root: string;
  code: string;
}

/** One walk of one adapter's roots: what it found, and what it could not read. */
export interface ScanResult {
  tagged: TaggedFile[];
  failures: ScanFailure[];
}

async function walk(
  dir: string,
  origin: RootOrigin,
  eligible: (name: string) => boolean,
  out: string[],
  failures: ScanFailure[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    // A default root is a union-of-layouts guess (`packages`, `apps`, `src`);
    // its absence is the normal case and says nothing about the repo's tags. A
    // root the consumer named, and any root that exists but cannot be read, is
    // a real gap in the scan's coverage.
    if (code === 'ENOENT' && origin === 'default') return;
    failures.push({ root: dir, code });
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Nested dirs inherit their root's origin, but their absence is
      // impossible — readdir just listed them — so only read failures surface.
      await walk(full, origin, eligible, out, failures);
    } else if (eligible(entry.name)) {
      out.push(full);
    }
  }
}

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.git']);

/**
 * Walk one adapter's roots and pair every eligible file with its tags.
 *
 * @param adapter - The kind being scanned
 * @param repoRoot - Absolute consumer root; results are relative to it
 * @returns Tagged files plus any root the walk could not read
 */
export async function collectTagged(adapter: LinkAdapter, repoRoot: string): Promise<ScanResult> {
  const files: string[] = [];
  const failures: ScanFailure[] = [];
  for (const root of adapter.roots(repoRoot)) {
    await walk(root.path, root.origin, adapter.eligible, files, failures);
  }
  const tagged: TaggedFile[] = [];
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    tagged.push({ path: relative(repoRoot, file), tags: extractTagsWith(content, adapter.tagRe) });
  }
  return { tagged, failures };
}

/**
 * Scan several kinds in ONE traversal per distinct root set, reading each file
 * at most once. The code and tests adapters walk the same tree and differ only
 * in their `eligible` predicate, so a caller that needs both — `garden detect` —
 * would otherwise pay two full recursive walks.
 *
 * Each kind still gets its own {@link ScanResult}, failures included, so a
 * caller can decline to make claims about a kind whose scan was not
 * authoritative.
 *
 * @param adapters - The kinds to scan
 * @param repoRoot - Absolute consumer root; results are relative to it
 * @returns key → that kind's scan result
 */
export async function collectTaggedMany(
  adapters: readonly LinkAdapter[],
  repoRoot: string,
): Promise<Map<LinkAdapter['key'], ScanResult>> {
  const groups = new Map<string, LinkAdapter[]>();
  for (const adapter of adapters) {
    const key = JSON.stringify(adapter.roots(repoRoot));
    groups.set(key, [...(groups.get(key) ?? []), adapter]);
  }

  const out = new Map<LinkAdapter['key'], ScanResult>();
  for (const [, group] of groups) {
    const files: string[] = [];
    const failures: ScanFailure[] = [];
    for (const root of group[0].roots(repoRoot)) {
      // Collect every file once; eligibility is applied per adapter below, so
      // one traversal serves the whole group.
      await walk(root.path, root.origin, () => true, files, failures);
    }
    const results = new Map<LinkAdapter['key'], TaggedFile[]>();
    for (const adapter of group) results.set(adapter.key, []);
    for (const file of files) {
      const takers = group.filter((a) => a.eligible(basename(file)));
      if (takers.length === 0) continue;
      const content = await readFile(file, 'utf8');
      const rel = relative(repoRoot, file);
      for (const adapter of takers) {
        results
          .get(adapter.key)
          ?.push({ path: rel, tags: extractTagsWith(content, adapter.tagRe) });
      }
    }
    for (const adapter of group) {
      out.set(adapter.key, { tagged: results.get(adapter.key) ?? [], failures });
    }
  }
  return out;
}

/** Load every FD's cached array for one `links.*` key, keyed by slug. */
export async function loadCached(
  featuresDir: string,
  key: LinkAdapter['key'],
): Promise<Map<string, string[]>> {
  const all = await loadCachedAll(featuresDir, [key]);
  return all.get(key) ?? new Map();
}

/**
 * Load several `links.*` keys in ONE pass over the FD directory. `garden detect`
 * asks for all three, and parsing every FD once per kind is the dominant cost of
 * the drift pass.
 *
 * @param featuresDir - Directory holding `<slug>.md` feature docs
 * @param keys - The `links.*` fields to read
 * @returns key → (slug → cached array); absent arrays read as `[]`
 */
export async function loadCachedAll(
  featuresDir: string,
  keys: readonly LinkAdapter['key'][],
): Promise<Map<LinkAdapter['key'], Map<string, string[]>>> {
  const out = new Map<LinkAdapter['key'], Map<string, string[]>>();
  for (const key of keys) out.set(key, new Map());
  let entries: string[] = [];
  try {
    entries = (await readdir(featuresDir)).filter((f) => f.endsWith('.md'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const f of entries) {
    const parsed = matter(await readFile(join(featuresDir, f), 'utf8'));
    const links = (parsed.data.links ?? {}) as Record<string, unknown>;
    const slug = basename(f, '.md');
    for (const key of keys) {
      const value = links[key];
      out.get(key)?.set(slug, Array.isArray(value) ? (value as string[]) : []);
    }
  }
  return out;
}

/** What the scan projects onto one FD: the array to write, or a refusal. */
export type Projection = { skipped: true } | { skipped: false; next: string[] };

/**
 * Project one FD's scanned paths onto its cached array.
 *
 * Preserved entries always survive. A scan that matched nothing for this FD does
 * not clear entries the scan could own unless `force` says so: in a repo with no
 * tags at all — a consumer that never adopted the convention — an unguarded write
 * erases every hand-curated array in one run.
 *
 * @param scanned - Paths this FD's tags produced (possibly empty)
 * @param current - The FD's existing array
 * @param adapter - Supplies the preserve predicate
 * @param force - Clear owned entries even when the scan matched nothing
 * @returns The array to write, or `{ skipped: true }` when the write is refused
 */
export function project(
  scanned: string[],
  current: string[],
  adapter: LinkAdapter,
  force = false,
): Projection {
  const preserved = current.filter((p) => adapter.preserve(p));
  if (scanned.length === 0 && !force && current.length > preserved.length) {
    return { skipped: true };
  }
  return { skipped: false, next: [...new Set([...scanned, ...preserved])].toSorted() };
}

/** One FD whose cached array disagrees with what the scan would write. */
export interface ProjectionDrift {
  slug: string;
  scanned: string[];
  cached: string[];
}

/**
 * FDs whose cache differs from the scan. Preserved entries neither count as
 * drift nor get dropped, and an FD {@link project} would refuse to rewrite is
 * not drift either — reporting it would claim a staleness the write path
 * deliberately declines to fix, leaving `--check` permanently red with no
 * command able to clear it. {@link taglessKeptSlugs} surfaces those instead.
 *
 * @param scanned - slug → scanned paths
 * @param cached - slug → cached arrays
 * @param adapter - Supplies the preserve predicate
 * @returns One entry per stale FD, slug-sorted
 */
export function diffProjection(
  scanned: Map<string, string[]>,
  cached: Map<string, string[]>,
  adapter: LinkAdapter,
): ProjectionDrift[] {
  const drift: ProjectionDrift[] = [];
  const slugs = new Set([...scanned.keys(), ...cached.keys()]);
  for (const slug of [...slugs].toSorted()) {
    const want = (scanned.get(slug) ?? []).toSorted();
    const current = cached.get(slug) ?? [];
    if (project(want, current, adapter).skipped) continue;
    const have = current.filter((p) => !adapter.preserve(p)).toSorted();
    if (want.length !== have.length || want.some((v, i) => v !== have[i])) {
      drift.push({ slug, scanned: want, cached: current });
    }
  }
  return drift;
}

/**
 * FDs a plain run leaves alone: no tag matched them, yet their array still holds
 * entries the scan could have owned. Entries under an unownable (templated) root
 * are excluded — no operator can add a tag there, so naming them would be a
 * notice nobody can act on.
 *
 * @param scanned - slug → scanned paths
 * @param cached - slug → cached arrays
 * @param adapter - Supplies the preserve and unownable predicates
 * @returns The affected slugs, sorted
 */
export function taglessKeptSlugs(
  scanned: Map<string, string[]>,
  cached: Map<string, string[]>,
  adapter: LinkAdapter,
): string[] {
  const kept: string[] = [];
  for (const [slug, current] of cached) {
    if (!project(scanned.get(slug) ?? [], current, adapter).skipped) continue;
    const actionable = current.filter((p) => !adapter.preserve(p) && !adapter.unownable(p));
    if (actionable.length > 0) kept.push(slug);
  }
  return kept.toSorted();
}

/** Whether an FD was rewritten, left alone, or protected from a total wipe. */
type UpdateOutcome = 'updated' | 'unchanged' | 'skipped';

async function updateFeatureMd(
  path: string,
  scanned: string[],
  adapter: LinkAdapter,
  force: boolean,
): Promise<UpdateOutcome> {
  const raw = await readFile(path, 'utf8');
  const parsed = matter(raw);
  // gray-matter memoizes by content string and hands back the SAME `data`
  // object for every parse of identical bytes, so mutating it in place edits
  // every other holder's view — including a second FD whose frontmatter happens
  // to match byte for byte. Copy before touching anything.
  const data = { ...(parsed.data as Record<string, unknown>) };
  const links = { ...(data.links as Record<string, unknown> | undefined) };
  const currentValue = links[adapter.key];
  const current = Array.isArray(currentValue) ? (currentValue as string[]) : [];
  const projection = project(scanned, current, adapter, force);
  if (projection.skipped) return 'skipped';
  const next = projection.next;
  const currentSorted = [...current].toSorted();
  if (currentSorted.length === next.length && currentSorted.every((v, i) => v === next[i])) {
    return 'unchanged';
  }
  links[adapter.key] = next;
  data.links = links;
  await atomicWriteFile(path, matter.stringify(parsed.content.replace(/^\n/, ''), data));
  return 'updated';
}

/** Flags a projection run accepts, mirrored by all three CLI entrypoints. */
export interface RunOptions {
  check?: boolean;
  force?: boolean;
  /** Suppress the tagless-kept report. Set by the pre-commit hook lines. */
  quiet?: boolean;
  cwd?: string;
  featuresDir?: string;
}

/** Parse the shared flag set from an argv slice. */
export function parseRunOptions(argv: readonly string[]): RunOptions {
  return {
    check: argv.includes('--check'),
    force: argv.includes('--force'),
    quiet: argv.includes('--quiet'),
  };
}

function reportTaglessKept(kept: string[], key: LinkAdapter['key'], quiet: boolean): void {
  if (quiet || kept.length === 0) return;
  for (const slug of kept) {
    console.log(`  ${slug}: skipped (no tags, existing links kept)`);
  }
  console.log(
    `${kept.length} FD(s) keep their existing links.${key} — no tag matched them ` +
      '(not drift; a write run with `--force` clears them).',
  );
}

/**
 * Report the roots that made this run non-authoritative and return true when the
 * run must not clear anything.
 */
function reportFailures(failures: ScanFailure[]): boolean {
  if (failures.length === 0) return false;
  for (const f of failures) {
    console.error(`cannot read scan root ${f.root} (${f.code})`);
  }
  console.error(
    `${failures.length} scan root(s) unreadable — the scan is not authoritative, ` +
      'so no links were cleared. Fix the root(s) or drop them from `scanPaths`.',
  );
  return true;
}

/**
 * Run one kind's projection end to end. Exit-code intent is returned rather than
 * set, so callers (CLI main, tests) decide.
 *
 * @param adapter - The kind to project
 * @param opts - check / force / quiet plus root overrides
 * @returns 0 when the run is clean, 1 when it found drift or could not trust its scan
 */
export async function runProjection(adapter: LinkAdapter, opts: RunOptions = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const featuresDir = opts.featuresDir ?? join(cwd, 'docs', 'features');
  const { tagged, failures } = await collectTagged(adapter, cwd);
  if (reportFailures(failures)) return 1;

  const scanned = buildSlugMap(tagged);
  const cached = await loadCached(featuresDir, adapter.key);

  if (opts.check) {
    const drift = diffProjection(scanned, cached, adapter);
    reportTaglessKept(taglessKeptSlugs(scanned, cached, adapter), adapter.key, opts.quiet ?? false);
    if (drift.length === 0) {
      console.log(`links.${adapter.key} is in sync with ${adapter.tagLabel} tags.`);
      return 0;
    }
    for (const d of drift) {
      console.error(`\n${d.slug}: links.${adapter.key} stale`);
      console.error(`  scanned: ${d.scanned.join(', ') || '(none)'}`);
      console.error(`  cached:  ${d.cached.join(', ') || '(none)'}`);
    }
    console.error(`\n${drift.length} FD(s) have stale links.${adapter.key}.`);
    return 1;
  }

  // Drive the write from the union of scanned and cached slugs. A slug whose
  // tags were all removed survives only in `cached`; visiting it with an empty
  // path list is what lets the projection clear its stale entries. Iterating the
  // scan map alone is the defect this engine exists to remove.
  const slugs = new Set([...scanned.keys(), ...cached.keys()]);
  let updated = 0;
  const skipped: string[] = [];
  for (const slug of [...slugs].toSorted()) {
    const featureMd = join(featuresDir, `${slug}.md`);
    const paths = scanned.get(slug) ?? [];
    try {
      const outcome = await updateFeatureMd(featureMd, paths, adapter, opts.force ?? false);
      if (outcome === 'updated') updated += 1;
      if (outcome === 'skipped') skipped.push(slug);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(
          `WARN: ${adapter.tagLabel} "${slug}" referenced but ${featureMd} does not exist.`,
        );
      } else {
        throw error;
      }
    }
  }
  console.log(
    `Scanned ${tagged.length} file(s), wrote links.${adapter.key} on ${updated} feature MD(s).`,
  );
  const actionable = skipped.filter((slug) =>
    (cached.get(slug) ?? []).some((p) => !adapter.preserve(p) && !adapter.unownable(p)),
  );
  reportTaglessKept(actionable, adapter.key, opts.quiet ?? false);
  return 0;
}
