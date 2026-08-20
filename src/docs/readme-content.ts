// @fd: root-readme-content-validator
import { lstat, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { toPosixRelative } from '../core/repo-paths.js';

import { extractLinks, walkMd } from './docs-check.js';

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

/**
 * Every markdown file and directory the README link graph reaches, to a
 * fixpoint over a visited set so link cycles terminate.
 *
 * Eligibility is whatever {@link extractLinks} yields — it already strips code
 * regions and drops external and root-absolute hrefs, so this check's notion of
 * "a link" is identical to the one `docs check` enforces. That matters: the
 * surfaces this check exists to catch are named in the rule pages only inside
 * prose backticks, and counting those would make the check green while the
 * reader still has no route.
 *
 * Every failure is contained: a broken link is `docs check`'s finding and is
 * skipped silently, and every other error becomes a note. Nothing throws.
 *
 * Each body is read when its path is dequeued and then dropped, so the walk
 * holds one body at a time rather than every visited file's. The trade-off is
 * that a read failure is attributed to the unreadable file rather than to the
 * link that led there.
 *
 * @param cwd - Repository root
 * @returns Reached markdown files, directly-linked dirs, degradations, and the
 *   seed's readability plus its body
 */
export async function reachableTargets(cwd: string): Promise<ReachSet> {
  const files = new Set<string>();
  const dirs = new Set<string>();
  const notes: string[] = [];
  const visited = new Set<string>(['README.md']);
  const queue: string[] = ['README.md'];
  let readme: ReachSet['readme'] = 'ok';
  let seedBody = '';

  while (queue.length > 0) {
    const from = queue.shift() as string;

    let body: string;
    try {
      body = await readFile(join(cwd, from), 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (from === 'README.md') {
        readme = code === 'ENOENT' ? 'missing' : 'unreadable';
        if (readme === 'unreadable') {
          notes.push(`cannot read README.md: ${code ?? 'unknown'}`);
        }
        break; // no seed, nothing to walk
      }
      notes.push(`cannot read ${from}: ${code ?? 'unknown'}`);
      continue;
    }
    if (from === 'README.md') seedBody = body;

    for (const link of extractLinks(body)) {
      const withoutFragment = link.href.split('#')[0] ?? '';
      const bare = withoutFragment.split('?')[0] ?? '';
      if (bare === '') continue;

      let decoded: string;
      try {
        decoded = decodeURIComponent(bare);
      } catch {
        // URIError, not a filesystem error — it would otherwise escape the
        // handling below and crash the walk this contract exists to protect.
        notes.push(`${from}:${link.line}: malformed percent-escape in ${bare} — link skipped`);
        continue;
      }

      const abs = resolve(join(cwd, dirname(from)), decoded);
      const target = toPosixRelative(cwd, abs);
      if (target === '' || target.startsWith('..')) continue; // escapes the repo root

      let stats;
      try {
        stats = await lstat(abs);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        // ENOENT is a broken link — `docs check`'s finding, not this one's.
        if (code !== 'ENOENT') {
          notes.push(`${from}:${link.line}: cannot stat ${target}: ${code ?? 'unknown'}`);
        }
        continue;
      }

      if (stats.isSymbolicLink()) continue; // not followed
      if (stats.isDirectory()) {
        dirs.add(target);
        continue;
      }
      if (!target.endsWith('.md')) continue; // cannot satisfy a surface

      files.add(target);
      if (visited.has(target)) continue;
      visited.add(target);
      queue.push(target); // read at dequeue — no body is retained
    }
  }

  return { files, dirs, notes, readme, body: seedBody };
}

export type ReadmeStatus = 'absent' | 'ok' | 'findings';

/** One thing the README claims, or fails to say, that does not hold. */
export interface Finding {
  readonly message: string;
}

/** What `checks readme` found, shaped for both the CLI and `docSurfaceRow`. */
export interface ReadmeReport {
  readonly status: ReadmeStatus;
  readonly findings: readonly Finding[];
  /** Degradations: what could not be checked, and why. Never findings. */
  readonly notes: readonly string[];
}

/**
 * Run the README checks over `cwd`.
 *
 * Never rejects for an EXPECTED failure — I/O errors, parse errors and
 * malformed input each degrade to a note and the rest of the check continues.
 * Programmer errors are deliberately not caught: swallowing one would hide a
 * defect behind a green release row. `notes` never affect `status`, so a
 * degraded run reports its degradation rather than masquerading as a failure.
 *
 * @param cwd - Repository root
 * @returns The report; `absent` when there is no readable README
 */
export async function checkReadme(cwd: string = process.cwd()): Promise<ReadmeReport> {
  const reached = await reachableTargets(cwd);
  if (reached.readme !== 'ok') {
    // The walk owns the readability rule and already noted an unreadable file.
    return { status: 'absent', findings: [], notes: [...reached.notes] };
  }

  const findings = unreachableSurfaces(await enumerateDocSurfaces(cwd), reached).map((surface) => ({
    message: `${surface}/ holds documentation but no link from README.md reaches it`,
  }));

  return {
    status: findings.length > 0 ? 'findings' : 'ok',
    findings,
    notes: [...reached.notes],
  };
}
