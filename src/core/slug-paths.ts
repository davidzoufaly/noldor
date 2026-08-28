import { lstatSync } from 'node:fs';
import { join, sep } from 'node:path';

import { resolveExisting } from './branch-added.js';
import { parseSlug, type Slug, type SlugError } from './slug.js';

/**
 * True when `candidate` is the anchor or sits beneath it.
 *
 * The `sep` on the prefix is what separates `docs/design/specs/x.md` from
 * `docs/design/specs-scratch/x.md` — a bare `startsWith` accepts both.
 */
export function contained(candidate: string, anchor: string): boolean {
  return candidate === anchor || candidate.startsWith(anchor + sep);
}

/** Why a slug-rooted path was refused. Slug validity is not an arm: {@link slugPath}
 *  takes an already-parsed {@link Slug}, so it cannot fail that way. */
export type PathError =
  | { readonly kind: 'escapes-root'; readonly path: string; readonly anchor: string }
  | { readonly kind: 'unsafe-symlink'; readonly path: string };

/** A guarded path, or the reason it was refused. */
export type SlugPathResult = { ok: true; path: string } | { ok: false; error: PathError };

/** Literal text wrapped around the slug inside its single path segment. */
export interface SlugSegment {
  readonly prefix?: string;
  readonly suffix?: string;
}

/** Human-readable reason for a {@link PathError}, for a CLI's stderr. */
export function pathErrorMessage(error: PathError): string {
  if (error.kind === 'unsafe-symlink') {
    return `refusing '${error.path}': path is a symbolic link`;
  }
  return `refusing '${error.path}': resolves outside ${error.anchor}`;
}

/**
 * The one place a slug-rooted path is built.
 *
 * The composed path is `join(anchor, ...relRoot, prefix + slug + suffix)`. The
 * root is composed *from* the anchor rather than passed in ready-made, so a
 * relocated or symlinked root cannot define its own legality: containment is
 * always judged against the anchor.
 *
 * Both sides are normalized with {@link resolveExisting} before comparison,
 * which is mandatory rather than defensive — a `/var` versus `/private/var`
 * mismatch would otherwise reject every legal path.
 *
 * @param anchor - Repository root; the boundary containment is judged against.
 * @param relRoot - Directory segments beneath the anchor, e.g. `['docs', 'features']`.
 * @param slug - An already-parsed slug.
 * @param seg - Literal text wrapped around the slug within its own segment.
 * @returns The absolute path, or the reason it was refused.
 */
export function slugPath(
  anchor: string,
  relRoot: readonly string[],
  slug: Slug,
  seg: SlugSegment = {},
): SlugPathResult {
  const path = join(anchor, ...relRoot, `${seg.prefix ?? ''}${slug}${seg.suffix ?? ''}`);

  // Symlink first, so every symlinked slug segment reports one kind regardless
  // of where it points. It also has to happen at all: a DANGLING link survives
  // containment, because realpath throws on it and resolveExisting falls back
  // to the parent and re-appends basename — returning the LINK's own path,
  // which is inside the anchor. The next write then follows it outside. No
  // legitimate Noldor path has a symlink at its slug segment (every one of them
  // is framework-created), so the category is refused without resolving it.
  if (isSymlink(path)) {
    return { ok: false, error: { kind: 'unsafe-symlink', path } };
  }

  const resolvedAnchor = resolveExisting(anchor);
  if (!contained(resolveExisting(path), resolvedAnchor)) {
    return { ok: false, error: { kind: 'escapes-root', path, anchor: resolvedAnchor } };
  }

  return { ok: true, path };
}

/** Whether `path` is itself a symbolic link. A missing path is not one. */
function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false; // absent: a prospective path is legal, and any real IO error resurfaces at use
  }
}

/** Why a slug-rooted path could not be resolved from untrusted text. */
export type ResolveError = SlugError | PathError;

/** Human-readable reason for a {@link ResolveError}, for a CLI's stderr. */
export function resolveErrorMessage(error: ResolveError): string {
  return error.kind === 'invalid-slug' ? error.message : pathErrorMessage(error);
}

/**
 * Parse untrusted text and build its guarded path in one step.
 *
 * Every family needs exactly this pair before its first side effect, and doing
 * it as a hand-repeated two-block preamble is how one call site ends up
 * checking less than the rest — the same failure {@link parseSlug} exists to
 * prevent, one level up.
 *
 * @param anchor - Repository root; the boundary containment is judged against.
 * @param relRoot - Directory segments beneath the anchor.
 * @param slug - Untrusted slug text.
 * @param seg - Literal text wrapped around the slug within its own segment.
 * @returns The branded slug and its path, or the reason it was refused.
 */
export function resolveSlugPath(
  anchor: string,
  relRoot: readonly string[],
  slug: string,
  seg: SlugSegment = {},
): { ok: true; slug: Slug; path: string } | { ok: false; error: ResolveError } {
  const parsed = parseSlug(slug);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const built = slugPath(anchor, relRoot, parsed.slug, seg);
  if (!built.ok) return { ok: false, error: built.error };
  return { ok: true, slug: parsed.slug, path: built.path };
}
