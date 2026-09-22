// @fd: scan-roots-repo-paths-provider

import { readFile, readdir } from 'node:fs/promises';
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

import { defaultRunGit } from './branch-added.js';
import { loadConsumerConfig } from './consumer-config.js';

/**
 * Union-of-layouts fallback used when consumer `scanPaths` is unset: covers
 * monorepo (`packages`/`apps`/`scripts`) and standalone (`src`) layouts.
 * Roots that don't exist are ENOENT-skipped by every walker.
 */
export const DEFAULT_SCAN_ROOTS = ['packages', 'apps', 'scripts', 'src'];

/**
 * Repo-relative path with POSIX separators, whatever the platform. Hoisted
 * from per-module copies (docs-architecture, docs-adr) when the code reviewer
 * flagged the clone; other inlined instances migrate as they are next edited.
 */
export function toPosixRelative(cwd: string, abs: string): string {
  return relative(cwd, abs).split(sep).join('/');
}

/**
 * Scan roots: consumer `scanPaths` when configured (non-empty), else
 * {@link DEFAULT_SCAN_ROOTS}. Single source of truth for every repo-walking
 * surface (sync code-links, sdd-report, dashboard, gap fillers, pointers) —
 * never hardcode layout dirs in a new feature.
 *
 * @param cwd - Consumer root holding `.noldor/config.json` (default `process.cwd()`)
 * @returns Relative directory names to walk from the consumer root
 */
export function scanRoots(cwd: string = process.cwd()): string[] {
  const { scanPaths } = loadConsumerConfig(cwd);
  return scanPaths.length > 0 ? scanPaths : DEFAULT_SCAN_ROOTS;
}

/**
 * Names declared by `packages/*\/package.json`, in directory order.
 * Deliberately `packages/`-only rather than all scan roots: the result feeds
 * the README `### Packages` drift detector, and app names would fabricate
 * "missing from README" gaps (spec D2 — parity, not expansion).
 * ENOENT-tolerant: a standalone repo without `packages/` yields `[]`; dirs
 * without a `package.json` are skipped.
 *
 * @param cwd - Consumer root (default `process.cwd()`)
 * @returns Package names found under `packages/`
 */
export async function actualPackageNames(cwd: string = process.cwd()): Promise<string[]> {
  const names: string[] = [];
  try {
    const entries = await readdir(join(cwd, 'packages'), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const pkgJson = JSON.parse(
          await readFile(join(cwd, 'packages', entry.name, 'package.json'), 'utf8'),
        ) as { name?: string };
        if (pkgJson.name) names.push(pkgJson.name);
      } catch {
        // Skip dirs without package.json
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return names;
}

/** Code-file extension policy — mirrors `src/sync/sync-code-links.ts`. */
export const CODE_FILE_RE = /\.(ts|tsx|js|jsx)$/;
/** Test-file naming policy — mirrors `src/sync/sync-code-links.ts`. */
export const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
/**
 * Directory names every repo walk skips. Exported so a second corpus rule can be
 * built from the same set rather than restating it — `src/indirection/detect.ts`
 * derives its dependency-cruiser `exclude` from this, and a divergence between
 * the two is what makes one enumerate files the other cannot see.
 */
export const WALK_EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  '.turbo',
  'coverage',
  '.git',
  'fixtures',
]);

/**
 * Recursively collect code files under `root` (`.ts/.tsx/.js/.jsx`, the same
 * extension policy as sync-code-links; that module keeps its private copy —
 * migrating the existing walkers is a separate refactor). Test files
 * (`*.test.*`, `*.spec.*`, `__tests__/`) are skipped unless `includeTests`.
 * Missing root returns `[]`. Output is sorted for determinism.
 */
export function walkCodeFiles(root: string, opts: { includeTests: boolean }): string[] {
  const out: string[] = [];
  walkDir(
    root,
    (full, name) => {
      if (!CODE_FILE_RE.test(name)) return;
      if (!opts.includeTests && TEST_FILE_RE.test(name)) return;
      out.push(full);
    },
    (name) => WALK_EXCLUDED_DIRS.has(name) || (!opts.includeTests && name === '__tests__'),
    // Never follow links: this corpus feeds the clone detector and code-link
    // sync, which need git-tracked, enumeration-order-independent paths.
    false,
    undefined,
  );
  return out.sort();
}

/**
 * Depth-first descent over `root`, handing every file to `onFile` and asking
 * `skipDir` whether to enter each directory. `skipDir` also gets the
 * directory's walked path, so a caller can prune by location and not only by
 * name; the path is absent when the question is a segment of a resolved link
 * target, which has no walked path of its own.
 *
 * Extracted when the mtime walker below duplicated {@link walkCodeFiles}'s
 * descent verbatim — same `readdirSync(withFileTypes)`, same ENOENT-swallow,
 * same recurse-or-visit branch. The two callers differ only in what they skip
 * and what they do with a file, so those are the parameters; everything else is
 * one definition. An unreadable directory is skipped, never thrown: these
 * walkers run over whatever a consumer's tree happens to contain.
 *
 * `followLinks` decides whether symlinks are resolved and traversed at all.
 * The two callers have always had different symlink policies, and the flag
 * keeps them apart rather than averaging them:
 *
 * - {@link walkCodeFiles} passes `false` — its exact pre-lift behaviour
 *   (`withFileTypes` + `isDirectory()/isFile()`, which classifies a link as
 *   neither, so links of every kind are skipped). Its output is a corpus for
 *   the clone detector and code-link sync, which need git-tracked paths;
 *   emitting whichever alias `readdir` returned first would also make that
 *   corpus enumeration-order dependent.
 * - {@link newestMtimeInRoots} passes `true` — the pre-lift `walkSync` used
 *   bare `readdirSync` + `statSync` and followed links to files AND to
 *   directories. Both halves are load-bearing for freshness: a symlinked
 *   source file or a symlinked source DIRECTORY going invisible makes the
 *   newest file under a scan root unseen, and a stale graph reads `fresh` —
 *   the dangerous inverse of the leg's documented false-stale mode. A
 *   max-mtime aggregation is also immune to the alias-shadowing problem that
 *   rules link-following out for the corpus: whichever alias is visited first,
 *   the same files contribute the same mtimes.
 *
 * The `visited` set (resolved real paths, allocated per walk, used only on the
 * following path) is what bounds the pre-lift behaviour that was never safe:
 * `src/loop -> src` re-walked the tree until ENAMETOOLONG. A directory is
 * entered once however many links reach it, so a cycle terminates and a
 * legitimate `src/generated -> ../generated` stays visible.
 *
 * Following is additionally repository-bounded, which pre-lift never was. A
 * directory is DESCENDED into only when its resolved path stays inside
 * `containWithin` (the caller's repo root, realpathed) and every path segment of
 * the resolved location under that bound passes `skipDir` — segment-wise, not
 * basename-only, because `src/lib -> node_modules/dep` resolves to basename
 * `dep` and would otherwise re-admit the excluded `node_modules` subtree
 * (probed: a future-stamped file behind such a link polluted the aggregate into
 * a perpetual false-stale). A followed FILE link is bounded the same way. The
 * walk ROOT itself is exempt from the segment check: pre-lift walkers never
 * name-checked the root, and a scan root resolving to a dot-prefixed real
 * location would otherwise silently vanish, letting a stale graph read fresh.
 *
 * noldor:cut a RELATIVE scan root that is itself a symlink pointing outside the
 * repo re-anchors the bound to its resolved tree (same policy as an absolute
 * root) — deliberate: the root list is the operator's own config, not untrusted
 * input; revisit if consumer configs ever carry third-party roots.
 *
 * Exported for its tests only: bounded-vs-exhausted traversal is
 * indistinguishable through `newestMtimeInRoots` (an ENAMETOOLONG-exhausted
 * walk still returns the right max), so the test observes `onFile` directly.
 */
export function walkDir(
  root: string,
  onFile: (path: string, name: string) => void,
  skipDir: (name: string, path?: string) => boolean,
  followLinks: boolean,
  containWithin?: string,
  visited: Set<string> = new Set(),
  isRoot = true,
): void {
  if (followLinks) {
    // Identity is the resolved path, so two links to one directory walk it
    // once and a cycle terminates.
    let real: string;
    try {
      real = realpathSync(root);
    } catch {
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);
    if (!resolvedPathAllowed(real, skipDir, containWithin, isRoot)) return;
  }
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(root, entry.name);
    let isDir = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      // `withFileTypes` calls a link neither file nor directory; resolve it —
      // or, on the corpus path, skip it outright (pre-lift behaviour).
      if (!followLinks) continue;
      try {
        const st = statSync(full);
        isDir = st.isDirectory();
        isFile = st.isFile();
        // A followed FILE link is bounded like a directory: `src/host.ts ->
        // /tmp/host.ts` must not contribute an external mtime.
        if (isFile && !resolvedPathAllowed(realpathSync(full), skipDir, containWithin, false)) {
          continue;
        }
      } catch {
        continue; // broken link
      }
    }
    if (isDir) {
      if (skipDir(entry.name, full)) continue;
      walkDir(full, onFile, skipDir, followLinks, containWithin, visited, false);
    } else if (isFile) {
      onFile(full, entry.name);
    }
  }
}

/**
 * Directories skipped by {@link newestMtimeInRoots}. Narrower than
 * {@link WALK_EXCLUDED_DIRS}: `fixtures` is deliberately absent, because a
 * fixture edit is a real source edit for freshness purposes.
 */
const MTIME_SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.git']);

/**
 * May this resolved location be visited?
 *
 * Bound check first (`containWithin` unset means unbounded — the corpus path
 * never resolves links at all, and a root outside the repo is self-bounded by
 * its caller). Then the exclusion check runs over EVERY segment of the resolved
 * location under the bound, so a link into a descendant of an excluded tree
 * (`src/lib -> node_modules/dep`) fails on the `node_modules` segment even
 * though its basename is `dep`. The walk root is exempt from the segment check
 * — its placement is the caller's explicit choice.
 */
function resolvedPathAllowed(
  real: string,
  skipDir: (name: string) => boolean,
  containWithin: string | undefined,
  isRoot: boolean,
): boolean {
  if (containWithin === undefined) return true;
  if (real !== containWithin && !real.startsWith(containWithin + sep)) return false;
  if (isRoot) return true;
  return !relative(containWithin, real)
    .split(sep)
    .some((segment) => segment.length > 0 && skipDir(segment));
}

/**
 * Largest mtime (ms) of any file under `roots`, or `null` when nothing exists.
 *
 * Lifted here from `src/garden/graph-fd-lookup.ts`, where it was module-private
 * and therefore unreachable by any second caller — `loadFreshGraphOrWarn` is the
 * only export and it also parses the graph and returns a co-tag-flavoured `Gap`.
 * It lives beside {@link scanRoots} because every caller pairs the two.
 *
 * `cwd` is explicit and every root is joined against it. The original resolved
 * roots as bare relative paths and called `loadConsumerConfig()` with no
 * argument, so it always walked `process.cwd()` — which silently reported on the
 * wrong repository for any caller that injected a different root.
 *
 * Files git ignores do not count. A scan root is also where build and test
 * tools write — Playwright's `test-results/` under `apps/web` is the observed
 * case — and one e2e run left ~112 files newer than the graph, so the graph read
 * stale with no source change and, the directory being gitignored, no
 * `git status` diff to explain it. What git ignores is by the repo's own
 * declaration not a source, and the committed freshness leg
 * (`evaluateGraphFreshness`) never saw those files either. See
 * {@link gitIgnoredPaths} for why the pruning cannot hide a real source file.
 *
 * @param cwd - Consumer root the roots are resolved against
 * @param roots - Directory names resolved against `cwd`, typically
 *   {@link scanRoots} output; an absolute root is used verbatim
 * @returns Largest mtime in ms, or `null` when no root holds a file
 */
export function newestMtimeInRoots(cwd: string, roots: readonly string[]): number | null {
  const { samplesPath } = loadConsumerConfig(cwd);
  // An absolute root is used as-is: `join(cwd, '/tmp/x')` yields `<cwd>/tmp/x`,
  // which silently walks nothing. Callers pass both shapes — `scanRoots()` gives
  // relative names, tests and any absolute-path caller give resolved ones.
  const walked = roots
    .map((root) => (isAbsolute(root) ? root : join(cwd, root)))
    .filter((abs) => !isSamplesPath(abs, samplesPath));
  const ignored = new Set(walked.flatMap((abs) => gitIgnoredPaths(abs)));
  let newest: number | null = null;
  const onFile = (full: string, name: string): void => {
    if (name.startsWith('.') || ignored.has(full) || isSamplesPath(full, samplesPath)) return;
    let st;
    try {
      st = statSync(full);
    } catch {
      return;
    }
    if (newest === null || st.mtimeMs > newest) newest = st.mtimeMs;
  };
  const skipDir = (name: string, path?: string): boolean =>
    name.startsWith('.') || MTIME_SKIP_DIRS.has(name) || (path !== undefined && ignored.has(path));
  // Bound link-following, whatever a link points at. The bound is the repo when
  // the root lives inside it — so a legitimate `src/generated -> ../generated`
  // stays visible — and the root itself otherwise: callers (and this module's
  // tests) legitimately pass absolute roots outside `cwd`, and bounding those to
  // the repo would silently walk nothing.
  let repoReal: string | undefined;
  try {
    repoReal = realpathSync(cwd);
  } catch {
    repoReal = undefined;
  }
  const boundFor = (abs: string): string | undefined => {
    let rootReal: string;
    try {
      rootReal = realpathSync(abs);
    } catch {
      return undefined;
    }
    if (repoReal !== undefined && (rootReal === repoReal || rootReal.startsWith(repoReal + sep))) {
      return repoReal;
    }
    return rootReal;
  };
  for (const abs of walked) {
    // Follow links: a symlinked source file or directory is exactly what went
    // invisible — bounded per root by `boundFor`.
    walkDir(abs, onFile, skipDir, true, boundFor(abs));
  }
  return newest;
}

/**
 * Absolute paths under `root` that git reports as ignored, for
 * {@link newestMtimeInRoots} to skip.
 *
 * `--directory` lists a directory whole only when nothing inside it is tracked
 * or un-ignored; any other directory git descends into and lists its ignored
 * entries one by one. So pruning at a listed path cannot hide a source file — a
 * tracked file under an ignore pattern and a new file not yet added both still
 * count. `-z` keeps unusual names verbatim; git would otherwise C-quote them and
 * the quoted form never matches a walked path.
 *
 * Empty when git cannot answer — not a repository, git absent, the root
 * missing. That filters nothing, so the walk errs toward false-stale, the
 * direction the freshness gate already treats as harmless, rather than calling a
 * graph fresh on evidence it could not collect.
 */
function gitIgnoredPaths(root: string): string[] {
  const r = defaultRunGit(root)(
    ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z', '--', '.'],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0) return [];
  return r.stdout
    .split('\0')
    .filter((rel) => rel.length > 0)
    .map((rel) => join(root, rel.endsWith('/') ? rel.slice(0, -1) : rel));
}

/**
 * Is this path the consumer's generated-samples dir, or inside it?
 *
 * Matches on the walked path rather than a cwd-relative one, and keeps all four
 * variants, because roots arrive both relative (`apps/...`, matched by the
 * `===` / `startsWith` pair) and absolute (`/tmp/x/apps/...`, matched only by
 * the `endsWith` / `includes` pair). Narrowing this to a repo-relative compare
 * silently stopped excluding samples under an absolute root — caught by
 * `graph-fd-lookup.test.ts`'s sample-scene freshness case.
 */
function isSamplesPath(path: string, samplesPath: string): boolean {
  // An unset `samplesPath` excludes nothing. Without this guard the
  // `startsWith(`${samplesPath}/`)` test below becomes `startsWith('/')`, which
  // matches every absolute path — so a consumer with no samples dir would have
  // its entire tree skipped and the caller would see no files at all.
  if (samplesPath.length === 0) return false;
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '');
  return (
    normalized === samplesPath ||
    normalized.endsWith(`/${samplesPath}`) ||
    normalized.startsWith(`${samplesPath}/`) ||
    normalized.includes(`/${samplesPath}/`)
  );
}
