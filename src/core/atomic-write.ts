import { writeFileSync, renameSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';

/**
 * Synchronous atomic file write: write the content to a sibling
 * `<basename>.tmp.<pid>` and then `renameSync` it onto `target`. A
 * same-filesystem rename is atomic, so a concurrent reader observes either the
 * old bytes or the complete new bytes — never a torn / half-written file.
 *
 * This is the write-side half of state-file fail-open hardening: a crash or
 * interrupt part-way through a plain `writeFileSync` leaves a file that parses
 * as garbage, and Noldor's readers historically reset toward the *permissive*
 * default on a parse error (uncapped drain, freed lock, bypassed gate). Routing
 * every enforcement/rail writer through this helper prevents the torn file at
 * the source.
 *
 * Does NOT create directories: `target`'s parent must already exist (callers
 * that write under `.noldor/` keep their own `mkdirSync('.noldor', { recursive:
 * true })` so the `.tmp.<pid>` sibling has a home). On rename failure the tmp
 * file is intentionally left in place for postmortem, and the error bubbles to
 * the caller — mirroring {@link atomicWriteFile}.
 *
 * Sync twin of that async helper, kept synchronous because its callers
 * (`writeSession`, `ensureRolloutMarker`, `saveWatchState`, `savePark`) are all
 * synchronous; threading `async` through their non-async call sites would ripple
 * widely for no benefit.
 */
export function atomicWriteFileSync(target: string, content: string): void {
  const tmp = join(dirname(target), `${basename(target)}.tmp.${process.pid}`);
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, target);
}

/**
 * Async twin of {@link atomicWriteFileSync}: write to a sibling
 * `<basename>.tmp.<pid>` and `rename` it onto `target`. Same guarantees, same
 * tmp-file-on-failure postmortem behaviour, same requirement that the parent
 * directory already exist.
 *
 * Lives here rather than beside its original dashboard caller so async writers
 * outside the dashboard — the traceability projection engine rewrites FD
 * frontmatter from an async path, under a `stage_fixed` pre-commit hook where a
 * torn write is reachable — can use it without importing the dashboard layer.
 *
 * @param target - Absolute or cwd-relative path to write
 * @param content - Full file contents
 */
export async function atomicWriteFile(target: string, content: string): Promise<void> {
  const tmp = join(dirname(target), `${basename(target)}.tmp.${process.pid}`);
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, target);
}
