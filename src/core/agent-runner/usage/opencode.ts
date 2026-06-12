import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TokenUsage, UsageLookup } from './types.js';

/**
 * Sum `tokens` from assistant message records in opencode's storage
 * (~/.local/share/opencode/storage/message/<session>/<msg>.json) modified
 * after spawn start. Null when absent — never estimates.
 */
export function opencodeUsage(lookup: UsageLookup): TokenUsage | null {
  try {
    const root = join(
      lookup.homeDir ?? homedir(),
      '.local',
      'share',
      'opencode',
      'storage',
      'message',
    );
    let input = 0;
    let output = 0;
    let seen = false;
    for (const ses of readdirSync(root, { withFileTypes: true })) {
      if (!ses.isDirectory()) continue;
      const sesDir = join(root, ses.name);
      for (const f of readdirSync(sesDir)) {
        const p = join(sesDir, f);
        if (!f.endsWith('.json') || statSync(p).mtimeMs < lookup.startedAtMs) continue;
        try {
          const rec = JSON.parse(readFileSync(p, 'utf8')) as {
            role?: string;
            tokens?: { input?: number; output?: number };
          };
          if (
            rec.role === 'assistant' &&
            typeof rec.tokens?.input === 'number' &&
            typeof rec.tokens?.output === 'number'
          ) {
            input += rec.tokens.input;
            output += rec.tokens.output;
            seen = true;
          }
        } catch {
          // skip malformed file
        }
      }
    }
    return seen ? { input, output, total: input + output, source: 'opencode-session' } : null;
  } catch {
    return null;
  }
}
