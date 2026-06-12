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
