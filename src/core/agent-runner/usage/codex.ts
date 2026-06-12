import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TokenUsage, UsageLookup } from './types.js';

/**
 * Read the LAST `token_count` record (codex emits running totals) of the
 * newest session file under ~/.codex/sessions modified after spawn start.
 * Null when absent — never estimates.
 */
export function codexUsage(lookup: UsageLookup): TokenUsage | null {
  try {
    const root = join(lookup.homeDir ?? homedir(), '.codex', 'sessions');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.jsonl') && statSync(p).mtimeMs >= lookup.startedAtMs)
          files.push(p);
      }
    };
    walk(root);
    files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (files.length === 0) return null;
    let last: { input: number; output: number } | null = null;
    for (const line of readFileSync(files[0], 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as {
          type?: string;
          input_tokens?: number;
          output_tokens?: number;
        };
        if (
          rec.type === 'token_count' &&
          typeof rec.input_tokens === 'number' &&
          typeof rec.output_tokens === 'number'
        ) {
          last = { input: rec.input_tokens, output: rec.output_tokens };
        }
      } catch {
        // skip malformed line
      }
    }
    return last ? { ...last, total: last.input + last.output, source: 'codex-session' } : null;
  } catch {
    return null;
  }
}
