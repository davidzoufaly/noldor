// @fd: graphify-plan-of-edges-nodes-for-plans-specs
// Advisory-with-teeth: report design artifacts whose Structural context unit is
// still a stub. Never blocking — see `detectStructuralContextStubs`.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { ADR_FILENAME_RE } from '../../docs/adr-schema.js';
import { ARCHIVE_DIR, specDateFromFilename } from '../../core/design-artifact-names.js';
import { loadDocRoots } from '../../core/doc-roots.js';
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
    const verdict = classify(body, 3, null);
    if (verdict === null) continue;
    out.push({
      file: `${relDir(specsDir)}/${name}`,
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
    const verdict = classify(body, 2, ADR_STRUCTURAL_CONTEXT_PLACEHOLDER);
    if (verdict === null) continue;
    out.push({
      file: `${relDir(adrDir)}/${name}`,
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
): StructuralContextRule | null {
  const scannable = stripFences(body);
  const section = sectionAt(scannable, depth);
  if (section === null) return 'missing-section';

  // Suppression must come from THIS section, not from anywhere in the artifact:
  // a marker under an unrelated heading says nothing about this unit. A bare
  // marker is still a stub — the reason is what makes a skip a decision.
  const marker = section.split('\n').find((line) => line.trimStart().startsWith(CUT_MARKER));
  if (marker !== undefined) {
    const reason = marker.trimStart().slice(CUT_MARKER.length);
    return density(reason) >= MIN_STRUCTURAL_CONTEXT_CHARS ? null : 'stub-section';
  }

  if (placeholder !== null && section.trim() === placeholder) return 'placeholder-only';

  // The floor measures the UNSTRIPPED body: a unit whose evidence is a fenced
  // digest excerpt has done the work, and zeroing those characters would call
  // it a stub. Fences are stripped for scanning only.
  const unstripped = sectionAt(body, depth);
  return density(unstripped ?? section) >= MIN_STRUCTURAL_CONTEXT_CHARS ? null : 'stub-section';
}

/**
 * Remove fenced regions so a heading or marker inside a code fence cannot
 * classify an artifact — this spec's own fenced examples would otherwise.
 */
function stripFences(body: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out.join('\n');
}

/**
 * The unit's body: everything after its heading up to the next heading of the
 * same or shallower depth. A duplicate heading takes the first occurrence.
 */
function sectionAt(body: string, depth: number): string | null {
  const lines = body.split('\n');
  const open = `${'#'.repeat(depth)} ${STRUCTURAL_CONTEXT_HEADING}`;
  const start = lines.findIndex((line) => line.trim() === open);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => {
    const m = /^(#{1,6})\s/.exec(line);
    return m !== null && m[1].length <= depth;
  });
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/** Non-whitespace character count — the same measure the summary contract uses. */
function density(text: string): number {
  return text.replaceAll(/\s/gu, '').length;
}

/** `docs/design/specs` from an absolute path, for a stable repo-relative id. */
function relDir(dir: string): string {
  const posix = dir.replaceAll('\\', '/');
  const at = posix.lastIndexOf('/docs/');
  return at === -1 ? posix : posix.slice(at + 1);
}

async function listMd(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries.filter((e) => e.endsWith('.md') && e !== ARCHIVE_DIR).toSorted();
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
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
