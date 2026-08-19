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
  penSlugFromFilename,
  planSlugFromFilename,
  specSlugFromFilename,
} from '../core/design-artifact-names.js';
import { loadDocRoots } from '../core/doc-roots.js';
import type { SessionMarker } from '../core/session.js';

export interface ArchiveMove {
  readonly kind: 'spec' | 'plan' | 'pen';
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
 * Outcome of deriving a dialogue key from a session marker.
 *
 * `none` and `invalid` are deliberately distinct: "this path runs no design
 * dialogue" is a clean no-op, whereas "this path owns artifacts but the marker
 * lacks the fields naming them" is broken input that must not read as success.
 */
export type DialogueKeyResult =
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid'; readonly missing: string };

/**
 * The dialogue key that named this session's design artifacts.
 *
 * `*-new` paths key on the feature slug; `*-attach` paths key on
 * `<parent>-<enhancement>` — the same string that named the spec file at the
 * gate's Step 2.5. `fast-track` / `micro-chore` / `release-*` run no design
 * dialogue (`none`). The session schema marks `slug` / `parent` /
 * `enhancement` optional, so a hand-written or truncated marker can omit a
 * field its path requires; that is `invalid`, never a partial key.
 */
export function dialogueKeyFromSession(m: SessionMarker): DialogueKeyResult {
  switch (m.path) {
    case 'specs-only-new':
    case 'full-new':
      if (m.slug === undefined) return { kind: 'invalid', missing: 'slug' };
      return { kind: 'key', key: m.slug };
    case 'specs-only-attach':
    case 'full-attach': {
      const missing = [
        ...(m.parent === undefined ? ['parent'] : []),
        ...(m.enhancement === undefined ? ['enhancement'] : []),
      ];
      if (missing.length > 0) return { kind: 'invalid', missing: missing.join(' + ') };
      return { kind: 'key', key: `${m.parent}-${m.enhancement}` };
    }
    case 'fast-track':
    case 'micro-chore':
    case 'release-sweep':
    case 'release-automation':
      return { kind: 'none' };
    default: {
      // Exhaustiveness backstop: a new member of `PATHS` must be classified
      // here explicitly. `never` makes that a type error at compile time; the
      // `invalid` result keeps an unclassified path from archiving by accident.
      const unhandled: never = m.path;
      void unhandled;
      return { kind: 'invalid', missing: `unclassified path ${String(m.path)}` };
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
  kind: ArchiveMove['kind'],
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

  const slugOf =
    kind === 'spec'
      ? specSlugFromFilename
      : kind === 'plan'
        ? planSlugFromFilename
        : penSlugFromFilename;
  const ext = kind === 'pen' ? '.pen' : '.md';
  /** Archive listing, read at most once and only if some entry matches the key. */
  let archived: Set<string> | null = null;

  for (const entry of entries) {
    // No file-type check needed: a directory named `<date>-<key>-design.md`
    // could parse to the key, but a directory is never a git path, so the
    // `branchAdded` gate below excludes it. (Baseline pens live under
    // `baseline/` and are undated, so the pen parser never matches them.)
    if (!entry.endsWith(ext)) continue;
    if (slugOf(entry) !== key) continue;

    // `loadDocRoots` returns absolute paths; git speaks repo-relative. Normalize
    // with forward slashes so the ownership-gate comparison holds on Windows too.
    const from = relative(repo, join(dir, entry)).split('\\').join('/');
    if (!branchAdded.has(from)) continue;

    archived ??= new Set(await readdir(join(dir, ARCHIVE_DIR)).catch(() => []));
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
  const pens = await collect('pen', roots.designUi, repo, key, added, readdir);

  return {
    key,
    moves: [...specs.moves, ...plans.moves, ...pens.moves],
    skipped: [...specs.skipped, ...plans.skipped, ...pens.skipped],
  };
}
