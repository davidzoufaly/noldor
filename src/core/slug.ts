import { z } from 'zod';

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

/**
 * A string proven to satisfy {@link SLUG_RE}.
 *
 * The brand exists so path builders can demand proof rather than trust: only
 * {@link parseSlug} and {@link isSlug} produce one, so handing a raw argv value
 * to a builder is a compile error instead of a review finding. It does not stop
 * a call site from bypassing the builders and joining a raw string itself —
 * nothing available under TypeScript 7 does (see `src/invariants/`), which is
 * why the advisory scan exists alongside it.
 */
export type Slug = string & { readonly __slug: unique symbol };

/** Why a value was refused as a slug. */
export interface SlugError {
  readonly kind: 'invalid-slug';
  readonly value: string;
  readonly message: string;
}

/** The one rejection message, so one condition reads the same everywhere. */
export function slugErrorMessage(value: string): string {
  return `invalid slug '${value}': expected kebab-case ([a-z0-9-])`;
}

/**
 * Whether `value` is a well-formed slug per {@link SLUG_RE}.
 *
 * @param value - Candidate text.
 * @returns True when `value` is a slug, narrowing it to {@link Slug}.
 */
export function isSlug(value: string): value is Slug {
  return SLUG_RE.test(value);
}

/**
 * Parse untrusted text into a {@link Slug}.
 *
 * This is the trust boundary: an invalid slug is an expected failure of
 * external input, so it comes back as a result rather than a throw.
 *
 * @param value - Text from argv, a flag, or repository frontmatter.
 * @returns The branded slug, or the reason it was refused.
 */
export function parseSlug(
  value: string,
): { ok: true; slug: Slug } | { ok: false; error: SlugError } {
  if (!isSlug(value)) {
    return { ok: false, error: { kind: 'invalid-slug', value, message: slugErrorMessage(value) } };
  }
  return { ok: true, slug: value };
}

/**
 * Zod schema for a slug-shaped frontmatter field.
 *
 * The `transform` is load-bearing: a bare `z.string().regex(...)` infers
 * `string`, which would not satisfy a path builder demanding a {@link Slug}, so
 * the brand has to be produced at the parse boundary.
 */
export const slugSchema: z.ZodType<Slug, z.ZodTypeDef, string> = z
  .string()
  .regex(SLUG_RE, 'expected kebab-case ([a-z0-9-])')
  .transform((v) => v as Slug);

/**
 * Parse a comma-separated slug list from a CLI flag.
 *
 * Each member names artifacts on disk, so each is a path component and each is
 * parsed — a list flag that validated only its first entry would be the same
 * per-call-site drift {@link parseSlug} exists to prevent.
 *
 * @param value - Raw flag text, e.g. `a-b, c-d`.
 * @returns The parsed slugs.
 * @throws When any member is not a slug — these are argv parsers, whose
 *   surrounding convention is to throw on a malformed flag.
 */
export function parseSlugList(value: string): Slug[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw) => {
      const parsed = parseSlug(raw);
      if (!parsed.ok) throw new Error(parsed.error.message);
      return parsed.slug;
    });
}

/**
 * The value of a flag that requires one.
 *
 * Coalescing a missing value to `''` makes a list parser return `[]`, so a
 * trailing `--slugs` reads as "no filter requested" instead of a malformed
 * command — a silent difference in what the command then does.
 *
 * @param value - `argv[++i]`, possibly `undefined`.
 * @param flag - Flag name, for the diagnostic.
 * @returns The value.
 * @throws When the flag was given without one.
 */
export function requireFlagValue(value: string | undefined, flag: string): string {
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}
