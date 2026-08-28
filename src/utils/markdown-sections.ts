// @tests: de-superpowers-vendor-spec-plan-and-worktree-flows
// Fence-aware H2/H3 scanning over raw markdown. Lives in `utils` rather than
// beside its first caller (`src/design/`) because generic markdown parsing is
// not a design-dialogue concern, and because this is the repo's one *capable*
// fence scanner — the nine incumbents (`stripCodeRegions`, `parse-blocks`,
// `write-blocks`, `scaffold`, `backlog-demote`, `skill-code-drift`,
// `validate-triage`, `lint-plan-snippets`, `entry-id`) each recognize a literal
// triple backtick and nothing else. Nothing migrates here yet; the placement is
// what makes migration a later mechanical change instead of a move.

/** A heading this module can address. H1 and H4+ are not addressable. */
export interface Heading {
  name: string;
  depth: 2 | 3;
}

/**
 * Heading line, outside any fence: up to three spaces, two or three hashes, at
 * least one space, the name, optional closing hashes.
 *
 * Four spaces is an indented code block, and `##NoSpace` is not a heading at all
 * — both are CommonMark rules the incumbent scanners' `startsWith('## ')` checks
 * get right by accident and their `startsWith('```')` fence checks get wrong.
 */
const HEADING_RE = /^ {0,3}(#{2,3}) +(.+?)(?: +#+)? *$/;

/** Fence open/close candidate: up to three spaces, then a run of one marker char. */
const FENCE_RE = /^ {0,3}((`{3,})|(~{3,}))(.*)$/;

export interface FenceState {
  marker: '`' | '~';
  length: number;
}

/**
 * Classify one line against the current fence state.
 *
 * Exported so a caller that must interleave fence tracking with another
 * line-spanning construct (HTML comments, say) can drive the same CommonMark
 * rules one line at a time, rather than becoming a tenth incumbent scanner that
 * recognizes a literal triple backtick and nothing else.
 *
 * @returns The new fence state (`null` = outside a fence), and whether the line
 *   is *content* — i.e. can still be read as a heading.
 */
export function stepFence(line: string, open: FenceState | null): { open: FenceState | null } {
  const m = line.match(FENCE_RE);
  if (!m) return { open };
  const run = m[2] ?? m[3]!;
  const marker = run[0] as '`' | '~';
  const info = m[4]!;

  if (open === null) {
    // A backtick opening's info string may not contain a backtick: ``` a`b ``` is
    // inline code, not a fence. Tilde info strings carry no such restriction.
    if (marker === '`' && info.includes('`')) return { open: null };
    return { open: { marker, length: run.length } };
  }

  // Closing requires the same marker, a run at least as long as the opening, and
  // nothing but whitespace after it. Anything else is fence *content*.
  if (marker === open.marker && run.length >= open.length && info.trim() === '') {
    return { open: null };
  }
  return { open };
}

/** Split on any line terminator, so a CRLF document behaves like an LF one. */
function lines(md: string): string[] {
  return md.split(/\r\n|\r|\n/);
}

/**
 * Every addressable heading, in document order, with repeats preserved so a
 * caller can detect a duplicated name (the renderer warns on one; `extractSection`
 * resolves it to the first occurrence).
 */
export function listHeadings(md: string): Heading[] {
  const out: Heading[] = [];
  let open: FenceState | null = null;
  for (const line of lines(md)) {
    const before = open;
    ({ open } = stepFence(line, open));
    // A fence delimiter is never a heading, and neither is anything inside one.
    if (before !== null || open !== null) continue;
    const h = line.match(HEADING_RE);
    if (h) out.push({ name: h[2]!.trim(), depth: h[1]!.length as 2 | 3 });
  }
  return out;
}

/**
 * Body of the first heading named `name`.
 *
 * The body runs to the next heading of equal or shallower depth, so an H2's body
 * includes its descendant H3s — which is deliberate: a confirmation digest taken
 * over `## Design` must go stale when a unit beneath it changes.
 *
 * Outer blank lines are trimmed and interior ones preserved, because this string
 * is what reaches the operator as prose.
 *
 * @returns The body (possibly empty), or `null` when no such heading exists.
 */
export function extractSection(md: string, name: string): string | null {
  const src = lines(md);
  let open: FenceState | null = null;
  let start = -1;
  let depth = 0;

  for (let i = 0; i < src.length; i += 1) {
    const before = open;
    ({ open } = stepFence(src[i]!, open));
    if (before !== null || open !== null) continue;
    const h = src[i]!.match(HEADING_RE);
    if (!h) continue;
    const d = h[1]!.length;
    if (start === -1) {
      if (h[2]!.trim() === name) {
        start = i + 1;
        depth = d;
      }
      continue;
    }
    if (d <= depth) return trimOuterBlanks(src.slice(start, i)).join('\n');
  }

  if (start === -1) return null;
  return trimOuterBlanks(src.slice(start)).join('\n');
}

function trimOuterBlanks(body: string[]): string[] {
  let lo = 0;
  let hi = body.length;
  while (lo < hi && body[lo]!.trim() === '') lo += 1;
  while (hi > lo && body[hi - 1]!.trim() === '') hi -= 1;
  return body.slice(lo, hi);
}
