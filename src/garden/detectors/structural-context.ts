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

/**
 * The skip marker as its own token, escaped and built once.
 *
 * `RegExp.escape` because the pattern interpolates a value rather than a
 * literal — `platform-over-dependency` binds that. `noldor:cut` carries no
 * metacharacter today, which is exactly why the guard belongs here: a later edit
 * to the constant would otherwise turn this into a silent matcher bug.
 */
const CUT_MARKER_RE = new RegExp(`^${RegExp.escape(CUT_MARKER)}(\\s|$)`);

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
    const verdict = classify(body, 2, ADR_STRUCTURAL_CONTEXT_PLACEHOLDER, null);
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
  requireAncestor: string | null,
): StructuralContextRule | null {
  const located = locateSection(body, depth, requireAncestor);
  if (located === null) return 'missing-section';
  const { scanned: section, raw } = located;

  // Suppression must come from THIS section, not from anywhere in the artifact:
  // a marker under an unrelated heading says nothing about this unit. A bare
  // marker is still a stub — the reason is what makes a skip a decision.
  // The marker must be its own token: a bare `startsWith` let `noldor:cutlery`
  // suppress the unit, with `lery ...` counting as the reason.
  const marker = section.split('\n').find((line) => CUT_MARKER_RE.test(line.trim()));
  if (marker !== undefined) {
    const reason = marker.trim().replace(CUT_MARKER_RE, '');
    return density(reason) >= MIN_STRUCTURAL_CONTEXT_CHARS ? null : 'stub-section';
  }

  if (placeholder !== null && section.trim() === placeholder) return 'placeholder-only';

  // The floor measures the RAW body — a unit whose evidence is a fenced digest
  // excerpt has done the work. `raw` comes from the same boundaries the stripped
  // scan found, never from a second independent scan: re-scanning unstripped
  // text let a `#`-prefixed line inside a bash fence terminate the section
  // early, reporting a stub for exactly the case this measure exists to serve.
  return density(raw) >= MIN_STRUCTURAL_CONTEXT_CHARS ? null : 'stub-section';
}

/** One line of the artifact, tagged with whether it sits inside a code fence. */
interface TaggedLine {
  text: string;
  fenced: boolean;
}

/**
 * Tag every line with its fence state in one pass.
 *
 * Fence state has to be computed once and carried, not recomputed by stripping:
 * two independent scans of the same document disagree about where a section
 * starts and ends the moment a fence contains something heading-shaped.
 */
function tagLines(body: string): TaggedLine[] {
  const out: TaggedLine[] = [];
  // CommonMark: a fence closes only on the SAME character, at least as long as
  // the opener. Toggling on any ``` or ~~~ meant a three-backtick line inside a
  // four-backtick fence — or a tilde line inside a backtick fence — closed it
  // early, letting fenced heading-shaped content open or truncate a section.
  let open: { char: string; len: number } | null = null;
  for (const text of body.split('\n')) {
    // A closing fence may carry ONLY the delimiter plus trailing whitespace
    // (CommonMark); an info string like ```js can open a fence but never close
    // one. Accepting any same-character run let ```js inside an open fence close
    // it and expose heading-shaped content to the section scanner.
    const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(text);
    if (m !== null) {
      const char = m[1][0]!;
      const len = m[1].length;
      const bare = m[2].trim().length === 0;
      if (open === null) {
        // An opener may carry an info string, but backticks forbid a backtick
        // in it.
        if (char !== '`' || !m[2].includes('`')) open = { char, len };
      } else if (bare && char === open.char && len >= open.len) {
        open = null;
      }
      // Delimiter lines belong to no section body either way.
      out.push({ text, fenced: true });
      continue;
    }
    out.push({ text, fenced: open !== null });
  }
  return out;
}

/** A located unit: the text structure is read from, and the text measured. */
interface LocatedSection {
  /** Fenced lines removed — what headings and markers are matched against. */
  scanned: string;
  /** Every line between the boundaries, fences included — what the floor measures. */
  raw: string;
}

/**
 * Find the unit and return both views of it.
 *
 * Only unfenced lines can open or close a section, so a heading inside a fence
 * neither introduces a unit nor truncates one. `requireAncestor` additionally
 * demands that the nearest preceding shallower heading be that text, so a spec's
 * `### Structural context` counts only inside `## Design`.
 */
function locateSection(
  body: string,
  depth: number,
  requireAncestor: string | null,
): LocatedSection | null {
  const lines = tagLines(body);
  const open = `${'#'.repeat(depth)} ${STRUCTURAL_CONTEXT_HEADING}`;
  const start = lines.findIndex(
    (l, i) => !l.fenced && l.text.trim() === open && ancestorOk(lines, i, depth, requireAncestor),
  );
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const l = lines[i]!;
    if (l.fenced) continue;
    const m = /^(#{1,6})\s/.exec(l.text);
    if (m !== null && m[1].length <= depth) {
      end = i;
      break;
    }
  }
  const window = lines.slice(start + 1, end);
  return {
    scanned: window
      .filter((l) => !l.fenced)
      .map((l) => l.text)
      .join('\n'),
    raw: window.map((l) => l.text).join('\n'),
  };
}

/** Is the nearest preceding shallower heading the one this unit must live under? */
function ancestorOk(
  lines: readonly TaggedLine[],
  at: number,
  depth: number,
  requireAncestor: string | null,
): boolean {
  if (requireAncestor === null) return true;
  for (let i = at - 1; i >= 0; i -= 1) {
    const l = lines[i]!;
    if (l.fenced) continue;
    const m = /^(#{1,6})\s/.exec(l.text);
    if (m === null || m[1].length >= depth) continue;
    return l.text.trim() === requireAncestor;
  }
  return false;
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
