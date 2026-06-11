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

/**
 * Run `fn` over `items` with at most `limit` in flight at once. Resolves when all
 * have completed; `fn` should swallow/record its own errors (a throw rejects the run).
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push(
      (async () => {
        for (;;) {
          const index = cursor++;
          if (index >= items.length) break;
          await fn(items[index]!, index);
        }
      })(),
    );
  }
  await Promise.all(workers);
}
