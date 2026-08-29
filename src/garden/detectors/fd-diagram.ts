// @fd: consumer-architecture-doc-surface
// Advisory-with-teeth: report feature MDs whose `## Diagram` section is still a
// stub. Never blocking — see `detectFdDiagramStubs`.

import { join } from 'node:path';

import { loadDocRoots } from '../../core/doc-roots.js';
import { FD_DIAGRAM_HEADING, MIN_FD_DIAGRAM_PROSE_CHARS } from '../../core/fd-diagram-contract.js';
import {
  cutReason,
  density,
  docsRelativeDir,
  listMd,
  locateSection,
  readText,
  visibleProse,
} from '../../core/markdown-section-scan.js';
import { CUT_MARKER } from '../../core/structural-context-contract.js';
import { PLACEHOLDER_MARKER } from '../../docs/architecture-schema.js';
import { fenceKinds } from '../../docs/docs-architecture.js';

/**
 * HTML comments, non-greedy to the first `-->`. An unterminated `<!--` is
 * handled separately by {@link stripComments} — it swallows the remainder,
 * which is the safe direction: the section then measures as empty and reports a
 * stub rather than being cleared by text nothing renders.
 */
const COMMENT_RE = /<!--[\s\S]*?-->/g;

/** Why one FD was reported. */
export type FdDiagramRule = 'placeholder-only' | 'no-fence' | 'stub-section';

/** One FD whose diagram section is unfilled. */
export interface FdDiagramStub {
  /** Repo-relative POSIX path, e.g. `docs/features/plan-runner.md`. */
  readonly file: string;
  readonly rule: FdDiagramRule;
  readonly message: string;
}

/**
 * Report feature MDs whose `## Diagram` section is missing content.
 *
 * **Never blocking.** The caller surfaces these on their own `GardenFindings`
 * key, deliberately absent from `FINDING_CATEGORIES` in
 * `garden-detect-runner.ts`: that list gates the garden auto-restamp, and an
 * unstamped receipt is a blocking release row, so anything routed through it
 * blocks a release. Both sibling advisories work the same way.
 *
 * **Scope is presence-gated.** An FD with no `## Diagram` heading is not in
 * scope — no row, nothing. That single rule is what makes the requirement
 * non-retrospective: every FD that predates the contract carries no such
 * heading and is permanently silent, while every FD a scaffold writes from here
 * on arrives carrying the placeholder and is in scope from its first commit. No
 * floor constant, no date comparison, no git read. Frontmatter is not parsed
 * either: `noldor-tier` and `introduced` are both irrelevant, because the
 * heading's presence already encodes the decision the scaffold made.
 *
 * @param repo - Repository root
 */
export async function detectFdDiagramStubs(repo: string): Promise<FdDiagramStub[]> {
  const dir = loadDocRoots(repo).features;
  const out: FdDiagramStub[] = [];
  for (const name of await listMd(dir)) {
    // A file that cannot be read is skipped, not reported: a row naming a file
    // the detector could not open is one no author can clear. The accepted cost
    // is a false negative on an advisory channel — see the spec's Risks.
    const body = await readText(join(dir, name));
    if (body === null) continue;
    const rule = classify(body);
    if (rule === null) continue;
    out.push({ file: `${docsRelativeDir(dir)}/${name}`, rule, message: message(rule, name) });
  }
  return out;
}

/**
 * Is this FD's diagram section unfilled, and why? `null` means filled — or that
 * the FD is out of scope entirely, which is the same "no row" outcome.
 *
 * The decision table, in order, yielding at most one rule:
 *
 * | # | condition                                        | result             |
 * |---|--------------------------------------------------|--------------------|
 * | 1 | no `## Diagram` H2                                | not in scope       |
 * | 2 | a well-formed cut is present                      | filled             |
 * | 3 | `hasFence` and `density >= floor`                 | filled             |
 * | 4 | `hasFence` and `density < floor`                  | `stub-section`     |
 * | 5 | no fence, `density >= floor`                      | `no-fence`         |
 * | 6 | no fence, `density < floor`, placeholder present  | `placeholder-only` |
 * | 7 | no fence, `density < floor`, no placeholder       | `stub-section`     |
 *
 * Row 3 before rows 6 and 7 is what makes a leftover `<!-- TODO:` beside a real
 * diagram and real prose harmless: the placeholder is only ever *reported* when
 * nothing else is there.
 */
function classify(body: string): FdDiagramRule | null {
  const located = locateSection(body, 2, FD_DIAGRAM_HEADING, null);
  if (located === null) return null;

  // The comment strip runs FIRST and governs every test below, not just the
  // density floor: a `noldor:cut` line or a whole ```mermaid fence can sit
  // inside a multiline `<!-- ... -->`, render as nothing, and would otherwise
  // clear the section.
  const hasPlaceholder = located.raw.includes(PLACEHOLDER_MARKER);
  const visibleRaw = stripComments(located.raw);
  const visibleScanned = stripComments(located.scanned);

  // A bare marker is still a stub — the reason is what makes a skip a decision.
  const reason = cutReason(visibleScanned);
  if (reason !== null && density(reason) >= MIN_FD_DIAGRAM_PROSE_CHARS) return null;

  // `fenceKinds` reads the DECLARED kind of every mermaid fence, so several
  // fences satisfy this as one and a page may carry extra diagrams — the rule
  // `ArchitecturePage.allowedKinds` already states for the registry.
  const hasFence = fenceKinds(visibleRaw).length > 0;
  // `visibleProse` measures what a non-rendering reader actually sees. Its input
  // is `scanned` — fenced lines removed by the same single pass that found the
  // section boundaries — deliberately not `stripCodeRegions`, which also blanks
  // inline code spans and would report a false stub on ordinary FD prose full of
  // backticked identifiers.
  const prose = density(visibleProse(visibleScanned));

  if (hasFence) return prose >= MIN_FD_DIAGRAM_PROSE_CHARS ? null : 'stub-section';
  if (prose >= MIN_FD_DIAGRAM_PROSE_CHARS) return 'no-fence';
  return hasPlaceholder ? 'placeholder-only' : 'stub-section';
}

/**
 * Remove HTML comments, including an unterminated one and everything after it.
 *
 * Hidden text must never satisfy a requirement that exists to produce visible
 * prose, and it must never open a fence or declare a cut either — which is why
 * every caller strips before it measures anything.
 */
function stripComments(text: string): string {
  const stripped = text.replaceAll(COMMENT_RE, '');
  const dangling = stripped.indexOf('<!--');
  return dangling === -1 ? stripped : stripped.slice(0, dangling);
}

function message(rule: FdDiagramRule, name: string): string {
  const fix = `draw one mermaid fence at the C4 level that fits the feature and write a sentence or two beside it, or record a deliberate skip with a \`${CUT_MARKER} <reason>\` line inside the section`;
  switch (rule) {
    case 'placeholder-only': {
      return `${name}'s \`## ${FD_DIAGRAM_HEADING}\` still carries only the scaffolded placeholder — ${fix}`;
    }
    case 'no-fence': {
      return `${name}'s \`## ${FD_DIAGRAM_HEADING}\` has prose but no mermaid fence — ${fix}`;
    }
    default: {
      return `${name}'s \`## ${FD_DIAGRAM_HEADING}\` is empty or too thin to be evidence — ${fix}`;
    }
  }
}
