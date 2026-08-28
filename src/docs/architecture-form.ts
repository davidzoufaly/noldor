// @fd: consumer-architecture-doc-surface
/**
 * Pure form rules over one architecture page body.
 *
 * Nothing here reads the filesystem or knows the advisory shape — it answers
 * only "what does this body violate", so `docs-architecture.ts` owns the IO
 * boundary and the reporting shape exactly as it does for the blocking rules.
 */
import { listHeadings } from '../utils/markdown-sections.js';
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
