// @fd: root-readme-content-validator
import { join } from 'node:path';

import { toPosixRelative } from '../core/repo-paths.js';

import { walkMd } from './docs-check.js';

/**
 * Directories one level under `docs/` that hold per-change workflow artifacts —
 * one file per feature, spec or plan — rather than pages a reader navigates.
 *
 * An explicit constant, deliberately NOT derived from `loadDocRoots()`: that
 * accessor also names `adr`, `architecture` and `milestones`, so deriving from
 * it would exclude the very surfaces this check exists to catch. `docs/assets`
 * needs no entry — it holds no markdown, so the predicate below drops it.
 *
 * `superpowers` is the pre-1.0.0 home of plans and specs, still resolved by
 * `resolveDesignSubdir` (`src/core/doc-roots.ts`) for a consumer who bumped the
 * package but has not run `noldor upgrade`. Without it such a repo enrols
 * `docs/superpowers/` as a surface and gets a permanent finding demanding a
 * README link to an artifact directory — the adoption noise this feature's
 * advisory posture exists to avoid. Delete this member together with that
 * transition alias (tracked by Q-0006).
 */
const ARTIFACT_DIRS: ReadonlySet<string> = new Set(['features', 'design', 'superpowers']);

/**
 * Every documentation surface: a directory one level under `docs/` that holds
 * markdown and is not an artifact directory. Auto-enrolling by construction —
 * a new surface needs no registration to be checked.
 *
 * Walks `docs/` once via the shared {@link walkMd}, rather than once per
 * candidate directory, and inherits its `node_modules` / `dist` / `coverage`
 * exclusions and its design-archive exemptions (which is why `rel` is `'docs'`).
 *
 * @param cwd - Repository root
 * @returns Repo-relative POSIX dirs, sorted
 */
export async function enumerateDocSurfaces(cwd: string): Promise<readonly string[]> {
  const docsDir = join(cwd, 'docs');
  const hits: string[] = [];
  try {
    // `walkMd` throws on ENOENT — this catch is what makes a repo with no
    // `docs/` report no surfaces instead of failing the check.
    await walkMd(docsDir, hits, 'docs');
  } catch {
    return [];
  }

  const surfaces = new Set<string>();
  for (const hit of hits) {
    if (!hit.endsWith('.md')) continue;
    const rel = toPosixRelative(docsDir, hit);
    const segment = rel.split('/')[0];
    if (segment === undefined || segment === '') continue;
    // A `.md` directly in `docs/` belongs to no surface directory.
    if (rel === segment) continue;
    if (ARTIFACT_DIRS.has(segment)) continue;
    surfaces.add(`docs/${segment}`);
  }
  return [...surfaces].toSorted();
}

/** What the README link graph reaches. */
export interface ReachSet {
  /**
   * Repo-relative POSIX paths of every reached **markdown** file. Non-markdown
   * targets are never recorded: they cannot satisfy a documentation surface and
   * are not traversed, so keeping them would let an image link mark a surface
   * reachable.
   */
  readonly files: ReadonlySet<string>;
  /** Dirs reached directly by a directory-target link. */
  readonly dirs: ReadonlySet<string>;
  /** Operational degradations encountered during the walk. Never findings. */
  readonly notes: readonly string[];
  /**
   * Readability of the seed. The walk is the single place `README.md` is read,
   * so it is the single place this is decided; the façade maps it to a status
   * rather than re-deriving it from a second read.
   */
  readonly readme: 'ok' | 'missing' | 'unreadable';
  /**
   * The seed body, `''` unless `readme === 'ok'`. Carried so no caller re-reads
   * the file: a second read is not merely wasteful, it can fail after the first
   * succeeded (deleted or chmod-ed in between) and reject a promise this
   * module's contract says never rejects on expected I/O.
   */
  readonly body: string;
}

/**
 * Surfaces no README link reaches. A surface is satisfied by a direct
 * directory link, or by any reached markdown file at or beneath it.
 *
 * @param surfaces - From {@link enumerateDocSurfaces}
 * @param reached - From `reachableTargets`
 * @returns The unreachable subset, input order preserved
 */
export function unreachableSurfaces(
  surfaces: readonly string[],
  reached: ReachSet,
): readonly string[] {
  return surfaces.filter((surface) => {
    if (reached.dirs.has(surface)) return false;
    for (const file of reached.files) {
      if (file === surface || file.startsWith(`${surface}/`)) return false;
    }
    return true;
  });
}
