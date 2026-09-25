import { readFile } from 'node:fs/promises';

export async function readFdSummary(fdPath: string): Promise<string> {
  const raw = await readFile(fdPath, 'utf8');
  // JS regex does not support `\Z`; use a manual end-of-input lookahead.
  // `(?=^## |$(?![\s\S]))` matches either the next H2 OR a position with no
  // following characters (end of string).
  const m = raw.match(/^## Summary\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
  if (!m) throw new Error(`readFdSummary: no ## Summary section in ${fdPath}`);
  return m[1].trim();
}

/**
 * Acceptance text for the verify lane: the FD's `## Summary` and `## Usage`
 * bodies, joined. `readFdSummary` above captures Summary only — Usage is what
 * carries the testable promises (CLI invocations, endpoints, flags), so the
 * verify lane needs both. Throws when neither section exists; the caller maps
 * a missing FD file (fast-track) to its commit-prose fallback.
 */
export async function extractFdAcceptance(fdPath: string): Promise<string> {
  const raw = await readFile(fdPath, 'utf8');
  const grab = (heading: string): string =>
    raw
      .match(new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'))?.[1]
      .trim() ?? '';
  const parts = [grab('Summary'), grab('Usage')].filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`extractFdAcceptance: no ## Summary or ## Usage section in ${fdPath}`);
  }
  return parts.join('\n\n');
}

/**
 * An FD with its unfilled scaffold stubs removed: every `<!-- TODO … -->` comment outside a
 * code fence, then every `## ` section that removal left with no body. Plan and code reviews
 * read the whole FD, and a stub nobody fills before those stages (`## Diagram`'s, notably)
 * would otherwise read as unfinished work to review (Q-0284). Filled sections, drafted User
 * Story and Usage included, pass through untouched — and so does a stub quoted inside a fence.
 */
export function stripFdScaffoldStubs(raw: string): string {
  const rawLines = raw.split('\n');
  const rawFenced = fencedLines(rawLines);
  // Runs of unfenced lines are joined before the strip so a multi-line stub comes out whole.
  const chunks: { text: string; fenced: boolean }[] = [];
  rawLines.forEach((line, i) => {
    const last = chunks[chunks.length - 1];
    if (last?.fenced === rawFenced[i]) last.text += `\n${line}`;
    else chunks.push({ text: line, fenced: rawFenced[i] });
  });
  const lines = chunks
    .map((c) => (c.fenced ? c.text : c.text.replace(/<!--\s*TODO[\s\S]*?-->/g, '')))
    .join('\n')
    .split('\n');
  const fenced = fencedLines(lines);
  const isHeading = lines.map((line, i) => !fenced[i] && line.startsWith('## '));
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isHeading[i]) {
      let j = i + 1;
      while (j < lines.length && !isHeading[j] && lines[j].trim() === '') j++;
      if (j === lines.length || isHeading[j]) {
        i = j - 1;
        continue;
      }
    }
    out.push(lines[i]);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Per line: is it a code-fence line or inside a fence? A closer matches the opener's char and length. */
function fencedLines(lines: string[]): boolean[] {
  let open: string | null = null;
  return lines.map((line) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (marker === undefined) return open !== null;
    if (open === null) open = marker;
    else if (marker[0] === open[0] && marker.length >= open.length) open = null;
    return true;
  });
}
