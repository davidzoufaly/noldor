// @tests: ui-design-review-lane
// The boot/probe/kill machinery `runSmoke` grew for the verify lane, extracted
// (spec R4) so the render-compare lane shares it instead of copying: pre-boot
// occupancy check, detached own-process-group spawn, `waitForHttp200` against
// the health path, and a kill handle that SIGKILLs the whole boot tree. Smoke
// kills immediately after the probe; render-compare holds the server alive
// across its captures — which is why this returns a handle instead of owning
// the lifetime.

import { spawn } from 'node:child_process';
import { waitForHttp200 } from './health.js';

const PROBE_FETCH_TIMEOUT_MS = 2000;

export interface BootableSurface {
  command: string;
  healthPath: string;
  readyTimeoutMs: number;
}

export type BootOutcome =
  | { ok: true; url: string; command: string; kill: () => void }
  | { ok: false; url: string; command: string; observed: string };

/**
 * Boot one `kind: "server"` surface on `port` and wait for HTTP 200. Every
 * failure path — pre-occupied port, no 200 within the budget — has already
 * killed the boot tree before returning; the success path hands the caller the
 * kill handle and the caller MUST invoke it on every exit path.
 */
export async function bootServer(
  surface: BootableSurface,
  port: number,
  cwd: string,
  fetchImpl: typeof fetch = fetch,
  budgetMs: number = Number.MAX_SAFE_INTEGER,
): Promise<BootOutcome> {
  // The aggregate cap is a hard ceiling: an in-flight surface gets only the
  // remaining budget, not its full readyTimeoutMs.
  const readyMs = Math.max(1, Math.min(surface.readyTimeoutMs, budgetMs));
  const command = surface.command.replaceAll('{port}', String(port));
  const url = `http://127.0.0.1:${port}${surface.healthPath}`;
  // Pre-boot occupancy check: a fixed .env.local PORT may already carry a
  // stale or concurrent server. Booting anyway would EADDRINUSE-kill our
  // child while the probe false-greens against the pre-existing process (and
  // cleanup would never touch it). Fail the surface honestly instead.
  const occupied = await fetchImpl(url, {
    signal: AbortSignal.timeout(PROBE_FETCH_TIMEOUT_MS),
  }).then(
    () => true,
    () => false,
  );
  if (occupied) {
    return {
      ok: false,
      url,
      command,
      observed: `port ${port} already in use before boot — stale process or concurrent dev server; free it or fix the per-tree PORT`,
    };
  }
  // Own process group so cleanup kills the whole boot tree (pnpm → node → …).
  const child = spawn('/bin/sh', ['-c', command], { cwd, detached: true, stdio: 'ignore' });
  // A spawn failure emits an async 'error' event; without a listener it would
  // crash the process instead of reading as a failed boot. Racing it against
  // the health probe also spares the caller the full readyTimeoutMs wait.
  let spawnError: Error | null = null;
  const spawnFailed = new Promise<false>((resolveErr) => {
    child.once('error', (err) => {
      spawnError = err;
      resolveErr(false);
    });
  });
  const kill = (): void => {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already exited */
      }
    }
  };
  const deadline = Date.now() + readyMs;
  let ok = false;
  try {
    ok = await Promise.race([waitForHttp200(url, deadline, fetchImpl), spawnFailed]);
  } finally {
    if (!ok) kill();
  }
  if (ok) return { ok: true, url, command, kill };
  return {
    ok: false,
    url,
    command,
    observed:
      spawnError !== null
        ? `boot spawn failed: ${(spawnError as Error).message}`
        : `GET ${url} → no HTTP 200 within ${readyMs}ms`,
  };
}
