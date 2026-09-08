// @fd: main-module-guard-fails-on-percent-encoded-paths
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { walkRepo } from '../core/fd-load.js';
import { defineInvariant } from './types.js';
import type { Invariant, InvariantViolation } from './types.js';

/**
 * Scan one file's source for violations.
 *
 * @param relPath - Repo-relative path, for the exemption check and the report.
 * @param text - The file's source.
 * @returns Zero or more violations found in that file.
 */
export type SourceScan = (relPath: string, text: string) => InvariantViolation[];

/**
 * Build an {@link Invariant} that runs `scan` over every `.ts` file under
 * `<repoRoot>/src`.
 *
 * Extracted when the diff-scoped clone gate flagged 135 tokens shared between
 * `slug-path-choke-point.ts` and `entrypoint-guard-choke-point.ts`: both walked
 * the tree, filtered the extension and folded the per-file results themselves.
 * That is bookkeeping, not policy — the same reasoning that made
 * {@link defineInvariant} worth having one layer up.
 *
 * It lives here rather than in `types.ts` on purpose. `types.ts` is imported by
 * every invariant and by the registry, and is deliberately dependency-free;
 * giving it `node:fs/promises` and `core/fd-load.js` would push filesystem
 * imports into all six plugins to spare two of them a walk.
 *
 * Reads are issued together rather than in sequence: the files are independent,
 * and a sequential `await` inside the loop was the shape both copies had.
 *
 * @param name - Invariant id, as reported.
 * @param description - One-line summary for the runner's listing.
 * @param repoRoot - Repository root whose `src/` tree should be scanned.
 * @param scan - Per-file scan. Pure: no `process.exit`, no logging.
 * @returns A plugin bound to that root.
 */
export function defineSourceScanInvariant(
  name: string,
  description: string,
  repoRoot: string,
  scan: SourceScan,
): Invariant {
  return defineInvariant(name, description, async () => {
    const files: string[] = [];
    await walkRepo(join(repoRoot, 'src'), files);
    const sources = await Promise.all(
      files
        .filter((abs) => abs.endsWith('.ts'))
        .map(async (abs) => [relative(repoRoot, abs), await readFile(abs, 'utf8')] as const),
    );
    return sources.flatMap(([relPath, text]) => scan(relPath, text));
  });
}
