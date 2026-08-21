// @fd: root-readme-content-validator
import { lstat, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  buildCommandRegistry,
  extractCommandRefs,
  refResolves,
  tableBareNames,
} from '../cli/command-registry.js';
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
 * True when a repo-relative path IS or lives inside an artifact directory —
 * accepting both a file and a directory, so the file and directory call sites in
 * the walk share one honest test rather than one of them faking a basename.
 *
 * `docs` alone is length 1 and never matches, which is right: it is not a
 * surface either. The file site runs only after an `.md` check, so a file
 * literally named `docs/features.md` reads its own basename as the segment and
 * correctly does not match.
 *
 * Those pages
 * are machine-written (`sync fd-resources` / `sync doc-links` fill an FD's
 * Resources section from `links.docs`), so they are neither surfaces nor
 * *routes*: letting the walk pass through one would let a generated link satisfy
 * the very gate the artifact's feature exists to enforce.
 */
function isArtifactPath(target: string): boolean {
  const parts = target.split('/');
  return parts[0] === 'docs' && parts.length > 1 && ARTIFACT_DIRS.has(parts[1] ?? '');
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
        if (!isArtifactPath(target)) dirs.add(target);
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

/**
 * Every command the README quotes that no longer resolves against the live CLI
 * surface, in two extractions over one registry:
 *
 * - **Invocations** — backticked `pnpm …` / `noldor …` spans and fenced-block
 *   lines, via the same `commandTokens` / `refResolves` pair the
 *   fd-command-rot detector uses (Q-0148 exists because a second, weaker
 *   implementation here misparsed `pnpm --filter web run build` as `pnpm web`
 *   and false-flagged pnpm built-ins).
 * - **Table cells** — the `## CLI reference` table quotes *bare* group names
 *   (`` `init` ``, `` `cr` ``) that `commandTokens` rightly rejects, so table
 *   cells get their own pass. A table counts as a command table only when a
 *   strict majority of its bare backticked names resolve; that self-calibration
 *   is what keeps the platform-assets and gate-paths tables (whose cells
 *   resolve to nothing) from false-flagging, with no heading-text coupling.
 *   Deletion test: rename a manifest group the README quotes and the stale
 *   name is the minority member of a still-majority-resolved table.
 *
 * Pure over its inputs; the caller owns reading the README and the registry.
 */
export function commandFindings(body: string, registry: Set<string>): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const flag = (display: string): void => {
    if (seen.has(display)) return;
    seen.add(display);
    findings.push({
      message: `README.md quotes a command not in the CLI surface (manifest/scripts/script-catalog): ${display}`,
    });
  };

  for (const ref of extractCommandRefs(body)) {
    if (!refResolves(ref.tokens, registry)) flag(ref.display);
  }

  for (const names of tableBareNames(body)) {
    const unresolved = names.filter((n) => !registry.has(n));
    if (unresolved.length * 2 < names.length) for (const n of unresolved) flag(n);
  }

  return findings;
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
 * Check the root `README.md` on two axes: every documentation surface under
 * `docs/` is reachable by following links from it, and every command it quotes
 * still resolves against the live CLI surface (via the shared
 * `src/cli/command-registry.ts` helpers the fd-command-rot detector also uses —
 * one resolver, not a third copy; Q-0148).
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
  const findings: Finding[] = unreachableSurfaces(scan.surfaces, reached).map((surface) => ({
    message: `${surface}/ holds documentation but no link from README.md reaches it`,
  }));

  const notes = [...reached.notes, ...scan.notes];
  try {
    // Re-read rather than threading the body out of the walk: the walk drops
    // each body at dequeue by design, and `readme === 'ok'` above already
    // proved the seed readable — a failure here is a genuine race, noted.
    const body = await readFile(join(cwd, 'README.md'), 'utf8');
    findings.push(...commandFindings(body, await buildCommandRegistry(cwd)));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    notes.push(`cannot re-read README.md for command check: ${code ?? 'unknown'}`);
  }

  return {
    status: findings.length > 0 ? 'findings' : 'ok',
    findings,
    notes,
  };
}
