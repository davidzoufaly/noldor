// @fd: root-readme-content-validator
import { lstat, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { toPosixRelative } from '../core/repo-paths.js';

import { extractLinks, walkMd } from './docs-check.js';

/**
 * Directories one level under `docs/` that hold per-change workflow artifacts —
 * one file per feature, spec, plan or milestone — rather than pages a reader
 * navigates.
 *
 * An explicit constant, deliberately NOT derived from `loadDocRoots()`: that
 * accessor also names `adr` and `architecture`, so deriving from it would
 * exclude the very surfaces this check exists to catch. `docs/assets` needs no
 * entry — it holds no markdown, so the predicate below drops it.
 *
 * `superpowers` is the pre-1.0.0 home of plans and specs, still resolved by
 * `resolveDesignSubdir` (`src/core/doc-roots.ts`) for a consumer who bumped the
 * package but has not run `noldor upgrade`. Delete that member together with the
 * transition alias (tracked by Q-0006).
 *
 * `milestones` holds one file per milestone, written by `noldor milestone
 * draft`. Structurally the same per-change shape as `features`, so enrolling it
 * would mint a standing finding demanding a README link to a milestone file.
 */
const ARTIFACT_DIRS: ReadonlySet<string> = new Set([
  'features',
  'design',
  'superpowers',
  'milestones',
]);

/**
 * True when a repo-relative path lives inside an artifact directory. Those pages
 * are machine-written (`sync fd-resources` / `sync doc-links` fill an FD's
 * Resources section from `links.docs`), so they are neither surfaces nor
 * *routes*: letting the walk pass through one would let a generated link satisfy
 * the very gate the artifact's feature exists to enforce.
 */
function isArtifactPath(target: string): boolean {
  const parts = target.split('/');
  return parts[0] === 'docs' && parts.length > 2 && ARTIFACT_DIRS.has(parts[1] ?? '');
}

/** Surfaces found under `docs/`, plus anything that could not be inspected. */
export interface SurfaceScan {
  /** Repo-relative POSIX dirs, sorted. */
  readonly surfaces: readonly string[];
  /** Degradations: what could not be walked, and why. Never findings. */
  readonly notes: readonly string[];
}

/**
 * Every documentation surface: a directory one level under `docs/` that holds
 * markdown and is not an artifact directory. Auto-enrolling by construction —
 * a new surface needs no registration to be checked.
 *
 * Walks `docs/` once via the shared {@link walkMd}, rather than once per
 * candidate directory, and inherits its `node_modules` / `dist` / `coverage`
 * exclusions and its design-archive exemptions (which is why `rel` is `'docs'`).
 *
 * A missing `docs/` yields no surfaces silently — that is a repo shape, not a
 * fault. Every OTHER failure (a permission error, `docs` being a file) becomes a
 * note rather than an empty result, so a broken walk cannot read as clean.
 *
 * @param cwd - Repository root
 * @returns The surfaces, and any degradation encountered reaching them
 */
export async function enumerateDocSurfaces(cwd: string): Promise<SurfaceScan> {
  const docsDir = join(cwd, 'docs');
  const hits: string[] = [];
  try {
    await walkMd(docsDir, hits, 'docs');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { surfaces: [], notes: [] };
    return { surfaces: [], notes: [`cannot walk docs/: ${code ?? (err as Error).message}`] };
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
  return { surfaces: [...surfaces].toSorted(), notes: [] };
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
}

/**
 * Surfaces no README link reaches. A surface is satisfied by any reached
 * markdown file, or any directly-linked directory, at or beneath it — both
 * branches use the same at-or-beneath test, so a link into a subdirectory
 * counts just as a link to the surface root does.
 *
 * @param surfaces - From {@link enumerateDocSurfaces}
 * @param reached - From {@link reachableTargets}
 * @returns The unreachable subset, input order preserved
 */
export function unreachableSurfaces(
  surfaces: readonly string[],
  reached: ReachSet,
): readonly string[] {
  const atOrBeneath = (candidate: string, surface: string): boolean =>
    candidate === surface || candidate.startsWith(`${surface}/`);
  return surfaces.filter((surface) => {
    for (const dir of reached.dirs) if (atOrBeneath(dir, surface)) return false;
    for (const file of reached.files) if (atOrBeneath(file, surface)) return false;
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
 * Artifact directories are dead ends, not just non-surfaces: the walk neither
 * records nor traverses a page inside one. Their Resources sections are written
 * by `sync fd-resources` from `links.docs`, so a generated link could otherwise
 * satisfy the gate on the README's behalf.
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
 *   seed's readability
 */
export async function reachableTargets(cwd: string): Promise<ReachSet> {
  const files = new Set<string>();
  const dirs = new Set<string>();
  const notes: string[] = [];
  const visited = new Set<string>(['README.md']);
  const queue: string[] = ['README.md'];
  let readme: ReachSet['readme'] = 'ok';

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
        if (!isArtifactPath(`${target}/x.md`)) dirs.add(target);
        continue;
      }
      if (!target.endsWith('.md')) continue; // cannot satisfy a surface
      // Dead end: neither a surface nor a route. See `isArtifactPath`.
      if (isArtifactPath(target)) continue;

      files.add(target);
      if (visited.has(target)) continue;
      visited.add(target);
      queue.push(target); // read at dequeue — no body is retained
    }
  }

  return { files, dirs, notes, readme };
}

export type ReadmeStatus = 'absent' | 'ok' | 'findings';

/** One thing the README fails to say that it should. */
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
 * Check that every documentation surface under `docs/` is reachable by following
 * links from the root `README.md`.
 *
 * Scope is deliberately reachability only. Validating the commands the README
 * quotes is tracked separately (Q-0148): `src/garden/detectors/fd-command-rot.ts`
 * already owns command resolution — `commandTokens`, the ~33-entry
 * `PNPM_BUILTINS`, and a registry unioning manifest leaves, bare group names,
 * `package.json` scripts and script-catalog aliases — so that half belongs on
 * those helpers rather than in a second, weaker implementation here.
 *
 * Never rejects for an EXPECTED failure — I/O errors and malformed input each
 * degrade to a note and the rest of the check continues. Programmer errors are
 * deliberately not caught: swallowing one would hide a defect behind a green
 * release row. `notes` never affect `status`, so a degraded run reports its
 * degradation rather than masquerading as a failure.
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

  const scan = await enumerateDocSurfaces(cwd);
  const findings = unreachableSurfaces(scan.surfaces, reached).map((surface) => ({
    message: `${surface}/ holds documentation but no link from README.md reaches it`,
  }));

  return {
    status: findings.length > 0 ? 'findings' : 'ok',
    findings,
    notes: [...reached.notes, ...scan.notes],
  };
}
