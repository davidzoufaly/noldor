/**
 * Parse an opencode `run --format json` NDJSON event stream (one JSON object
 * per line) into the assistant text. Verified against opencode 1.17.20
 * `run --format json` (2026-07-14): batch mode emits one COMPLETE `type:"text"`
 * part per step, each with a distinct `part.id` (no delta streaming — a
 * multi-line reply arrived as a single event). We key by `part.id` and keep the
 * LAST value per id, then concatenate in first-seen order: correct for the
 * observed distinct-id case, and defensive against any future cumulative
 * same-id re-emission (the final snapshot wins — no duplicated prose). Fail-open:
 * malformed/blank lines are skipped, never thrown. Text only — token telemetry
 * stays with the on-disk usage adapter (`usage/opencode.ts`); no duplicate sum.
 */
export function parseOpencodeEvents(stdout: string): string {
  const byPartId = new Map<string, string>();
  let anon = 0;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let ev: unknown;
    try {
      ev = JSON.parse(trimmed);
    } catch {
      continue; // tolerate non-JSON noise (stray logs, partial lines)
    }
    if (typeof ev !== 'object' || ev === null) continue;
    const e = ev as { type?: unknown; part?: unknown };
    if (e.type !== 'text') continue;
    const part = e.part as { id?: unknown; text?: unknown } | undefined;
    if (!part || typeof part.text !== 'string') continue;
    const id = typeof part.id === 'string' ? part.id : `__anon_${anon++}`;
    byPartId.set(id, part.text); // last value per id wins; Map preserves first-seen order
  }
  return [...byPartId.values()].join('');
}
