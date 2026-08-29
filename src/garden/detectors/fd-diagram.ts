// @fd: consumer-architecture-doc-surface
// Advisory-with-teeth: report feature MDs whose `## Diagram` section is still a
// stub. Never blocking — see `detectFdDiagramStubs`.

import { join } from 'node:path';

import { loadDocRoots } from '../../core/doc-roots.js';
import { FD_DIAGRAM_HEADING, MIN_FD_DIAGRAM_PROSE_CHARS } from '../../core/fd-diagram-contract.js';
import {
  blankComments,
  cutReasons,
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
  // Comments are blanked BEFORE the section is located, not after: a `## Diagram`
  // inside a multiline comment would otherwise enrol an FD that predates the
  // contract, and an unmatched fence inside one would mis-tag the visible lines
  // after it. Blanking preserves line structure, so the window below still
  // indexes the original body.
  const lines = body.split('\n');
  const located = locateSection(blankComments(body), 2, FD_DIAGRAM_HEADING, null);
  if (located === null) return null;

  // The one thing that must be read from the ORIGINAL text: the placeholder is
  // itself a comment, so the blanked view can never see it.
  const hasPlaceholder = lines
    .slice(located.startLine, located.endLine)
    .join('\n')
    .includes(PLACEHOLDER_MARKER);
  const visibleRaw = located.raw;
  const visibleScanned = located.scanned;

  // A bare marker is still a stub — the reason is what makes a skip a decision —
  // but a bare one must not mask a well-formed marker further down.
  if (cutReasons(visibleScanned).some((r) => density(r) >= MIN_FD_DIAGRAM_PROSE_CHARS)) return null;

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
