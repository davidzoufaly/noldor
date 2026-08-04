// @tests: doc-gardening-skill
// Which design artifacts does THIS gate session own, and where do they belong?
// Pure resolution half of `noldor design archive` (archive-cli.ts owns the git
// side effects). Selection is session-scoped and gated on branch-added
// membership — see the spec's "ownership gate" section for why filename
// matching alone is not safe.

import { readdir as fsReaddir } from 'node:fs/promises';
import { join, relative } from 'node:path';

import {
  ARCHIVE_DIR,
  planSlugFromFilename,
  specSlugFromFilename,
} from '../core/design-artifact-names.js';
import { loadDocRoots } from '../core/doc-roots.js';
import type { SessionMarker } from '../core/session.js';

export interface ArchiveMove {
  readonly kind: 'spec' | 'plan';
  /** Repo-relative source path, e.g. `docs/design/specs/<date>-<key>-design.md`. */
  readonly from: string;
  /** Repo-relative destination, e.g. `docs/design/specs/archive/<basename>`. */
  readonly to: string;
}

export interface SkippedArtifact {
  readonly from: string;
  readonly reason: 'collision';
}

export interface ArchivePlan {
  readonly key: string;
  readonly moves: readonly ArchiveMove[];
  readonly skipped: readonly SkippedArtifact[];
}

/**
 * The dialogue key that named this session's design artifacts, or `null` when
 * the session's path carries none.
 *
 * `*-new` paths key on the feature slug; `*-attach` paths key on
 * `<parent>-<enhancement>` — the same string that named the spec file at the
 * gate's Step 2.5. `fast-track` / `micro-chore` / `release-*` run no design
 * dialogue. A marker missing the fields its path needs yields `null` rather
 * than a partial key.
 */
export function dialogueKeyFromSession(m: SessionMarker): string | null {
  switch (m.path) {
    case 'specs-only-new':
    case 'full-new':
      return m.slug ?? null;
    case 'specs-only-attach':
    case 'full-attach':
      if (m.parent === undefined || m.enhancement === undefined) return null;
      return `${m.parent}-${m.enhancement}`;
    case 'fast-track':
    case 'micro-chore':
    case 'release-sweep':
    case 'release-automation':
      return null;
    default: {
      // Exhaustiveness backstop: a new member of `PATHS` must be classified
      // here explicitly. `never` makes that a type error at compile time; the
      // `return null` keeps a hand-written marker from archiving by accident.
      const unhandled: never = m.path;
      void unhandled;
      return null;
    }
  }
}

interface ResolveOptions {
  repo: string;
  /**
   * Dialogue key the artifacts must match. Callers derive it with
   * {@link dialogueKeyFromSession} (or take it from `--slug`) so they own the
   * "this path carries no artifacts" message; this function only resolves.
   */
  key: string;
  /** Repo-relative paths added on this branch (the ownership gate). */
  branchAdded: readonly string[];
  /** Test seam — defaults to fs/promises readdir. */
  readdir?: (path: string) => Promise<string[]>;
}

async function collect(
  kind: 'spec' | 'plan',
  dir: string,
  repo: string,
  key: string,
  branchAdded: ReadonlySet<string>,
  readdir: (path: string) => Promise<string[]>,
): Promise<{ moves: ArchiveMove[]; skipped: SkippedArtifact[] }> {
  const moves: ArchiveMove[] = [];
  const skipped: SkippedArtifact[] = [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { moves, skipped };
  }

  const slugOf = kind === 'spec' ? specSlugFromFilename : planSlugFromFilename;
  const archived = new Set(await readdir(join(dir, ARCHIVE_DIR)).catch(() => []));

  for (const entry of entries) {
    // No file-type check needed: a directory named `<date>-<key>-design.md`
    // could parse to the key, but a directory is never a git path, so the
    // `branchAdded` gate below excludes it.
    if (!entry.endsWith('.md')) continue;
    if (slugOf(entry) !== key) continue;

    // `loadDocRoots` returns absolute paths; git speaks repo-relative. Normalize
    // with forward slashes so the ownership-gate comparison holds on Windows too.
    const from = relative(repo, join(dir, entry)).split('\\').join('/');
    if (!branchAdded.has(from)) continue;

    if (archived.has(entry)) {
      skipped.push({ from, reason: 'collision' });
      continue;
    }
    const to = relative(repo, join(dir, ARCHIVE_DIR, entry))
      .split('\\')
      .join('/');
    moves.push({ from, kind, to });
  }
  return { moves, skipped };
}

/**
 * Resolve the spec/plan artifacts this session should archive.
 *
 * An artifact is eligible only when (a) its dated filename parses to the
 * session's dialogue key AND (b) its repo-relative path is in `branchAdded`.
 * (b) is what makes a foreign feature's live spec unreachable: the concat key
 * `<parent>-<enhancement>` is not injective and the filename parsers ignore
 * the date prefix, so (a) alone can match artifacts this session does not own.
 *
 * @returns An {@link ArchivePlan}, possibly with empty `moves` — a re-run after
 *   the artifacts already moved, a specs-only feature with no plan, or a key
 *   whose artifacts were committed on an earlier branch.
 */
export async function resolveArchivePlan(options: ResolveOptions): Promise<ArchivePlan> {
  const { repo, key, branchAdded } = options;
  const readdir = options.readdir ?? ((p) => fsReaddir(p));

  const roots = loadDocRoots(repo);
  const added = new Set(branchAdded);

  const specs = await collect('spec', roots.specs, repo, key, added, readdir);
  const plans = await collect('plan', roots.plans, repo, key, added, readdir);

  return {
    key,
    moves: [...specs.moves, ...plans.moves],
    skipped: [...specs.skipped, ...plans.skipped],
  };
}
