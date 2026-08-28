// @tests: per-task-dev-environment-bootstrap
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { DevSurface } from '../core/consumer-config.js';
import type { Slug } from '../core/slug.js';
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
  slug: Slug;
  surfaces: Record<string, DevSurface>;
  basePort: number;
  /** Guarded absolute path of the pids file, built by the caller's slug guard.
   *  Handed in rather than re-derived: this is the write twin of the read
   *  `downWorktree` performs, and a second construction site is how they drift. */
  pidsFile: string;
  /** The main workspace root. */
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

  // Surfaces hold distinct ports (base + offset) and are independent, so boot
  // them concurrently — wall-clock is the slowest single surface, not the sum
  // of every readyTimeoutMs. Object.entries order is preserved by the map.
  const results = await Promise.all(
    Object.entries(opts.surfaces).map(async ([name, surface]): Promise<BootedSurface> => {
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
        return {
          name,
          port,
          url,
          pid: null,
          ready: false,
          note: `port ${port} already in use before boot`,
        };
      }

      const child = spawnImpl('/bin/sh', ['-c', command], {
        cwd: opts.treePath,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      const ready = await waitForHttp200(url, Date.now() + surface.readyTimeoutMs, fetchImpl);
      return { name, port, url, pid: child.pid ?? null, ready };
    }),
  );

  const live = results.filter((r) => r.pid !== null);
  if (live.length > 0) {
    // The pids path is handed in already guarded rather than re-derived here:
    // this is the WRITE twin of the read `downWorktree` performs, and a second
    // construction site is how the two drift apart.
    await mkdir(dirname(opts.pidsFile), { recursive: true });
    const body = live.map((r) => `${r.name} ${r.pid} ${r.port}`).join('\n');
    await writeFile(opts.pidsFile, `${body}\n`);
  }
  return results;
}
