import { spawn } from 'node:child_process';

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
 * Spawn one headless `claude --print "<prompt>"` child. Mirrors the autonomous
 * supervisor's spawnGate (bypassPermissions so Edit/Bash run unattended, and the
 * AskUserQuestion kill-switch so a forgotten prompt fails fast instead of hanging),
 * but takes an arbitrary prompt and runs async so a pool can fan out many at once.
 * stdout is captured; the child's stderr is inherited for live progress.
 */
export function spawnClaude(prompt: string, opts: SpawnClaudeOpts = {}): Promise<ClaudeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      [
        '--print',
        prompt,
        '--disallowed-tools',
        'AskUserQuestion',
        '--permission-mode',
        'bypassPermissions',
      ],
      {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    );
    let stdout = '';
    let timedOut = false;
    const timer =
      opts.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, opts.timeoutMs)
        : null;
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, timedOut });
    });
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
