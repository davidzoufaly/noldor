/**
 * Extract the first `{ … }` object from a command's stdout, tolerating any
 * non-JSON noise around it.
 *
 * `pnpm --silent` already strips pnpm's lifecycle banner, but a pnpm flag is not
 * the only thing that can pollute stdout (codex CLI warnings, an `.npmrc`-driven
 * notice, a deprecation line), and a leading `>` makes a bare `JSON.parse`
 * throw. Slicing from the first `{` to the last `}` recovers the object
 * regardless of surrounding lines.
 *
 * Shared by the orchestrate codex lane (`lanes/codex.ts`, which reads the lane
 * CLI's `{ summary, findings }`) and by `run-codex.ts` (which reads codex's own
 * `CrRecord`). The message carries no lane prefix precisely because it now
 * serves both callers.
 */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end < start) {
    throw new Error(`no JSON object in stdout: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}
