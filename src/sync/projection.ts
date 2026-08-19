// @fd: feature-md-links-overhaul

import { readFile, readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import matter from 'gray-matter';

import { atomicWriteFile } from '../core/atomic-write.js';
import { loadDocRoots } from '../core/doc-roots.js';

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

/**
 * A feature slug is a bare filename stem. Tag text is file content — untrusted
 * input that becomes `docs/features/<slug>.md` — so anything with a separator
 * or a traversal segment is rejected before it can address a path outside the
 * feature directory.
 */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
      if (!SLUG_RE.test(slug)) {
        console.warn(`WARN: ${path} tags "${slug}", which is not a feature slug — ignored.`);
        continue;
      }
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
  /** The path that could not be read — a scan root, a scanned file, or an FD. */
  root: string;
  code: string;
  /**
   * How wide the loss is, which is all a *caller* needs: `features-dir` means
   * the whole cache is unknown, `root` means one kind's traversal is
   * incomplete, and `file` / `feature-md` cost only that path. Deliberately not
   * a proxy for how to fix it — see {@link ScanFailure.what} and
   * {@link ScanFailure.remedy}.
   */
  kind: 'root' | 'features-dir' | 'file' | 'feature-md';
  /** What went wrong, in the operator's terms, e.g. `cannot parse feature MD`. */
  what: string;
  /**
   * What the operator should change. Written where the failure is raised,
   * because that is the only place that knows whether this was a permission
   * problem or a malformed document — a lookup keyed on {@link ScanFailure.kind}
   * kept naming fixes that did not apply to the input that actually failed.
   */
  remedy: string;
}

/** One walk of one adapter's roots: what it found, and what it could not read. */
export interface ScanResult {
  tagged: TaggedFile[];
  failures: ScanFailure[];
}

async function walk(
  dir: string,
  origin: RootOrigin,
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
    failures.push({
      root: dir,
      code,
      kind: 'root',
      what: 'cannot read scan root',
      remedy:
        code === 'ENOENT'
          ? 'restore the root, or drop a stale entry from `scanPaths`'
          : 'fix permissions on the scan root',
    });
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Nested dirs inherit their root's origin, but their absence is
      // impossible — readdir just listed them — so only read failures surface.
      await walk(full, origin, out, failures);
    } else {
      out.push(full);
    }
  }
}

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.git']);

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
    const rootFailures: ScanFailure[] = [];
    for (const root of group[0].roots(repoRoot)) {
      // Collect every file once; eligibility is applied per adapter below, so
      // one traversal serves the whole group.
      await walk(root.path, root.origin, files, rootFailures);
    }
    // Failures are per adapter, not per group. An unreadable root breaks the
    // traversal itself, so every adapter sharing it loses coverage — but an
    // unreadable *file* only matters to the adapters that would have read it.
    // Sharing one array made an unreadable test file withdraw links.code claims
    // over a file the code kind never opens.
    const results = new Map<LinkAdapter['key'], TaggedFile[]>();
    const failures = new Map<LinkAdapter['key'], ScanFailure[]>();
    for (const adapter of group) {
      results.set(adapter.key, []);
      failures.set(adapter.key, [...rootFailures]);
    }
    for (const file of files) {
      const takers = group.filter((a) => a.eligible(basename(file)));
      if (takers.length === 0) continue;
      let content: string;
      try {
        content = await readFile(file, 'utf8');
      } catch (error) {
        const failure: ScanFailure = {
          root: file,
          code: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN',
          kind: 'file',
          what: 'cannot read scanned file',
          remedy: 'fix permissions on the listed file(s), or remove them',
        };
        for (const adapter of takers) failures.get(adapter.key)?.push(failure);
        continue;
      }
      const rel = relative(repoRoot, file);
      for (const adapter of takers) {
        results
          .get(adapter.key)
          ?.push({ path: rel, tags: extractTagsWith(content, adapter.tagRe) });
      }
    }
    for (const adapter of group) {
      out.set(adapter.key, {
        tagged: results.get(adapter.key) ?? [],
        failures: failures.get(adapter.key) ?? [],
      });
    }
  }
  return out;
}

/**
 * What one pass over the FD directory produced: the cached arrays per key, plus
 * any FD the pass could not read or parse. A caller that skips the failures is
 * claiming knowledge of links it never saw.
 */
export interface CachedLoad {
  byKey: Map<LinkAdapter['key'], Map<string, string[]>>;
  failures: ScanFailure[];
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
): Promise<CachedLoad> {
  const out = new Map<LinkAdapter['key'], Map<string, string[]>>();
  for (const key of keys) out.set(key, new Map());
  const failures: ScanFailure[] = [];
  let entries: string[] = [];
  try {
    entries = (await readdir(featuresDir)).filter((f) => f.endsWith('.md'));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    // An absent features directory is a legitimately empty cache. Any other
    // failure means the cache is unknown, not empty — throwing here would
    // escape the very channel this function exists to fill, and returning
    // silently would let a caller diff against an empty cache and report every
    // FD as drifted. It gets its own `features-dir` kind so callers can tell
    // "the whole cache is unavailable" from "these individual FDs failed" and
    // withhold cache-dependent claims accordingly.
    if (code !== 'ENOENT') {
      failures.push({
        root: featuresDir,
        code,
        kind: 'features-dir',
        what: 'cannot read feature MD directory',
        remedy: 'fix permissions on the feature MD directory',
      });
    }
  }
  for (const f of entries) {
    // An FD whose frontmatter will not parse is not a programmer error — it is
    // a hand-edited file. Aborting here would take down the whole projection
    // (and `garden detect` with it) over one bad document; recording it keeps
    // the run honest that it does not know this FD's current links.
    let links: Record<string, unknown>;
    let raw: string;
    try {
      raw = await readFile(join(featuresDir, f), 'utf8');
    } catch (error) {
      // Unreadable is not unparseable: the frontmatter may be perfect and the
      // permissions wrong, so the two say different things to the operator.
      failures.push({
        root: join(featuresDir, f),
        code: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN',
        kind: 'feature-md',
        what: 'cannot read feature MD',
        remedy: 'fix permissions on the listed feature MD(s)',
      });
      continue;
    }
    try {
      links = (matter(raw).data.links ?? {}) as Record<string, unknown>;
    } catch (error) {
      failures.push({
        root: join(featuresDir, f),
        code: (error as NodeJS.ErrnoException).code ?? 'EPARSE',
        kind: 'feature-md',
        what: 'cannot parse feature MD',
        remedy: 'repair the frontmatter of the listed feature MD(s)',
      });
      continue;
    }
    const slug = basename(f, '.md');
    for (const key of keys) {
      const value = links[key];
      out.get(key)?.set(slug, Array.isArray(value) ? (value as string[]) : []);
    }
  }
  return { byKey: out, failures };
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
  // Only FDs that exist can drift. A slug that appears solely in the scan names
  // no feature MD — a typo'd tag, or an FD deleted while its tags remain — and
  // reporting it as stale links would leave `--check` red with the command it
  // names unable to clear it. {@link missingFdSlugs} surfaces those instead.
  for (const slug of [...cached.keys()].toSorted()) {
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
 * Slugs some file tagged that name no feature MD. Distinct from drift: no sync
 * run can fix these, only editing the tag or creating the FD can.
 *
 * @param scanned - slug → scanned paths
 * @param cached - slug → cached arrays, keyed by the FDs that exist
 * @returns The unmatched slugs, sorted
 */
export function missingFdSlugs(
  scanned: Map<string, string[]>,
  cached: Map<string, string[]>,
): string[] {
  return [...scanned.keys()].filter((slug) => !cached.has(slug)).toSorted();
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
 * @param force - When set, nothing is kept, so nothing is reported
 * @returns The affected slugs, sorted
 */
export function taglessKeptSlugs(
  scanned: Map<string, string[]>,
  cached: Map<string, string[]>,
  adapter: LinkAdapter,
  force = false,
): string[] {
  const kept: string[] = [];
  for (const [slug, current] of cached) {
    // `force` is what decides whether these entries are kept at all, so the
    // report has to see it: without it a forced run announces it preserved
    // links it cleared in the same pass.
    if (!project(scanned.get(slug) ?? [], current, adapter, force).skipped) continue;
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
 * Name the slugs that match no feature MD. Reported rather than counted as
 * drift: no sync run can reconcile them, so a drift line would name a command
 * that cannot clear it.
 */
function reportMissingFds(slugs: string[], adapter: LinkAdapter, featuresDir: string): void {
  for (const slug of slugs) {
    console.warn(
      `WARN: ${adapter.tagLabel} "${slug}" referenced but ${join(featuresDir, `${slug}.md`)} does not exist.`,
    );
  }
}

/**
 * Report the inputs that made this run non-authoritative and return true when the
 * run must not clear anything.
 */
function reportFailures(failures: ScanFailure[]): boolean {
  if (failures.length === 0) return false;
  for (const f of failures) {
    console.error(`${f.what} ${f.root} (${f.code})`);
  }
  const remedies = [...new Set(failures.map((f) => f.remedy))];
  console.error(
    `${failures.length} input(s) could not be read — the scan is not authoritative, ` +
      `so no links were cleared. To fix: ${remedies.join('; ')}.`,
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
  const featuresDir = opts.featuresDir ?? loadDocRoots(cwd).features;
  const scan = (await collectTaggedMany([adapter], cwd)).get(adapter.key);
  if (!scan || reportFailures(scan.failures)) return 1;

  const scanned = buildSlugMap(scan.tagged);
  const load = await loadCachedAll(featuresDir, [adapter.key]);
  // An FD whose frontmatter would not parse leaves this run unable to say what
  // its links currently are, so the run makes no claims and writes nothing —
  // the same posture an unreadable scan root earns.
  if (reportFailures(load.failures)) return 1;
  const cached = load.byKey.get(adapter.key) ?? new Map<string, string[]>();

  if (opts.check) {
    const drift = diffProjection(scanned, cached, adapter);
    reportMissingFds(missingFdSlugs(scanned, cached), adapter, featuresDir);
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
  // Drive the writes off the FDs that exist. Slugs naming no feature MD are
  // reported once by `reportMissingFds`; visiting them here only to catch ENOENT
  // produced a second warning for the same fact. An FD deleted between the load
  // and the write still surfaces, as a write failure.
  let updated = 0;
  const writeFailures: ScanFailure[] = [];
  for (const slug of [...cached.keys()].toSorted()) {
    const featureMd = join(featuresDir, `${slug}.md`);
    const paths = scanned.get(slug) ?? [];
    try {
      if ((await updateFeatureMd(featureMd, paths, adapter, opts.force ?? false)) === 'updated') {
        updated += 1;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
      // A permission or filesystem error on one FD is an expected failure, not a
      // programmer error. Rethrowing would abandon every remaining slug midway
      // through a partially rewritten set and hand the operator a raw stack,
      // while the read side of this same module reports and exits cleanly.
      writeFailures.push({
        root: featureMd,
        code,
        kind: 'feature-md',
        what: 'cannot write feature MD',
        remedy: 'fix permissions on the listed feature MD(s)',
      });
    }
  }
  console.log(
    `Scanned ${scan.tagged.length} file(s), wrote links.${adapter.key} on ${updated} feature MD(s).`,
  );
  reportMissingFds(missingFdSlugs(scanned, cached), adapter, featuresDir);
  reportTaglessKept(
    taglessKeptSlugs(scanned, cached, adapter, opts.force ?? false),
    adapter.key,
    opts.quiet ?? false,
  );
  if (writeFailures.length === 0) return 0;
  // Deliberately not `reportFailures`: that text says the scan was not
  // authoritative and nothing was cleared, which is the opposite of what
  // happened here — the links above were written and only these FDs were missed.
  for (const f of writeFailures) console.error(`${f.what} ${f.root} (${f.code})`);
  console.error(
    `${writeFailures.length} feature MD(s) could not be written — the rest were updated. ` +
      `To fix: ${[...new Set(writeFailures.map((f) => f.remedy))].join('; ')}.`,
  );
  return 1;
}
