import type { FindingLocation } from './findings-schema.js';

/**
 * A `path:NN` or `path:NN-MM` mention inside reviewer prose.
 *
 * Extension-agnostic by design: the reviewer lane reviews markdown at spec and
 * plan stage and TypeScript at code stage, so a `.ts`-only pattern would make
 * the whole feature silent on two of the three kinds. The path run excludes
 * whitespace and backticks so a fenced mention (`` `a/b.ts:3` ``) yields the
 * path without its fence.
 *
 * A leading `/` or `.` is NOT matched: an absolute path and a `../` traversal
 * are never repo-relative changed files, and refusing them here means the
 * resolver never even considers a path it could not have been given honestly.
 */
const MENTION_RE = /(?<![\w/.-])([\w-]+(?:[/][\w.-]+)*\.[A-Za-z][\w]*):(\d+)(?:-(\d+))?/g;

/**
 * Every location a reviewer bullet names, confined to `changedFiles`.
 *
 * Pure — no fs, no git. The caller supplies the changed set, which is both the
 * confinement boundary (a `locations.file` originates in LLM output and is
 * later opened, so an unrecognised path must never reach a read) and the
 * resolver for a bare basename.
 *
 * Returns `[]` rather than throwing on anything unresolvable: an absent
 * location means "no signal from this finding", which is the honest outcome and
 * the one every downstream rule already handles.
 *
 * Deduplicated in first-seen order so a message that repeats a location does
 * not weight it twice, and so the array is stable for a digest.
 */
export function extractLocations(
  message: string,
  changedFiles: readonly string[],
): FindingLocation[] {
  if (changedFiles.length === 0) return [];
  const byPath = new Set(changedFiles);
  const byBasename = new Map<string, string[]>();
  for (const f of changedFiles) {
    const base = f.slice(f.lastIndexOf('/') + 1);
    const list = byBasename.get(base) ?? [];
    list.push(f);
    byBasename.set(base, list);
  }

  const out: FindingLocation[] = [];
  const seen = new Set<string>();
  for (const m of message.matchAll(MENTION_RE)) {
    const [, raw, lineText, endText] = m;
    if (raw === undefined || lineText === undefined) continue;
    // Exact repo-relative path first; a bare basename only when it names
    // exactly one changed file. Two candidates is ambiguity, and a guess about
    // which file a finding is in would produce a confident wrong signal.
    let file: string | undefined;
    if (byPath.has(raw)) file = raw;
    else if (!raw.includes('/')) {
      const candidates = byBasename.get(raw);
      if (candidates?.length === 1) file = candidates[0];
    }
    if (file === undefined) continue;

    const line = Number(lineText);
    const endLine = endText === undefined ? undefined : Number(endText);
    const key = `${file}:${line}:${endLine ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // An end at or below the start is a malformed range, not a one-line one —
    // drop the end rather than emitting a backwards span.
    out.push({
      file,
      line,
      ...(endLine !== undefined && endLine > line ? { endLine } : {}),
    });
  }
  return out;
}
