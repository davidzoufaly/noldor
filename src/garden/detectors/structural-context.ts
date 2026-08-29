// @fd: graphify-plan-of-edges-nodes-for-plans-specs
// Advisory-with-teeth: report design artifacts whose Structural context unit is
// still a stub. Never blocking — see `detectStructuralContextStubs`.

import { join } from 'node:path';

import { ADR_FILENAME_RE } from '../../docs/adr-schema.js';
import { specDateFromFilename } from '../../core/design-artifact-names.js';
import { loadDocRoots } from '../../core/doc-roots.js';
import {
  blankComments,
  cutReasons,
  density,
  docsRelativeDir,
  listMd,
  locateSection,
  readText,
} from '../../core/markdown-section-scan.js';
import {
  ADR_STRUCTURAL_CONTEXT_PLACEHOLDER,
  CUT_MARKER,
  MIN_STRUCTURAL_CONTEXT_CHARS,
  STRUCTURAL_CONTEXT_HEADING,
} from '../../core/structural-context-contract.js';

import type { Gap } from '../../core/fd-load.js';

/**
 * Specs authored on or after this date are in scope. Stamped when the contract
 * shipped — this spec's own date, so it is the first artifact answerable for the
 * unit.
 *
 * A literal rather than config: a consumer-tunable floor is a knob nobody would
 * turn, and the value is meaningful only relative to the framework version that
 * introduced the requirement. Twelve live specs predate it and could not have
 * complied; flagging them would produce rows clearable only by retro-authoring,
 * which teaches operators to ignore the channel.
 */
export const SPEC_FLOOR_DATE = '2026-08-28';

/**
 * Records numbered strictly above this are in scope — the highest that existed
 * when the contract shipped.
 *
 * Stamped, emphatically NOT recomputed at detect time: "highest existing"
 * evaluated during a run always equals the newest record, so every record would
 * be exempt and the ADR half of this detector could never fire.
 */
export const ADR_FLOOR_NUMBER = '0001';

/** Why one artifact was reported. */
export type StructuralContextRule = 'missing-section' | 'stub-section' | 'placeholder-only';

/** One artifact whose unit is unfilled. */
export interface StructuralContextStub {
  /** Repo-relative path of the artifact. */
  readonly file: string;
  /**
   * Named `artifactKind`, never `kind`: the garden harvester builds a finding as
   * `{ kind: category, ...entry }` — the spread lands SECOND, so a `kind` field
   * here would overwrite the category tag and the finding would report itself as
   * a `spec` rather than as a `structuralContextStubs` row.
   */
  readonly artifactKind: 'spec' | 'adr';
  readonly rule: StructuralContextRule;
  readonly message: string;
}

/**
 * Report design artifacts whose Structural context unit is missing or unfilled.
 *
 * **Never blocking.** The caller surfaces these on their own `GardenFindings`
 * key, deliberately absent from `FINDING_CATEGORIES` in
 * `garden-detect-runner.ts`: that list gates the garden auto-restamp, and an
 * unstamped receipt is a blocking release row, so anything routed through it
 * blocks a release. The architecture detector's advisory half works the same
 * way and for the same reason.
 *
 * Reads only the artifacts — never `graphify-out/` — so behaviour is identical
 * in a repo with no graph. Reporting a stub there is correct: the unit's honest
 * content in that repo is a `noldor:cut` saying no graph is tracked.
 *
 * @param repo - Repository root
 */
export async function detectStructuralContextStubs(repo: string): Promise<StructuralContextStub[]> {
  const roots = loadDocRoots(repo);
  return [...(await scanSpecs(roots.specs)), ...(await scanAdrs(roots.adr))];
}

/** Project findings into the report's gap shape. */
export function toGaps(stubs: readonly StructuralContextStub[]): Gap[] {
  return stubs.map((s) => ({
    category: 'structural-context',
    itemId: `${s.file}#${s.rule}`,
    message: s.message,
  }));
}

/** Live specs only, at or after the floor. Archived specs are never in scope. */
async function scanSpecs(specsDir: string): Promise<StructuralContextStub[]> {
  const out: StructuralContextStub[] = [];
  for (const name of await listMd(specsDir)) {
    const date = specDateFromFilename(name);
    // Fail-open on a filename that is not a spec name: skipping is right for a
    // stray file, and the alternative would report an artifact this detector
    // cannot even date.
    if (date === null || date < SPEC_FLOOR_DATE) continue;
    const body = await readText(join(specsDir, name));
    if (body === null) continue;
    const verdict = classify(body, 3, null, '## Design');
    if (verdict === null) continue;
    out.push({
      file: `${docsRelativeDir(specsDir)}/${name}`,
      artifactKind: 'spec',
      rule: verdict,
      message: specMessage(verdict, name),
    });
  }
  return out;
}

/** Records above the floor only. */
async function scanAdrs(adrDir: string): Promise<StructuralContextStub[]> {
  const out: StructuralContextStub[] = [];
  for (const name of await listMd(adrDir)) {
    const match = ADR_FILENAME_RE.exec(name);
    if (match === null || match[1] <= ADR_FLOOR_NUMBER) continue;
    const body = await readText(join(adrDir, name));
    if (body === null) continue;
    const verdict = classify(body, 2, ADR_STRUCTURAL_CONTEXT_PLACEHOLDER, null);
    if (verdict === null) continue;
    out.push({
      file: `${docsRelativeDir(adrDir)}/${name}`,
      artifactKind: 'adr',
      rule: verdict,
      message: adrMessage(verdict, name),
    });
  }
  return out;
}

/**
 * Is this artifact's unit unfilled, and why? `null` means it is filled.
 *
 * @param depth - Heading depth the unit lives at: 3 in a spec, 2 in a record
 * @param placeholder - The template sentence, when the artifact kind has one
 */
function classify(
  body: string,
  depth: number,
  placeholder: string | null,
  requireAncestor: string | null,
): StructuralContextRule | null {
  // Comments are blanked before the scan, not after it: hidden text must not be
  // able to open a fence, introduce a heading, declare a cut, or count as prose.
  // Line structure is preserved, so boundaries are identical to the raw body.
  const located = locateSection(
    blankComments(body),
    depth,
    STRUCTURAL_CONTEXT_HEADING,
    requireAncestor,
  );
  if (located === null) return 'missing-section';
  const { scanned: section, raw } = located;

  // A bare marker is still a stub — the reason is what makes a skip a decision —
  // but a bare one must not mask a well-formed marker further down.
  const reasons = cutReasons(section);
  if (reasons.length > 0) {
    return reasons.some((r) => density(r) >= MIN_STRUCTURAL_CONTEXT_CHARS) ? null : 'stub-section';
  }

  if (placeholder !== null && section.trim() === placeholder) return 'placeholder-only';

  // The floor measures the RAW body — a unit whose evidence is a fenced digest
  // excerpt has done the work. `raw` comes from the same boundaries the stripped
  // scan found, never from a second independent scan: re-scanning unstripped
  // text let a `#`-prefixed line inside a bash fence terminate the section
  // early, reporting a stub for exactly the case this measure exists to serve.
  return density(raw) >= MIN_STRUCTURAL_CONTEXT_CHARS ? null : 'stub-section';
}

function specMessage(rule: StructuralContextRule, name: string): string {
  const fix = `run \`pnpm noldor design graph-context --path <file>...\` and write \`### ${STRUCTURAL_CONTEXT_HEADING}\` from the digest, or record a deliberate skip with a \`${CUT_MARKER} <reason>\` line inside it`;
  return rule === 'missing-section'
    ? `${name} has no \`### ${STRUCTURAL_CONTEXT_HEADING}\` unit inside \`## Design\` — ${fix}`
    : `${name}'s \`### ${STRUCTURAL_CONTEXT_HEADING}\` unit is empty or too thin to be evidence — ${fix}`;
}

function adrMessage(rule: StructuralContextRule, name: string): string {
  const fix = `run \`pnpm noldor design graph-context --path <file>...\` and answer it, or record a deliberate skip with a \`${CUT_MARKER} <reason>\` line inside the section`;
  if (rule === 'missing-section') {
    return `${name} has no \`## ${STRUCTURAL_CONTEXT_HEADING}\` section — ${fix}`;
  }
  return rule === 'placeholder-only'
    ? `${name}'s \`## ${STRUCTURAL_CONTEXT_HEADING}\` still carries only the template question — ${fix}`
    : `${name}'s \`## ${STRUCTURAL_CONTEXT_HEADING}\` is empty or too thin to be evidence — ${fix}`;
}
