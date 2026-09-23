/** Letters NFKD leaves whole — no decomposition, so the mark strip cannot fold them. */
const FOLD: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  ø: 'o',
  œ: 'oe',
  ł: 'l',
  đ: 'd',
  þ: 'th',
};

/**
 * Slugify a human-readable name into a stable URL-safe identifier.
 *
 * Rule: fold accented letters to their ASCII base (`ç → c`, `é → e`), lowercase,
 * replace whitespace + slashes with hyphens, strip any character outside
 * `[a-z0-9-]`, collapse hyphen runs, strip leading and trailing hyphens. May
 * return an empty string when the input has no slug-safe characters — callers
 * handle that case (collision tracker rejects empty slugs; HTTP layer 400s).
 *
 * The fold runs first because the strip would otherwise DELETE the letter, so
 * `Façades` became `faades` — a slug nobody guesses from the heading, and one
 * a guessed `--split-into` slug silently fails to match. NFKD splits a letter
 * from its diacritic; the map covers letters with no decomposition.
 *
 * @example
 * slugify('Undo/Redo'); // 'undo-redo'
 * slugify("Path 2: Explicit `- priority:` Field"); // 'path-2-explicit-priority-field'
 * slugify('Façades'); // 'facades'
 */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[ßæøœłđþ]/g, (c) => FOLD[c] ?? c)
    .replace(/[\s/]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
