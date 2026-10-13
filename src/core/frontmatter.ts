import matter from 'gray-matter';

/**
 * Write a markdown file's frontmatter back over its body, with exactly one blank
 * line between the closing `---` and the body — the separator oxfmt formats in.
 *
 * `matter.stringify` emits `---\n<yaml>---\n` followed by the body verbatim, and
 * gray-matter's parse leaves that blank line at the head of `content`. A writer
 * that strips it, or a body that never had it, lands the first heading right
 * under the `---`. Every frontmatter writer goes through here so none of them
 * drops the line again.
 *
 * @param body - The markdown body; leading newlines are normalized away
 * @param data - The frontmatter object to serialize
 * @returns The full file contents
 */
export function stringifyWithFrontmatter(body: string, data: object): string {
  return matter.stringify(`\n${body.replace(/^\n+/, '')}`, data);
}
