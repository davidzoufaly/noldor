// @fd: consumer-architecture-doc-surface
/**
 * Fence-aware markdown section location, shared by every detector that asks
 * "is the section under heading X actually filled".
 *
 * Lifted out of `src/garden/detectors/structural-context.ts` when the FD
 * `## Diagram` detector needed the same scan: these functions encode CommonMark
 * fixes found the hard way — a fence closes only on the same character at least
 * as long as its opener, an info string can open a fence but never close one,
 * and only unfenced lines may open or close a section. A second copy would fork
 * those fixes, and `clones check` would flag it regardless.
 *
 * Lives in core because both `src/garden` detectors need it and core is the only
 * module every domain may import (`core-is-foundation` boundary rule). Nothing
 * here reads a heading name or a threshold: callers own their own contract.
 */

import { readdir, readFile } from 'node:fs/promises';

import { ARCHIVE_DIR } from './design-artifact-names.js';
import { CUT_MARKER } from './structural-context-contract.js';

/**
 * The skip marker as its own token, escaped and built once.
 *
 * `RegExp.escape` because the pattern interpolates a value rather than a
 * literal — `platform-over-dependency` binds that. `noldor:cut` carries no
 * metacharacter today, which is exactly why the guard belongs here: a later edit
 * to the constant would otherwise turn this into a silent matcher bug.
 *
 * Exported because callers also filter it out of the text they measure — a
 * decline line is not prose.
 */
export const CUT_MARKER_RE = new RegExp(`^${RegExp.escape(CUT_MARKER)}(\\s|$)`);

/** One line of a document, tagged with whether it sits inside a code fence. */
export interface TaggedLine {
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
export function tagLines(body: string): TaggedLine[] {
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

/** A located section: the text structure is read from, and the text measured. */
export interface LocatedSection {
  /** Fenced lines removed — what headings and markers are matched against. */
  scanned: string;
  /** Every line between the boundaries, fences included — what a floor measures. */
  raw: string;
}

/**
 * Find a section by heading text and depth, and return both views of it.
 *
 * Only unfenced lines can open or close a section, so a heading inside a fence
 * neither introduces one nor truncates one. `requireAncestor` additionally
 * demands that the nearest preceding shallower heading be that text, so a spec's
 * `### Structural context` counts only inside `## Design`.
 *
 * When the heading appears more than once at the same depth, the FIRST is the
 * section: the second terminates it rather than opening a rival, so a filled
 * duplicate lower down can never mask a stub above it.
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
    const m = /^(#{1,6})\s/.exec(l.text);
    if (m === null || m[1].length >= depth) continue;
    return l.text.trim() === requireAncestor;
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
 * An unreadable directory is an empty list rather than a throw — a repo that has
 * not adopted the surface has nothing to report, which is not an error.
 */
export async function listMd(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries.filter((e) => e.endsWith('.md') && e !== ARCHIVE_DIR).toSorted();
}

/** File contents, or `null` when it cannot be read. Callers skip what they cannot open. */
export async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * The reason attached to this section's first `noldor:cut` line, or `null` when
 * the section carries none.
 *
 * Suppression must come from THIS section, not from anywhere in the artifact: a
 * marker under an unrelated heading says nothing about this one. The marker must
 * also be its own token — a bare `startsWith` let `noldor:cutlery` suppress a
 * section, with `lery ...` counting as the reason.
 *
 * An empty string is a real result: a bare marker declines nothing, and it is
 * the caller's floor that decides so. `null` and `''` therefore mean different
 * things and callers must not collapse them.
 *
 * @param scanned - The section's fence-stripped view, comment-stripped by callers that need it
 */
export function cutReason(scanned: string): string | null {
  const marker = scanned.split('\n').find((line) => CUT_MARKER_RE.test(line.trim()));
  return marker === undefined ? null : marker.trim().replace(CUT_MARKER_RE, '');
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
