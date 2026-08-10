/**
 * The canonical slug shape: lowercase kebab-case, no leading, trailing or
 * doubled separator. Feature slugs, roadmap entry slugs and branch names all
 * use it.
 *
 * Shared because slugs are `join`ed into paths that get read, written and
 * renamed, so every entry point that accepts one from outside needs the SAME
 * check — a per-call-site copy is how one of them ends up looser than the rest.
 * `../..` fails it, which is the property the path-building callers rely on.
 */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Whether `value` is a well-formed slug per {@link SLUG_RE}. */
export function isSlug(value: string): boolean {
  return SLUG_RE.test(value);
}
