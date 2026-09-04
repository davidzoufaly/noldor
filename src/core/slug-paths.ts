import { closeSync, constants, lstatSync, openSync, readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
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
 * `O_NOFOLLOW`, or the reason this platform cannot offer it.
 *
 * A bitwise OR silently swallows an undefined flag — `1 | undefined` is `1` —
 * so a platform without `O_NOFOLLOW` would produce an ordinary
 * symlink-following open while the code still read as if it were guarded. That
 * is the worst kind of degradation, so the absence is detected instead.
 */
const O_NOFOLLOW: number | null =
  typeof constants.O_NOFOLLOW === 'number' && constants.O_NOFOLLOW !== 0
    ? constants.O_NOFOLLOW
    : null;

/**
 * Read a guarded path, refusing to follow a symlink at the final segment.
 *
 * The `lstat` in {@link slugPath} is a check-then-use: between it returning and
 * an ordinary pathname read, the segment can be replaced with a symlink. Kernel
 * `O_NOFOLLOW` closes that window for the FINAL component, because the refusal
 * happens *in* the open — there is no gap to race there.
 *
 * It does **not** cover an intermediate directory swapped for a symlink after
 * validation: `O_NOFOLLOW` constrains only the last component, and closing the
 * whole chain needs per-component `openat` (or `resolveBeneath`), which Node
 * does not expose. What remains uncovered is therefore stated rather than
 * implied — an attacker who can rewrite a directory inside the repository
 * already has write access to it, which is a strictly stronger position than
 * the argument-supplied traversal this feature exists to stop.
 *
 * Writes do not need a twin of this: {@link atomicWriteFileSync} writes a
 * sibling temp file and `rename`s it over the target, which replaces a planted
 * symlink rather than following it, and satisfies the atomicity the
 * `concurrency-write-discipline` rule requires for files other readers see.
 *
 * @param path - A path already vetted by {@link slugPath}.
 * @returns The file contents.
 * @throws When the final segment is a symlink, when the platform cannot offer
 *   `O_NOFOLLOW` at all, plus the usual IO errors.
 */
export function readFileNoFollow(path: string): string {
  const fd = openSync(path, readOnlyNoFollowFlags());
  try {
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

/** Async twin of {@link readFileNoFollow}, for the pid read on the async path. */
export async function readFileNoFollowAsync(path: string): Promise<string> {
  const handle = await open(path, readOnlyNoFollowFlags());
  try {
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

/** Open flags for a no-follow read, or a throw when the platform cannot. */
function readOnlyNoFollowFlags(): number {
  if (O_NOFOLLOW === null) {
    throw new Error(
      'refusing a guarded read: this platform does not expose O_NOFOLLOW, so a symlink swapped in after the check could not be refused',
    );
  }
  return constants.O_RDONLY | O_NOFOLLOW;
}

/**
 * {@link slugPath} for a `<slug>-<kind>.json` file under a `.noldor` subtree,
 * throwing rather than returning a result.
 *
 * The CR ledger and the arbitration record wanted byte-identical bodies for
 * this — the clone detector flagged the pair — and both want a throw: a branded
 * slug is already validated, so a refusal here means a symlink or a relocated
 * root under the subtree, which is repository tampering rather than a bad
 * argument. `what` names the artifact in that message, which is the only thing
 * the two call sites ever differed in.
 */
export function slugKindJsonPath(
  cwd: string,
  relRoot: readonly string[],
  slug: Slug,
  kind: string,
  what: string,
): string {
  const built = slugPath(cwd, relRoot, slug, { suffix: `-${kind}.json` });
  if (!built.ok) throw new Error(`cannot resolve ${what}: ${built.error.kind}`);
  return built.path;
}
