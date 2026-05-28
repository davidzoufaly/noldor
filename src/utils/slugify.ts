/**
 * Slugify a human-readable name into a stable URL-safe identifier.
 *
 * Rule: lowercase, replace whitespace + slashes with hyphens, strip any
 * character outside `[a-z0-9-]`, collapse hyphen runs, strip leading and
 * trailing hyphens. May return an empty string when the input has no
 * slug-safe characters — callers handle that case (collision tracker
 * rejects empty slugs; HTTP layer 400s).
 *
 * @example
 * slugify('Undo/Redo'); // 'undo-redo'
 * slugify("Path 2: Explicit `- priority:` Field"); // 'path-2-explicit-priority-field'
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s/]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
