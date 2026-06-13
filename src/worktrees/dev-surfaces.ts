// @tests: per-task-dev-environment-bootstrap
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DevSurface } from '../core/consumer-config.js';
import { waitForHttp200 } from '../verify/health.js';
import { deriveSurfacePort } from './worktree-status.js';

const PROBE_FETCH_TIMEOUT_MS = 2000;

/** One booted (and left-running) dev surface. */
export interface BootedSurface {
  name: string;
  port: number;
  url: string;
  pid: number | null;
  ready: boolean;
  note?: string;
}

export interface BootOptions {
  treePath: string;
  slug: string;
  surfaces: Record<string, DevSurface>;
  basePort: number;
  /** Where `.noldor/dev-<slug>.pids` is written (the main workspace root). */
  cwd: string;
  spawnImpl?: typeof spawn;
  fetchImpl?: typeof fetch;
}

/**
 * Boot every configured dev surface on `basePort + portOffset`, probe its
 * `healthPath` until 200 (or timeout), and LEAVE IT RUNNING (detached +
 * unref). Records live pids to `.noldor/dev-<slug>.pids` for `worktrees down`.
 * Unlike the verify smoke floor, the child is never killed.
 */
export async function bootDevSurfaces(opts: BootOptions): Promise<BootedSurface[]> {
  const spawnImpl = opts.spawnImpl ?? spawn;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const results: BootedSurface[] = [];

  for (const [name, surface] of Object.entries(opts.surfaces)) {
    const port = deriveSurfacePort(opts.basePort, surface.portOffset);
    const url = `http://127.0.0.1:${port}${surface.healthPath}`;
    const command = surface.command
      .replaceAll('{port}', String(port))
      .replaceAll('{path}', opts.treePath);

    // Pre-boot occupancy check: a 200 here means a stale/concurrent server
    // already holds the port; booting would false-green. Fail honestly.
    const occupied = await fetchImpl(url, {
      signal: AbortSignal.timeout(PROBE_FETCH_TIMEOUT_MS),
    }).then(
      () => true,
      () => false,
    );
    if (occupied) {
      results.push({
        name,
        port,
        url,
        pid: null,
        ready: false,
        note: `port ${port} already in use before boot`,
      });
      continue;
    }

    const child = spawnImpl('/bin/sh', ['-c', command], {
      cwd: opts.treePath,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    const ready = await waitForHttp200(url, Date.now() + surface.readyTimeoutMs, fetchImpl);
    results.push({ name, port, url, pid: child.pid ?? null, ready });
  }

  const live = results.filter((r) => r.pid !== null);
  if (live.length > 0) {
    const dir = join(opts.cwd, '.noldor');
    await mkdir(dir, { recursive: true });
    const body = live.map((r) => `${r.name} ${r.pid} ${r.port}`).join('\n');
    await writeFile(join(dir, `dev-${opts.slug}.pids`), `${body}\n`);
  }
  return results;
}
