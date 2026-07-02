import { spawnSync } from 'node:child_process';

export type NotifyKind = 'escalation' | 'cycle-summary' | 'watcher-tripped' | 'reconcile-failed';

/**
 * Pluggable consumer notification hook (spec Unit 4). POSIX-only by
 * construction (bash -c), consistent with syncMainCleanState. Fail-open:
 * 10s timeout, every failure logged to stderr and swallowed — notification
 * must never block or kill the loop (appendAgentEvent's contract).
 */
export function notify(
  command: string | undefined,
  kind: NotifyKind,
  payload: unknown,
  cwd: string,
): void {
  if (command === undefined || command === '') return;
  try {
    const r = spawnSync('bash', ['-c', command], {
      cwd,
      timeout: 10_000,
      stdio: 'pipe',
      env: {
        ...process.env,
        NOLDOR_NOTIFY_KIND: kind,
        NOLDOR_NOTIFY_JSON: JSON.stringify(payload),
      },
    });
    if (r.status !== 0) {
      process.stderr.write(`notify hook exited ${String(r.status)} (non-fatal)\n`);
    }
  } catch (err) {
    process.stderr.write(`notify hook failed (non-fatal): ${String(err)}\n`);
  }
}
