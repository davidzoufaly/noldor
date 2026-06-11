import type { RunnerName } from '../core/agent-runner/types.js';

/**
 * Filter the template manifest to the consumer's chosen agent targets.
 * Driver-neutral files (docs, lefthook, …) always pass. `AGENTS.md` serves
 * both codex and opencode (both read it natively).
 */
export function filterTemplatesByAgents(files: string[], targets: RunnerName[]): string[] {
  return files.filter((f) => {
    if (f.startsWith('.claude/')) return targets.includes('claude');
    if (f.startsWith('.opencode/') || f === 'opencode.json') return targets.includes('opencode');
    if (f === 'AGENTS.md') return targets.includes('codex') || targets.includes('opencode');
    return true;
  });
}
