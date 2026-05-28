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
