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

/**
 * Parse the LAST fenced ```json block in an agent's prose output.
 *
 * Lane children are told to emit exactly one fenced block as the final thing
 * they say; taking the last one means a model that reasons in JSON mid-answer
 * cannot fool the parser with an earlier draft. Shared by every lane whose child
 * returns a structured verdict (`lanes/verify-dispatch.ts`,
 * `lanes/ui-review-dispatch.ts`) — the extraction idiom is common even where the
 * verdict SCHEMAS deliberately are not.
 *
 * @returns The parsed value, or `null` when there is no fence or its body is not
 *   JSON. Callers own schema validation, so a shape mismatch is theirs to detect.
 */
export function parseLastJsonFence(md: string): unknown | null {
  const fences = [...md.matchAll(/```json\s*\n([\s\S]*?)```/g)];
  const last = fences.at(-1)?.[1];
  if (last === undefined) return null;
  try {
    return JSON.parse(last);
  } catch {
    // Bad JSON and an absent fence are one class for every caller: there is no
    // trustworthy verdict either way.
    return null;
  }
}

/**
 * The whole "read a lane child's structured verdict" step: last fenced block,
 * then schema validation. An absent fence, unparseable JSON and a shape mismatch
 * collapse to `null` on purpose — no caller can do anything different about them,
 * and each lane reports the single "no trustworthy verdict" outcome its contract
 * defines.
 */
export function parseFencedJson<T>(
  md: string,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
): T | null {
  const raw = parseLastJsonFence(md);
  if (raw === null) return null;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
