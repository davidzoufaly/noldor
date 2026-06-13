// @tests: per-task-dev-environment-bootstrap
import { spawn } from 'node:child_process';

type SpawnImpl = typeof spawn;

/**
 * Open the operator's editor on a worktree path via the consumer-configured
 * `dev.editor.command` (`{path}` substituted). Detached + unref so the CLI
 * exits immediately. Editor choice is cross-platform by the consumer's command.
 *
 * @param treePath - Absolute worktree path.
 * @param command - The `dev.editor.command` template, or undefined to skip.
 * @param spawnImpl - Injectable spawn (tests stub this).
 */
export async function openEditor(
  treePath: string,
  command: string | undefined,
  spawnImpl: SpawnImpl = spawn,
): Promise<{ opened: boolean; note?: string }> {
  if (!command) return { opened: false, note: 'no dev.editor configured' };
  const cmd = command.replaceAll('{path}', treePath);
  const child = spawnImpl('/bin/sh', ['-c', cmd], { detached: true, stdio: 'ignore' });
  child.unref();
  return { opened: true };
}
