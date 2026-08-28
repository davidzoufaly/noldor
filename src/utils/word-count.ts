/**
 * Whitespace-token word count, empty-safe.
 *
 * Lives in `utils` rather than beside its first caller for the reason
 * `markdown-sections.ts` gives one file over: generic text measurement is not a
 * split-heuristics concern. An architecture-page prose budget and a
 * roadmap-entry size heuristic are unrelated measures with no reason to move
 * together, so `src/docs` borrowing this from `core/split-suggestion.ts` would
 * be a dependency on the wrong thing rather than shared ownership.
 *
 * @param text - Any text
 * @returns Number of whitespace-separated tokens
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}
