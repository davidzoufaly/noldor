import type { RunnerName } from '../core/agent-runner/types.js';

/**
 * Filter the template manifest to the consumer's chosen agent targets.
 * Driver-neutral files (docs, lefthook, `AGENTS.md`, …) always pass —
 * `AGENTS.md` is the rules file Claude Code, Codex and opencode all read.
 */
export function filterTemplatesByAgents(files: string[], targets: RunnerName[]): string[] {
  return files.filter((f) => {
    if (f.startsWith('.claude/')) return targets.includes('claude');
    if (f.startsWith('.opencode/') || f === 'opencode.json') return targets.includes('opencode');
    return true;
  });
}
