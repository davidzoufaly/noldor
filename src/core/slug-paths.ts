import { closeSync, constants, lstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
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
  | { readonly kind: 'unsafe-symlink'; readonly path: string }
  | { readonly kind: 'uninspectable'; readonly path: string; readonly reason: string };

/** A guarded path, or the reason it was refused. */
export type SlugPathResult = { ok: true; path: string } | { ok: false; error: PathError };

/** Literal text wrapped around the slug inside its single path segment. */
export interface SlugSegment {
  readonly prefix?: string;
  readonly suffix?: string;
}

/** Human-readable reason for a {@link PathError}, for a CLI's stderr. */
export function pathErrorMessage(error: PathError): string {
  switch (error.kind) {
    case 'unsafe-symlink':
      return `refusing '${error.path}': path is a symbolic link`;
    case 'uninspectable':
      return `refusing '${error.path}': cannot inspect it (${error.reason})`;
    default:
      return `refusing '${error.path}': resolves outside ${error.anchor}`;
  }
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
  const link = inspectLink(path);
  if (link !== 'absent' && link !== 'regular') {
    return link === 'symlink'
      ? { ok: false, error: { kind: 'unsafe-symlink', path } }
      : { ok: false, error: { kind: 'uninspectable', path, reason: link.reason } };
  }

  const resolvedAnchor = resolveExisting(anchor);
  if (!contained(resolveExisting(path), resolvedAnchor)) {
    return { ok: false, error: { kind: 'escapes-root', path, anchor: resolvedAnchor } };
  }

  return { ok: true, path };
}

/**
 * What the final segment is, as far as the guard can tell.
 *
 * `ENOENT` is the only error that means "not there" — a prospective path is
 * legal, which is how a not-yet-created worktree or milestone draft is allowed.
 * Every other error (`EACCES`, `ELOOP`, `EIO`, a permission-denied parent) is a
 * failure of the security check itself, and a check that cannot see its target
 * must not report it safe. Returning "absent" on those would let exactly the
 * paths the guard is least able to vouch for through.
 */
function inspectLink(path: string): 'absent' | 'regular' | 'symlink' | { reason: string } {
  try {
    return lstatSync(path).isSymbolicLink() ? 'symlink' : 'regular';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return 'absent';
    return { reason: code ?? String(err) };
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

/**
 * Read a guarded path, refusing to follow a symlink at the final segment.
 *
 * The `lstat` in {@link slugPath} is a check-then-use: between it returning and
 * an ordinary pathname read, the segment can be replaced with a symlink. Kernel
 * `O_NOFOLLOW` closes that window because the refusal happens *in* the open —
 * there is no gap to race. This is what the guard's promise is worth without
 * it, so the two belong together.
 *
 * @param path - A path already vetted by {@link slugPath}.
 * @returns The file contents.
 * @throws `ELOOP` when the final segment is a symlink, plus the usual IO errors.
 */
export function readFileNoFollow(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

/**
 * Write a guarded path, refusing to follow a symlink at the final segment.
 *
 * The read twin's reasoning applies: a pathname write after an `lstat` is
 * racy, and `O_NOFOLLOW` moves the refusal into the syscall.
 *
 * @param path - A path already vetted by {@link slugPath}.
 * @param body - Contents to write.
 * @throws `ELOOP` when the final segment is a symlink, plus the usual IO errors.
 */
export function writeFileNoFollow(path: string, body: string): void {
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    0o644,
  );
  try {
    writeFileSync(fd, body, 'utf8');
  } finally {
    closeSync(fd);
  }
}
