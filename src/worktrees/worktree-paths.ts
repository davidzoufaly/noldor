// @tests: unvalidated-slug-path-traversal-across-cli-entry-points
import { slugPath, type PathError } from '../core/slug-paths.js';
import type { Slug } from '../core/slug.js';

/** Result shape shared by both worktree path builders. */
export type WorktreePathResult = { ok: true; path: string } | { ok: false; error: PathError };

/**
 * Absolute path of a worktree directory, guarded.
 *
 * @param cwd - Main workspace root, the containment anchor.
 * @param slug - An already-parsed slug.
 * @returns The absolute path, or the reason it was refused.
 */
export function worktreePath(cwd: string, slug: Slug): WorktreePathResult {
  return slugPath(cwd, ['.worktrees'], slug);
}

/**
 * Absolute path of a worktree's dev-surface pid file, guarded.
 *
 * The slug sits inside a prefixed segment (`dev-<slug>.pids`), which is why
 * {@link slugPath} takes a prefix as well as a suffix: a suffix-only builder
 * could not express this path, and this is the one whose escape lets the
 * command read a foreign pid file and signal its process groups.
 *
 * @param cwd - Main workspace root, the containment anchor.
 * @param slug - An already-parsed slug.
 * @returns The absolute path, or the reason it was refused.
 */
export function worktreePidsPath(cwd: string, slug: Slug): WorktreePathResult {
  return slugPath(cwd, ['.noldor'], slug, { prefix: 'dev-', suffix: '.pids' });
}
