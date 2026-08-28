// @fd: consumer-architecture-doc-surface
/**
 * Pure form rules over one architecture page body.
 *
 * Nothing here reads the filesystem or knows the advisory shape — it answers
 * only "what does this body violate", so `docs-architecture.ts` owns the IO
 * boundary and the reporting shape exactly as it does for the blocking rules.
 */
import { listHeadings } from '../utils/markdown-sections.js';

/** The registry facts this module needs. Structural, so a test fixture need not build a whole page. */
export interface FormPage {
  readonly id: string;
  readonly sections: readonly string[];
}

/** What one page body violates. Nothing here is an advisory yet. */
export interface PageForm {
  /** Registry sections the page does not carry as an H2, in registry order. */
  readonly missing: readonly string[];
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
 * natural shape is one section per flow, and one is a legitimate answer.
 *
 * @param page - Registry id and section set
 * @param body - Raw markdown
 */
export function assessPageForm(page: FormPage, body: string): PageForm {
  if (page.sections.length === 0) {
    return { missing: [], flowHeadings: h2s(body).length };
  }
  const present = new Set(h2s(body).map(norm));
  return { missing: page.sections.filter((s) => !present.has(norm(s))), flowHeadings: null };
}
