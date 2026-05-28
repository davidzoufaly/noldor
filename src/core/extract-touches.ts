// @tests: feature-md-links-overhaul

/**
 * Result of stripping a trailing `Touches: …` clause from a markdown blob.
 * `paths` is the de-duplicated, order-preserving list of file paths found in
 * the clause; `stripped` is the input with the clause removed and trailing
 * whitespace collapsed.
 */
export interface TouchesExtraction {
  paths: string[];
  stripped: string;
}

const BACKTICK_TOKEN_RE = /`([^`]+)`/g;
const MD_LINK_TOKEN_RE = /\[([^\]]+)\]\([^)]*\)/g;

/**
 * Path-shape predicate. Distinguishes file paths from prose tokens that
 * happen to be backtick-wrapped (e.g. function names like `parseRoadmap`).
 * A token qualifies as a path if it contains `/` (directory separator) OR
 * ends in a known source/doc extension.
 */
const PATH_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.mdx',
  '.yaml',
  '.yml',
  '.toml',
  '.sh',
  '.css',
  '.html',
];

function looksLikePath(token: string): boolean {
  const trimmed = token.trim().replace(/[.,;:]+$/, '');
  if (trimmed.includes('/')) return true;
  return PATH_EXTENSIONS.some((ext) => trimmed.endsWith(ext));
}

function normalizePath(token: string): string {
  // Strip trailing punctuation and any `:NNN` line-number suffix.
  return token
    .trim()
    .replace(/:\d+$/, '')
    .replace(/[.,;:]+$/, '');
}

/**
 * Parse the trailing `Touches: <paths>` clause from `body` (typically the
 * first paragraph of a roadmap or backlog source block). Returns the
 * extracted paths plus the body with the clause removed.
 *
 * Supported path forms within the clause: bare-backtick (e.g. `` `scripts/foo.ts` ``)
 * and markdown links (e.g. `[scripts/foo.ts](../../scripts/foo.ts)` — the
 * label is taken as the canonical path). Non-path tokens (function names
 * like `` `parseRoadmap` ``) are rejected via the `looksLikePath` predicate.
 * Mixed forms are supported. Paths are de-duplicated; order is preserved by
 * first occurrence.
 *
 * Clause termination: the clause extends from `Touches:` to the FIRST
 * sentence-ending `.` followed by either end-of-string or whitespace.
 * Subsequent sentences (e.g. "Possible drift: …") remain in `stripped`.
 *
 * Only the LAST `Touches:` occurrence in `body` is treated as the clause —
 * earlier mentions (inline prose) are left intact.
 *
 * @param body - Markdown paragraph(s) to scan
 * @returns Object with `paths` and `stripped` body
 */
export function extractTouches(body: string): TouchesExtraction {
  const lastIdx = body.lastIndexOf('Touches:');
  if (lastIdx < 0) {
    return { paths: [], stripped: body };
  }
  const head = body.slice(0, lastIdx);
  const tail = body.slice(lastIdx + 'Touches:'.length);
  // Find the first sentence-ending period followed by whitespace or EOS.
  // Avoid swallowing periods inside paths/extensions by requiring the period
  // to be outside any backtick or paren pair. Two-pass:
  //   1. Mask backtick + md-link spans so their internal `.` are invisible.
  //   2. Locate first `\.\s` or `\.$` in the masked tail.
  const masked = tail
    .replace(BACKTICK_TOKEN_RE, (s) => ' '.repeat(s.length))
    .replace(MD_LINK_TOKEN_RE, (s) => ' '.repeat(s.length));
  const endMatch = masked.match(/\.(?=\s|$)/);
  const clauseEnd = endMatch?.index !== undefined ? endMatch.index + 1 : tail.length;
  const clause = tail.slice(0, clauseEnd);
  const rest = tail.slice(clauseEnd);

  const seen = new Set<string>();
  const paths: string[] = [];

  // Collect md-link and backtick tokens in a single document-order pass.
  // Md-link spans are scanned first to compute their byte ranges; then a
  // backtick scan over a md-link-masked copy avoids re-counting any
  // backticks that happen to live inside a link label.
  type Hit = { readonly index: number; readonly token: string };
  const hits: Hit[] = [];
  for (const m of clause.matchAll(MD_LINK_TOKEN_RE)) {
    if (m.index === undefined) continue;
    hits.push({ index: m.index, token: m[1] ?? '' });
  }
  const clauseNoLinks = clause.replace(MD_LINK_TOKEN_RE, (s) => ' '.repeat(s.length));
  for (const m of clauseNoLinks.matchAll(BACKTICK_TOKEN_RE)) {
    if (m.index === undefined) continue;
    hits.push({ index: m.index, token: m[1] ?? '' });
  }
  hits.sort((a, b) => a.index - b.index);
  for (const hit of hits) {
    const p = normalizePath(hit.token);
    if (looksLikePath(p) && !seen.has(p)) {
      seen.add(p);
      paths.push(p);
    }
  }

  const strippedHead = head.replace(/\s+$/, '');
  const strippedRest = rest.replace(/^\s+/, '');
  const stripped = strippedRest.length > 0 ? `${strippedHead} ${strippedRest}` : strippedHead;
  return { paths, stripped };
}
