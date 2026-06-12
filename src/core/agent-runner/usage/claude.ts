import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TokenUsage, UsageLookup } from './types.js';

/** Claude Code transcript dir name: cwd with every non-alphanumeric char replaced by '-'. */
export function claudeProjectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Sum native `usage` fields from assistant records of the newest session
 * JSONL modified after spawn start. Returns null when no such session or
 * no usage records exist — never estimates.
 */
export function claudeUsage(lookup: UsageLookup): TokenUsage | null {
  try {
    const root = join(
      lookup.homeDir ?? homedir(),
      '.claude',
      'projects',
      claudeProjectDirName(lookup.cwd),
    );
    const candidates = readdirSync(root)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => join(root, f))
      .filter((p) => statSync(p).mtimeMs >= lookup.startedAtMs)
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (candidates.length === 0) return null;
    let input = 0;
    let output = 0;
    let seen = false;
    for (const line of readFileSync(candidates[0], 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as {
          type?: string;
          message?: { usage?: { input_tokens?: number; output_tokens?: number } };
        };
        const u = rec.type === 'assistant' ? rec.message?.usage : undefined;
        if (u && typeof u.input_tokens === 'number' && typeof u.output_tokens === 'number') {
          input += u.input_tokens;
          output += u.output_tokens;
          seen = true;
        }
      } catch {
        // skip malformed line
      }
    }
    return seen ? { input, output, total: input + output, source: 'claude-jsonl' } : null;
  } catch {
    return null;
  }
}
