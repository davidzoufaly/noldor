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
 * filter, and a read-concurrency decision that is not obvious and is recorded
 * below. A caller is now its identity plus its per-file predicate, which is the
 * argument {@link defineInvariant} already won one layer up: "that shape is
 * bookkeeping, not policy". This is not a renaming forwarder.
 *
 * The measured price is the opposite of the trade the rule warns against.
 * Extracting this cost **one** unit of indirection — measured directly: the
 * corpus sat at 925 with the duplication in place and 926 with it gone — and
 * removed 270 duplicated tokens, 26032 → 25762. (The feature's own ratchet move
 * is 919 → 926, +7; the other +6 is the 42 swept sites importing `cli-entry`,
 * which this helper has nothing to do with.) The warned-against case is paying
 * indirection to lower a duplication count; here the duplication genuinely went
 * away, and the diff-scoped gate confirms it: `no clone group touches this
 * change`.
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
    const violations: InvariantViolation[] = [];
    const files: string[] = [];
    await walkRepo(join(repoRoot, 'src'), files);
    // Sequential on purpose. An unbounded `Promise.all` over every `.ts` file
    // was tried and reverted: `readFile` does not queue descriptors, so 420
    // concurrent opens here (916 across the whole tree) can EMFILE for a
    // consumer on the macOS default `ulimit -n 256` — a failure the copied
    // sequential form could not have. `no-await-in-loop` is off in this repo
    // for exactly this class of loop.
    for (const abs of files) {
      if (!abs.endsWith('.ts')) continue;
      violations.push(...scan(relative(repoRoot, abs), await readFile(abs, 'utf8')));
    }
    return violations;
  });
}
