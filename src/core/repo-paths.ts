// @fd: scan-roots-repo-paths-provider

import { readFile, readdir } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { loadConsumerConfig } from './consumer-config.js';

/**
 * Union-of-layouts fallback used when consumer `scanPaths` is unset: covers
 * monorepo (`packages`/`apps`/`scripts`) and standalone (`src`) layouts.
 * Roots that don't exist are ENOENT-skipped by every walker.
 */
export const DEFAULT_SCAN_ROOTS = ['packages', 'apps', 'scripts', 'src'];

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
