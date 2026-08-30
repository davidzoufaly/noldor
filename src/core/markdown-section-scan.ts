// @fd: consumer-architecture-doc-surface
/**
 * Fence- and comment-aware markdown section location, shared by every detector
 * that asks "is the section under heading X actually filled".
 *
 * Lifted out of `src/garden/detectors/structural-context.ts` when the FD
 * `## Diagram` detector needed the same scan: these functions encode CommonMark
 * fixes found the hard way — a fence closes only on the same character at least
 * as long as its opener, an info string can open a fence but never close one,
 * and only unfenced lines may open or close a section. A second copy would fork
 * those fixes, and `clones check` would flag it regardless.
 *
 * Comment handling lives in the SAME single pass as fence tagging, and that is
 * the module's hardest-won lesson: blanking comments in one scan and tagging
 * fences in another let the two disagree. A comment closes at the first `-->`
 * exactly as HTML does — and a mermaid flowchart edge IS `-->` — so blanking a
 * commented-out fence destroyed its opening delimiter while its closing ```
 * survived, a second scan read that stray as an opener, and every heading to
 * EOF vanished. One pass, one grammar, three rules:
 *
 * - The fence machine reads every line's RAW text. It is deliberately blind to
 *   comments, so an author's balanced fences stay balanced however they are
 *   commented, and no stray delimiter can ever be minted.
 * - A comment OPENS only on an unfenced line — a `<!--` inside a fence is
 *   example text, and treating it as live let an unterminated one in a quoted
 *   scaffold blank the rest of the document. A comment CLOSES at the first
 *   `-->` on any later line, fenced or not, matching how HTML reads it; what
 *   leaks past a mid-fence close is junk text, never a delimiter.
 * - Visibility: comment spans are blanked to spaces, newlines kept, so line
 *   numbers and section boundaries always index the original text. Hidden
 *   content can neither open a section, terminate one, declare a cut, count as
 *   prose, nor satisfy a fence check — while an unterminated `<!--` outside a
 *   fence still blanks the remainder, the safe direction: the section measures
 *   as empty and reports a stub rather than being cleared by content nothing
 *   renders.
 *
 * Lives in core because both `src/garden` detectors need it and core is the only
 * module every domain may import (`core-is-foundation` boundary rule). Nothing
 * here reads a heading name or a threshold: callers own their own contract.
 */

import { ARCHIVE_DIR } from './design-artifact-names.js';
import { listDirIfExists } from './fd-load.js';
import { CUT_MARKER } from './structural-context-contract.js';

/**
 * The skip marker as its own token, escaped and built once.
 *
 * `RegExp.escape` because the pattern interpolates a value rather than a
 * literal — `platform-over-dependency` binds that. `noldor:cut` carries no
 * metacharacter today, which is exactly why the guard belongs here: a later edit
 * to the constant would otherwise turn this into a silent matcher bug.
 */
const CUT_MARKER_RE = new RegExp(`^${RegExp.escape(CUT_MARKER)}(\\s|$)`);

/** One line of a document, tagged with its fence state and its visible text. */
export interface TaggedLine {
  /** The original line, untouched. */
  text: string;
  /** Inside a code fence, or a fence delimiter line itself. */
  fenced: boolean;
  /** The line with comment spans blanked to spaces — what a reader sees. */
  visible: string;
}

/**
 * Tag every line with its fence state and visible text in one pass.
 *
 * Fence state has to be computed once and carried, not recomputed by stripping:
 * two independent scans of the same document disagree about where a section
 * starts and ends the moment a fence contains something heading-shaped — or the
 * moment a comment contains a fence delimiter. The comment rules are the module
 * docstring's; the fence rules are CommonMark's.
 *
 * One repair on top: a fence opened by a delimiter the reader cannot see (it
 * sits inside a comment) is re-tagged as literal text and the pass re-run when
 * its region turns out to swallow visible structure — it never closes, or a
 * visible heading falls inside it. Without that, a lone `\`\`\`` hidden in a
 * comment fences every heading to EOF or, paired with a later visible
 * delimiter, everything up to it — the heading-swallowing failure this module
 * exists to close. A commented-out fence whose region holds only its own body
 * stays hidden, and a fence the author can SEE runs unclosed to EOF exactly as
 * CommonMark reads it, so the repair can never rewrite visible structure. Each
 * round demotes one delimiter line, so it terminates.
 */
export function tagLines(body: string): TaggedLine[] {
  const lines = body.split('\n');
  const demoted = new Set<number>();
  for (;;) {
    const { out, healAt } = tagPass(lines, demoted);
    if (healAt === null) return out;
    demoted.add(healAt);
  }
}

/**
 * One tagging pass; `healAt` names a comment-hidden opener whose fence swallows
 * visible structure — a visible heading inside its region, or open at EOF. When
 * `healAt` is non-null the returned lines may be partial; the caller re-runs.
 */
function tagPass(
  lines: readonly string[],
  demoted: ReadonlySet<number>,
): { out: TaggedLine[]; healAt: number | null } {
  const out: TaggedLine[] = [];
  // CommonMark: a fence closes only on the SAME character, at least as long as
  // the opener. Toggling on any ``` or ~~~ meant a three-backtick line inside a
  // four-backtick fence — or a tilde line inside a backtick fence — closed it
  // early, letting fenced heading-shaped content open or truncate a section.
  let open: { char: string; len: number; at: number; hidden: boolean } | null = null;
  let inComment = false;

  for (const [i, text] of lines.entries()) {
    // The fence machine reads the RAW line, comment state notwithstanding: an
    // author's balanced delimiters must stay balanced however commented.
    let fenced: boolean;
    // A closing fence may carry ONLY the delimiter plus trailing whitespace
    // (CommonMark); an info string like ```js can open a fence but never close
    // one. Accepting any same-character run let ```js inside an open fence close
    // it and expose heading-shaped content to the section scanner. At most
    // three spaces may precede a delimiter — the same CommonMark rule
    // {@link atxHeading} enforces — or a fence SHOWN as an indented code sample
    // mints a phantom fence.
    const m = demoted.has(i) ? null : /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
    if (m !== null) {
      const char = m[1][0]!;
      const len = m[1].length;
      const bare = m[2].trim().length === 0;
      if (open === null) {
        // An opener may carry an info string, but backticks forbid a backtick
        // in it.
        if (char !== '`' || !m[2].includes('`')) open = { char, len, at: i, hidden: inComment };
      } else if (bare && char === open.char && len >= open.len) {
        open = null;
      }
      // Delimiter lines belong to no section body either way.
      fenced = true;
    } else {
      fenced = open !== null;
    }

    // Comment visibility. An open comment ends at the first `-->` on ANY line;
    // a new one begins only on an unfenced span.
    let visible: string;
    if (inComment) {
      const close = text.indexOf('-->');
      if (close === -1) {
        visible = blank(text);
      } else {
        const end = close + '-->'.length;
        inComment = false;
        const rest = text.slice(end);
        visible = blank(text.slice(0, end)) + (fenced ? rest : blankSpans(rest));
      }
    } else if (fenced) {
      visible = text;
    } else {
      visible = blankSpans(text);
    }

    out.push({ text, fenced, visible });

    // A visible heading inside a hidden-opener region is proof the phantom is
    // swallowing structure the reader can see — demote the opener now. A line
    // still inside a comment has a blank `visible`, so a heading-shaped line
    // that is itself hidden (a `# comment` in a commented-out bash fence) can
    // never trigger this.
    if (open !== null && open.hidden && fenced && atxHeading(visible) !== null) {
      return { out, healAt: open.at };
    }
  }
  return { out, healAt: open !== null && open.hidden ? open.at : null };

  /** Blank every comment span in an unfenced line, tracking an unclosed opener. */
  function blankSpans(rest: string): string {
    let openAt = rest.indexOf('<!--');
    if (openAt === -1) return rest;
    let acc = rest.slice(0, openAt);
    let tail = rest.slice(openAt);
    for (;;) {
      const close = tail.indexOf('-->');
      if (close === -1) {
        inComment = true;
        return acc + blank(tail);
      }
      const end = close + '-->'.length;
      acc += blank(tail.slice(0, end));
      tail = tail.slice(end);
      openAt = tail.indexOf('<!--');
      if (openAt === -1) return acc + tail;
      acc += tail.slice(0, openAt);
      tail = tail.slice(openAt);
    }
  }
}

function blank(run: string): string {
  return ' '.repeat(run.length);
}

/**
 * Parse a line as an ATX heading, or `null` when it is not one.
 *
 * The ONE heading predicate every site uses — opener, terminator and ancestor
 * walk. They used to disagree: the opener trimmed (accepting any indent) while
 * the other two ran an anchored regex (accepting none), so a one-space-indented
 * heading failed to close the preceding section and its prose was measured as
 * the wrong section's. CommonMark allows up to three spaces of indent; four is
 * indented code.
 */
function atxHeading(visible: string): { depth: number; trimmed: string } | null {
  const m = /^ {0,3}(#{1,6})\s/.exec(visible);
  return m === null ? null : { depth: m[1].length, trimmed: visible.trim() };
}

/** A located section: the text structure is read from, and the text measured. */
export interface LocatedSection {
  /** Fenced lines removed, comments blanked — what headings and markers are matched against. */
  scanned: string;
  /** Every line between the boundaries, fences included, comments blanked — what a floor measures. */
  raw: string;
  /** First body line of the section, 0-based, in the line array of the text passed in. */
  startLine: number;
  /** One past the last body line, so `lines.slice(startLine, endLine)` is the window. */
  endLine: number;
}

/**
 * Find a section by heading text and depth, and return both views of it.
 *
 * Takes the RAW body: fence and comment handling live in {@link tagLines}'s
 * single pass, so callers never pre-blank. Only unfenced, uncommented lines can
 * open or close a section — a heading inside a fence is example text, and a
 * heading inside a comment must not enrol an artifact that predates a contract.
 * `requireAncestor` additionally demands that the nearest preceding shallower
 * heading be that text, so a spec's `### Structural context` counts only inside
 * `## Design`.
 *
 * When the heading appears more than once at the same depth, the FIRST is the
 * section: the second terminates it rather than opening a rival, so a filled
 * duplicate lower down can never mask a stub above it.
 *
 * Both views come back comment-blanked. `startLine`/`endLine` index the
 * original body, which is how a caller reads what a comment said (an FD's
 * scaffolded placeholder is itself a comment).
 *
 * @param depth - Heading depth the section lives at
 * @param heading - Heading text, without its `#` prefix, matched case-sensitively
 * @param requireAncestor - Full heading line the nearest shallower heading must be
 */
export function locateSection(
  body: string,
  depth: number,
  heading: string,
  requireAncestor: string | null,
): LocatedSection | null {
  const lines = tagLines(body);
  const open = `${'#'.repeat(depth)} ${heading}`;
  const start = lines.findIndex((l, i) => {
    if (l.fenced) return false;
    const h = atxHeading(l.visible);
    return h !== null && h.trimmed === open && ancestorOk(lines, i, depth, requireAncestor);
  });
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const l = lines[i]!;
    if (l.fenced) continue;
    const h = atxHeading(l.visible);
    if (h !== null && h.depth <= depth) {
      end = i;
      break;
    }
  }
  const window = lines.slice(start + 1, end);
  return {
    scanned: window
      .filter((l) => !l.fenced)
      .map((l) => l.visible)
      .join('\n'),
    raw: window.map((l) => l.visible).join('\n'),
    startLine: start + 1,
    endLine: end,
  };
}

/** Is the nearest preceding shallower heading the one this section must live under? */
export function ancestorOk(
  lines: readonly TaggedLine[],
  at: number,
  depth: number,
  requireAncestor: string | null,
): boolean {
  if (requireAncestor === null) return true;
  for (let i = at - 1; i >= 0; i -= 1) {
    const l = lines[i]!;
    if (l.fenced) continue;
    const h = atxHeading(l.visible);
    if (h === null || h.depth >= depth) continue;
    return h.trimmed === requireAncestor;
  }
  return false;
}

/** Non-whitespace character count — the measure every section-floor contract uses. */
export function density(text: string): number {
  return text.replaceAll(/\s/gu, '').length;
}

/**
 * Markdown filenames directly inside `dir`, sorted, excluding the archive
 * subdirectory. Non-recursive: every surface this serves keeps its live
 * artifacts one level deep.
 *
 * A missing directory is an empty list — a repo that has not adopted the
 * surface has nothing to report. Any OTHER IO failure propagates via
 * {@link listDirIfExists}: swallowing an EACCES made both detectors report a
 * clean pass over a tree they never read.
 */
export async function listMd(dir: string): Promise<string[]> {
  const entries = await listDirIfExists(dir);
  return entries.filter((e) => e.endsWith('.md') && e !== ARCHIVE_DIR).toSorted();
}

/**
 * The reason attached to every `noldor:cut` line in this section, in document
 * order. Empty when the section carries no marker at all.
 *
 * Returns them ALL rather than the first, because the caller owns the floor that
 * decides which are well formed: a bare marker followed by a real one must not
 * mask it, and only the caller knows how many characters "real" is. An empty
 * array and an array of empty strings mean different things — no decline at all,
 * versus declines with no reason — and callers must not collapse them.
 *
 * Suppression must come from THIS section, not from anywhere in the artifact: a
 * marker under an unrelated heading says nothing about this one. The marker must
 * also be its own token — a bare `startsWith` let `noldor:cutlery` suppress a
 * section, with `lery ...` counting as the reason. A marker inside a comment
 * never counts: {@link locateSection}'s views arrive comment-blanked.
 *
 * @param scanned - The section's fence-stripped, comment-blanked view
 */
export function cutReasons(scanned: string): string[] {
  return scanned
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => CUT_MARKER_RE.test(line))
    .map((line) => line.replace(CUT_MARKER_RE, ''));
}

/**
 * `docs/design/specs` from an absolute path, for a stable repo-relative id.
 * Falls back to the whole POSIX path when the input names no `docs/` segment.
 */
export function docsRelativeDir(dir: string): string {
  const posix = dir.replaceAll('\\', '/');
  const at = posix.lastIndexOf('/docs/');
  return at === -1 ? posix : posix.slice(at + 1);
}

/**
 * The visible prose of a section: its fence-stripped text minus the lines that
 * are markup rather than reading matter — a `noldor:cut` decline and any
 * sub-heading.
 *
 * Exists so a caller measuring a prose floor never has to hold the cut regex
 * itself; the marker's grammar stays private to this module, which is the only
 * place it is defined.
 *
 * @param scanned - A section's fence-stripped, comment-blanked view
 */
export function visibleProse(scanned: string): string {
  return scanned
    .split('\n')
    .filter((line) => !CUT_MARKER_RE.test(line.trim()) && atxHeading(line) === null)
    .join('\n');
}
