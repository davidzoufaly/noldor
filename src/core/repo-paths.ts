// @fd: scan-roots-repo-paths-provider

import { readFile, readdir } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

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
const WALK_EXCLUDED_DIRS = new Set([
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
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (WALK_EXCLUDED_DIRS.has(entry.name)) continue;
        if (!opts.includeTests && entry.name === '__tests__') continue;
        walk(join(dir, entry.name));
      } else if (entry.isFile() && CODE_FILE_RE.test(entry.name)) {
        if (!opts.includeTests && TEST_FILE_RE.test(entry.name)) continue;
        out.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  return out.sort();
}

/**
 * Directories skipped by {@link newestMtimeInRoots}. Narrower than
 * {@link WALK_EXCLUDED_DIRS}: `fixtures` is deliberately absent, because a
 * fixture edit is a real source edit for freshness purposes.
 */
const MTIME_SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.git']);

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
 * @param cwd - Consumer root the roots are resolved against
 * @param roots - Directory names resolved against `cwd`, typically
 *   {@link scanRoots} output; an absolute root is used verbatim
 * @returns Largest mtime in ms, or `null` when no root holds a file
 */
export function newestMtimeInRoots(cwd: string, roots: readonly string[]): number | null {
  const { samplesPath } = loadConsumerConfig(cwd);
  let newest: number | null = null;
  const visit = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || MTIME_SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (isSamplesPath(full, samplesPath)) continue;
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (newest === null || st.mtimeMs > newest) newest = st.mtimeMs;
    }
  };
  // An absolute root is used as-is: `join(cwd, '/tmp/x')` yields `<cwd>/tmp/x`,
  // which silently walks nothing. Callers pass both shapes — `scanRoots()` gives
  // relative names, tests and any absolute-path caller give resolved ones.
  for (const root of roots) visit(isAbsolute(root) ? root : join(cwd, root));
  return newest;
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
