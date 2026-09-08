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
 * **Why this exists at the second call site, which `abstraction-cost` normally
 * declines.** That rule's remedy for a clone-gate red is "decline the wrapper
 * and rebaseline", and it does not apply here: the red came from the
 * *diff-scoped* gate, which asks whether a clone group overlaps a line the
 * change wrote, and no baseline silences that. Rebaselining was tried first and
 * left the gate red.
 *
 * It also clears the rule's own bar for reason 1, hiding complexity a caller
 * should not see. Scanning a source tree means a recursive walk, an extension
 * filter, and reads whose concurrency is a real choice — this version issues
 * them together, where both copies awaited in sequence. A caller is now its
 * identity plus its per-file predicate, which is exactly the argument
 * {@link defineInvariant} already won one layer up: "that shape is bookkeeping,
 * not policy". This is not a renaming forwarder.
 *
 * The measured price is the opposite of the trade the rule warns against. It
 * paid **one** unit of indirection (919 → 926 total, of which 42 are the
 * feature's own choke-point edges) to remove 270 duplicated tokens
 * (26032 → 25762). The warned-against case is paying indirection to lower a
 * duplication count; here duplication genuinely went away.
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
