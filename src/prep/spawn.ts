import { spawnAgent } from '../core/agent-runner/registry.js';

export interface ClaudeResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly timedOut: boolean;
}

export interface SpawnClaudeOpts {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly timeoutMs?: number;
}

/**
 * Spawn one headless implementer-role agent child (claude unless the
 * consumer's agents config says otherwise — the registry resolves it).
 * stdout is captured; the child's stderr is inherited for live progress.
 * Kept under its historical name — prep call sites and tests inject it.
 */
export function spawnClaude(prompt: string, opts: SpawnClaudeOpts = {}): Promise<ClaudeResult> {
  return spawnAgent(prompt, {
    role: 'implementer',
    cwd: opts.cwd,
    env: opts.env,
    timeoutMs: opts.timeoutMs,
    stdio: 'pipe',
    needsWrite: true,
    site: 'prep.spawn',
  });
}
