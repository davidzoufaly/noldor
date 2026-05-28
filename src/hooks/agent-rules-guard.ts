// scripts/hooks/agent-rules-guard.ts
// PreToolUse hook for the Agent tool. Enforces that every Agent dispatch
// prompt references docs/noldor/engineering-principles.md so subagents
// inherit the engineering rules (they don't auto-load CLAUDE.md). See
// docs/noldor/engineering-principles.md §"Subagent guidance".
import { z } from 'zod';

/**
 * Result of an agent-rules-guard run.
 *
 * @property ok - `true` when the dispatch may proceed; `false` blocks it.
 * @property reason - Human-readable explanation surfaced via stderr on block.
 */
export interface AgentRulesGuardResult {
  ok: boolean;
  reason?: string;
}

const REQUIRED_REF = 'engineering-principles.md';

const HookInputSchema = z
  .object({
    tool_name: z.string(),
    tool_input: z.unknown(),
  })
  .strip();

const AgentInputSchema = z
  .object({
    prompt: z.string(),
    subagent_type: z.string().optional(),
    description: z.string().optional(),
  })
  .strip();

/**
 * Validate a Claude Code PreToolUse hook payload for an `Agent` dispatch.
 *
 * Fails open (returns `{ ok: true }`) on infrastructure noise — malformed JSON,
 * non-`Agent` tool calls, or `tool_input` payloads missing the `prompt` field.
 * The guard only fires when the payload is well-formed AND targets the Agent
 * tool AND its prompt lacks a reference to `engineering-principles.md`.
 *
 * @param opts.stdin - Raw stdin string passed by Claude Code to the hook.
 * @returns `{ ok: true }` on pass; `{ ok: false, reason }` on block.
 */
export function runAgentRulesGuard(opts: { stdin: string }): AgentRulesGuardResult {
  const outer = HookInputSchema.safeParse(safeJsonParse(opts.stdin));
  if (!outer.success) return { ok: true };
  if (outer.data.tool_name !== 'Agent') return { ok: true };

  const inner = AgentInputSchema.safeParse(outer.data.tool_input);
  if (!inner.success) return { ok: true };

  if (inner.data.prompt.includes(REQUIRED_REF)) return { ok: true };

  return {
    ok: false,
    reason:
      `Agent prompt missing required reference to "${REQUIRED_REF}". ` +
      `Add the line: "Follow engineering principles in docs/noldor/engineering-principles.md ` +
      `and project overlays in .claude/engineering-rules.md." per ` +
      `docs/noldor/engineering-principles.md §"Subagent guidance".`,
  };
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let stdin = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    stdin += chunk;
  });
  process.stdin.on('end', () => {
    const r = runAgentRulesGuard({ stdin });
    if (!r.ok) {
      process.stderr.write(`Noldor agent guard: ${r.reason}\n`);
      process.exit(2);
    }
  });
}
