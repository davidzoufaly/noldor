import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';

import { walkRepo } from './fd-load.js';
import { slugPath, type PathError } from './slug-paths.js';
import type { Slug } from './slug.js';

export interface DocRoots {
  adr: string;
  features: string;
  roadmap: string;
  backlog: string;
  vision: string;
  ideas: string;
  milestones: string;
  plans: string;
  specs: string;
  /** UI-design artifacts: feature `.pen` files + `baseline/` + `archive/`. */
  designUi: string;
  architecture: string;
}

/**
 * Resolve a design-doc subdir renamed `docs/superpowers/<sub>` →
 * `docs/design/<sub>` in 1.0.0 (Q-0006). Prefer the new location; fall back to
 * the legacy path ONLY when the new dir is absent and the legacy dir still
 * exists — i.e. a consumer who bumped the package but has not yet run
 * `noldor upgrade`. When neither exists (fresh repo, or a writer creating the
 * first spec/plan) the new location wins so nothing lands under the old name.
 *
 * TRANSITION ALIAS — delete this fallback in the release after 1.0.0, once
 * every consumer has run the 1.0.0 migration. Tracked by Q-0006.
 */
function resolveDesignSubdir(cwd: string, sub: 'plans' | 'specs' | 'ui'): string {
  const next = join(cwd, 'docs', 'design', sub);
  if (existsSync(next)) return next;
  const legacy = join(cwd, 'docs', 'superpowers', sub);
  if (existsSync(legacy)) return legacy;
  return next;
}

/**
 * Returns absolute paths to the standard noldor doc locations anchored at
 * `cwd`: features/ (feature MDs), roadmap.md, backlog.md, vision.md,
 * ideas.md (repo ROOT, not docs/ — tracked here; consumers may gitignore theirs),
 * milestones/ (milestone MDs), plans/ (design/plans),
 * specs/ (design/specs), and architecture/ (the C4-ish diagram pages).
 * Default is `process.cwd()`. Use as a single
 * source of truth instead of scattering `process.cwd()/docs/...` strings
 * across dashboard, garden, and core modules.
 *
 * `plans`/`specs` route through {@link resolveDesignSubdir} so a not-yet-migrated
 * consumer (docs/superpowers still on disk) keeps resolving during the 1.0.0
 * transition window.
 */
export function loadDocRoots(cwd: string = process.cwd()): DocRoots {
  return {
    adr: join(cwd, 'docs', 'adr'),
    features: join(cwd, 'docs', 'features'),
    roadmap: join(cwd, 'docs', 'roadmap.md'),
    backlog: join(cwd, 'docs', 'backlog.md'),
    vision: join(cwd, 'docs', 'vision.md'),
    ideas: join(cwd, 'ideas.md'),
    milestones: join(cwd, 'docs', 'milestones'),
    plans: resolveDesignSubdir(cwd, 'plans'),
    specs: resolveDesignSubdir(cwd, 'specs'),
    // Routed through the same resolver as plans/specs for consistency on a
    // not-yet-migrated consumer. In practice the legacy branch never fires —
    // the ui/ subdir postdates the 1.0.0 rename, so docs/superpowers/ui never
    // exists — but one resolution policy beats two.
    designUi: resolveDesignSubdir(cwd, 'ui'),
    architecture: join(cwd, 'docs', 'architecture'),
  };
}

/**
 * Doc directories the `<!-- @feature: -->` tag scan projects from, and the same
 * set `validateDocFeatureSlugs` validates over — so every tag `sync doc-links`
 * honors is also slug-checked.
 *
 * `docs/noldor` is deliberately absent. Its pages are byte-identical twins of
 * `templates/docs/noldor/`, synced verbatim into every consumer, so a tag added
 * there must be mirrored into `templates/` or `checks template-sync` fails,
 * mirroring ships framework-internal FD slugs into consumer trees, and a
 * consumer's own edit is overwritten on the next upgrade. Excluding it is what
 * lets slug validation run over the full projection set without redding anyone.
 *
 * @param cwd - Consumer root (default `process.cwd()`)
 * @returns Absolute directory paths, missing ones included (walkers ENOENT-skip)
 */
export function docProjectionRoots(cwd: string = process.cwd()): string[] {
  return [
    join(cwd, 'docs', 'user', 'tutorials'),
    join(cwd, 'docs', 'user', 'explanation'),
    join(cwd, 'docs', 'user', 'how-to'),
  ];
}

/**
 * Doc directories where a `<!-- @feature: -->` tag is *required* — the narrow
 * subset {@link docProjectionRoots} covers. Read by `validateDocTagPresence` and
 * by garden's "tutorials without @feature tag" detector.
 *
 * Narrower than the projection set because a how-to page documents a task rather
 * than a feature, so demanding a tag there would red repos that simply have
 * how-tos.
 *
 * @param cwd - Consumer root (default `process.cwd()`)
 * @returns Absolute directory paths
 */
export function docPresenceRoots(cwd: string = process.cwd()): string[] {
  return [join(cwd, 'docs', 'user', 'tutorials'), join(cwd, 'docs', 'user', 'explanation')];
}

/**
 * Every `.md` under the given roots, **recursively**, as repo-relative paths.
 *
 * Recursive on purpose: the tag projection's walker recurses, so a lister that
 * only reads the top level would let `sync doc-links` honor a tag in a
 * subdirectory that no validator ever slug-checks. Delegates to {@link walkRepo}
 * rather than repeating its hidden-entry and build-artefact rules, and inherits
 * its policy: a missing root contributes nothing, any other read failure bubbles.
 *
 * @param roots - Absolute directories from {@link docProjectionRoots} or {@link docPresenceRoots}
 * @param cwd - Root the returned paths are relative to (default `process.cwd()`)
 * @returns Repo-relative doc paths
 */
export async function listDocMds(roots: string[], cwd: string = process.cwd()): Promise<string[]> {
  const files: string[] = [];
  for (const root of roots) await walkRepo(root, files);
  return files
    .filter((f) => f.endsWith('.md'))
    .map((f) => relative(cwd, f))
    .toSorted();
}

/** A guarded slug-rooted doc path, or the reason it was refused. */
export type DocPathResult = { ok: true; path: string } | { ok: false; error: PathError };

/**
 * Absolute path of a slug-named markdown doc beneath `cwd`, guarded.
 *
 * The `relRoot` mirrors {@link loadDocRoots}'s entry rather than reading it
 * back, because {@link slugPath} composes the root from the anchor on purpose —
 * handing it a ready-made root is what lets a relocated or symlinked directory
 * define its own legality.
 *
 * @param cwd - Consumer root, the containment anchor.
 * @param relRoot - Directory segments beneath the anchor.
 * @param slug - An already-parsed slug.
 * @returns The absolute path, or the reason it was refused.
 */
function docSlugPath(cwd: string, relRoot: readonly string[], slug: Slug): DocPathResult {
  return slugPath(cwd, relRoot, slug, { suffix: '.md' });
}

/** Absolute path of a feature MD, guarded. See {@link docSlugPath}. */
export function featurePath(cwd: string, slug: Slug): DocPathResult {
  return docSlugPath(cwd, ['docs', 'features'], slug);
}

/** Absolute path of a milestone MD, guarded. See {@link docSlugPath}. */
export function milestonePath(cwd: string, slug: Slug): DocPathResult {
  return docSlugPath(cwd, ['docs', 'milestones'], slug);
}
