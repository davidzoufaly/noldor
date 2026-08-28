// @fd: consumer-architecture-doc-surface
/**
 * Pure form rules over one architecture page body.
 *
 * Nothing here reads the filesystem or knows the advisory shape — it answers
 * only "what does this body violate", so `docs-architecture.ts` owns the IO
 * boundary and the reporting shape exactly as it does for the blocking rules.
 */
import { fencedLineMask, listHeadings } from '../utils/markdown-sections.js';
import { countWords } from '../utils/word-count.js';
import { stripCodeRegions } from './docs-check.js';

/**
 * The marker that declines a registry section, deliberately NOT the bare
 * `noldor:cut`.
 *
 * `CUT_MARKER_TOKEN` in `src/cr/lanes/subagent-dispatch.ts` is
 * `noldor:cut <ceiling> — <upgrade path>`, pinned by a test against the rule
 * file, and its second field is an upgrade path rather than a reason. Sharing
 * the token would make an ordinary ladder cut written on an architecture page
 * parse as a section decline naming a non-section, and emit a bogus advisory —
 * the exact noise a written decline exists to remove.
 */
export const SECTION_CUT_TOKEN = 'noldor:cut-section';

/** One `noldor:cut-section` marker found on a page. */
export interface SectionCut {
  /** Name as written, minus any `## ` the author included. Compared case-insensitively. */
  readonly name: string;
  /** Everything after the first em dash, trimmed. Empty when malformed. */
  readonly reason: string;
  /**
   * A marker suppresses its section only when well-formed: it carries the em
   * dash and a reason of at least one non-whitespace character. The reason is
   * the entire point of requiring the marker, so a decline that silences a row
   * without recording why is the pure advisory this design rejected.
   */
  readonly wellFormed: boolean;
}

/**
 * `<!-- noldor:cut-section <name> [— <reason>] -->`, non-greedy to the first `-->`.
 *
 * The token goes through `RegExp.escape` because it reaches the pattern as a
 * value rather than a literal — it is inert today, but a token gaining a `.` or
 * `+` later would silently turn this into a wildcard match.
 */
const CUT_RE = new RegExp(`<!--\\s*${RegExp.escape(SECTION_CUT_TOKEN)}\\s+([\\s\\S]*?)-->`, 'g');

/**
 * Every section-cut marker on the page, in document order.
 *
 * Markers inside fenced blocks and inline code spans are skipped: the templates'
 * example prose contains one, and reading it as a real decline would silently
 * suppress a section advisory — the failure the unknown-cut rule exists to
 * prevent.
 *
 * noldor:cut backtick fences only — `stripCodeRegions` recognizes a literal
 * triple backtick and nothing else, matching the ceiling `fenceKinds` already
 * declares on this surface. Route marker matching through a fully fence-aware
 * scan if a consumer's pages adopt tilde fences.
 *
 * @param body - Raw markdown
 */
export function parseSectionCuts(body: string): SectionCut[] {
  const out: SectionCut[] = [];
  for (const match of stripCodeRegions(body).matchAll(CUT_RE)) {
    const inner = match[1]!;
    const dash = inner.indexOf('—');
    const rawName = (dash === -1 ? inner : inner.slice(0, dash)).trim();
    const reason = dash === -1 ? '' : inner.slice(dash + 1).trim();
    out.push({
      name: rawName.replace(/^#+\s*/, ''),
      reason,
      wellFormed: dash !== -1 && reason.length > 0,
    });
  }
  return out;
}

/** The registry facts this module needs. Structural, so a test fixture need not build a whole page. */
export interface FormPage {
  readonly id: string;
  readonly sections: readonly string[];
}

/** A cut marker that names nothing in the page's registry set, or that carries no reason. */
export interface UnknownCut {
  readonly name: string;
  /** 0-based position among this page's unknown cuts — two identical markers are two rows. */
  readonly ordinal: number;
}

/** What one page body violates. Nothing here is an advisory yet. */
export interface PageForm {
  /** Registry sections neither present as an H2 nor validly declined, in registry order. */
  readonly missing: readonly string[];
  /** Cuts that name no registry section, or that carry no reason. */
  readonly unknownCuts: readonly UnknownCut[];
  /** H2 count, on an empty-`sections` page only. `null` elsewhere. */
  readonly flowHeadings: number | null;
}

const norm = (s: string): string => s.trim().toLowerCase();

/** Every H2 on the page, including repeats — two identically-named flows are two badly-named flows. */
function h2s(body: string): string[] {
  return listHeadings(body)
    .filter((h) => h.depth === 2)
    .map((h) => h.name);
}

/**
 * Assess one page body against its registry sections.
 *
 * Presence is heading-presence: the check asks whether the H2 exists, not
 * whether anything was written beneath it. No string test separates real prose
 * from plausible prose, so a check that guessed would be arguable exactly where
 * it matters — the claim is that the page's *questions* are on the page.
 *
 * Order is not checked and extra headings pass: order is what the templates
 * render, and making a consumer's editorial judgment a finding buys nothing.
 *
 * Heading scanning goes through `listHeadings`, the repo's one fully fence-aware
 * scanner, so a `## Boundary` inside a tilde fence or a long backtick run does
 * not count — and an H3 is not a section.
 *
 * An empty `sections` array is the `flows` sentinel: there is no set to check
 * names against, so the page is measured by heading *count* instead. That page's
 * natural shape is one section per flow, and one is a legitimate answer — and no
 * marker on it can be a typo, so it reports no unknown cuts.
 *
 * A section is satisfied by its H2 *or* by a well-formed decline. A malformed
 * decline, or one naming something outside the set, suppresses nothing and is
 * reported instead: a typo'd decline would otherwise silence nothing while
 * looking to its author like it did.
 *
 * @param page - Registry id and section set
 * @param body - Raw markdown
 */
export function assessPageForm(page: FormPage, body: string): PageForm {
  // The `flows` sentinel: no set to check names against, so a cut here cannot be
  // a typo, and firing would make every possible decline on the page a row.
  if (page.sections.length === 0) {
    return { missing: [], unknownCuts: [], flowHeadings: h2s(body).length };
  }

  const present = new Set(h2s(body).map(norm));
  const known = new Set(page.sections.map(norm));
  const declined = new Set<string>();
  const unknownCuts: UnknownCut[] = [];

  for (const cut of parseSectionCuts(body)) {
    if (cut.wellFormed && known.has(norm(cut.name))) {
      declined.add(norm(cut.name));
      continue;
    }
    unknownCuts.push({ name: cut.name, ordinal: unknownCuts.length });
  }

  const missing = page.sections.filter((s) => !present.has(norm(s)) && !declined.has(norm(s)));
  return { missing, unknownCuts, flowHeadings: null };
}

/**
 * Prose paragraphs of a page body: what a reader actually reads.
 *
 * Mermaid fences, code fences, table rows, headings and HTML comments are
 * blanked — a page may be long in diagram and table and still be terse in
 * prose, which is the form the contract exists to produce, and template prompts
 * and cut markers are comments a reader never sees.
 *
 * Blanking replaces each removed line with an empty one rather than deleting it,
 * so prose on either side of a diagram stays two paragraphs instead of merging
 * into one and reading as a single oversized block.
 *
 * Fence tracking comes from `fencedLineMask`, which applies CommonMark's
 * marker-and-length closing rule. A blind open/close toggle gets this wrong in
 * the *over*-reporting direction: a ``` line inside a ```` block would end the
 * fence early, and the code after it would count as prose and could fire a bogus
 * bloat advisory.
 *
 * @param body - Raw markdown
 * @returns Non-empty paragraphs, in document order
 */
export function proseParagraphs(body: string): string[] {
  const withoutComments = body.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  const lines = withoutComments.split(/\r\n|\r|\n/);
  const fenced = fencedLineMask(withoutComments);
  const kept = lines.map((line, i) => {
    const trimmed = line.trim();
    if (fenced[i] === true || trimmed.startsWith('|') || trimmed.startsWith('#')) return '';
    return line;
  });
  return kept
    .join('\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
}

/**
 * Longest prose paragraph a page may carry.
 *
 * The paragraph is the primary unit because it is what the surface's own
 * deletion test claims: a reader answers "how is this system shaped" without
 * reading a single full paragraph. A page total alone misjudges that in both
 * directions — a long page of labelled facts passes the test, and a short page
 * that is one block fails it.
 *
 * Measured rather than guessed: every prose paragraph across this repo's four
 * architecture pages runs 22-59 words, so 100 leaves roughly 1.7x headroom over
 * the worst honest paragraph.
 */
export const ARCH_PARAGRAPH_WORD_THRESHOLD = 100;

/**
 * Total prose a page may carry, as a backstop rather than a rival to the
 * paragraph rule.
 *
 * On its own the paragraph rule cannot see a page that has become an essay in
 * aggregate: an arbitrarily long page built of 99-word paragraphs never trips
 * it. 600 sits well above any honest page — this repo's four run 172/217/87/126
 * prose words — so it fires only on a page that has roughly tripled its worst
 * current sibling.
 */
export const ARCH_PAGE_PROSE_WORD_THRESHOLD = 600;

/** One prose paragraph over the per-paragraph budget. */
export interface LongParagraph {
  /** 0-based position among the page's prose paragraphs. */
  readonly index: number;
  readonly words: number;
}

/** What one page body exceeds. Both comparisons are strictly greater-than. */
export interface PageBloat {
  readonly longParagraphs: readonly LongParagraph[];
  /** Total prose words, only when over the page budget. `null` otherwise. */
  readonly pageWords: number | null;
}

/**
 * Measure a page body against both prose budgets.
 *
 * @param body - Raw markdown
 */
export function assessPageBloat(body: string): PageBloat {
  const counts = proseParagraphs(body).map(countWords);
  const longParagraphs = counts
    .map((w, index) => ({ index, words: w }))
    .filter((p) => p.words > ARCH_PARAGRAPH_WORD_THRESHOLD);
  const total = counts.reduce((sum, w) => sum + w, 0);
  return { longParagraphs, pageWords: total > ARCH_PAGE_PROSE_WORD_THRESHOLD ? total : null };
}
