import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Default dashboard port, mirroring `startServer` in `server.ts`. */
export const DEFAULT_PORT = 4321;

/** Where the detached server's stdout/stderr land (operator-local, gitignored). */
export const DASHBOARD_LOG_PATH = '.noldor/dashboard.log';

export interface EnsureResult {
  /**
   * `already-running` — a healthy server answered the probe, nothing spawned.
   * `started` — spawned and confirmed healthy within the wait window.
   * `spawned` — spawned fire-and-forget (`wait: false`); health not confirmed.
   */
  status: 'already-running' | 'started' | 'spawned';
  baseUrl: string;
}

export interface EnsureOptions {
  port?: number;
  /** Poll `/health` after spawning until it answers (default true). */
  wait?: boolean;
  /** Max ms to wait for the spawned server to become healthy. */
  waitMs?: number;
  /** Injection seam for tests — replaces the detached-process spawn. */
  spawnFn?: (port: number) => void;
}

/**
 * True when a dashboard answers `GET /health` at `baseUrl` within `timeoutMs`.
 *
 * @param baseUrl - e.g. `http://localhost:4321`
 * @param timeoutMs - Abort the probe after this many ms (default 1500)
 */
export async function isDashboardUp(baseUrl: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

function gitCommonDir(): string {
  return execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf8',
  }).trim();
}

/**
 * Resolve the MAIN checkout root, even when called from inside a worktree.
 * The dashboard server roots its docs at its cwd, and the spawned server is a
 * port-global singleton that outlives the calling session — so a worktree
 * session must never anchor it at a disposable `.worktrees/<slug>` directory.
 *
 * @param run - Injection seam for tests; returns `git rev-parse --git-common-dir` output
 * @returns Main checkout root, or `process.cwd()` when git is absent or the layout is odd
 */
export function resolveMainRoot(run: () => string = gitCommonDir): string {
  try {
    const common = run();
    // `<main-root>/.git` from main checkout AND from any linked worktree.
    if (common.endsWith(`${sep}.git`)) return dirname(common);
    return process.cwd();
  } catch {
    return process.cwd();
  }
}

/**
 * Spawn the dashboard server as a detached child surviving this process,
 * logging to {@link DASHBOARD_LOG_PATH} under the main checkout root.
 *
 * The child's cwd is pinned to {@link resolveMainRoot} so the server's
 * docs root (cwd fallback in `server.ts`) is the main checkout, not whatever
 * worktree happened to trigger the spawn.
 *
 * @param port - Port handed to the server via `PORT`
 */
export function spawnDetachedServer(port: number): void {
  const root = resolveMainRoot();
  mkdirSync(resolve(root, '.noldor'), { recursive: true });
  const log = openSync(resolve(root, DASHBOARD_LOG_PATH), 'a');
  const here = dirname(fileURLToPath(import.meta.url));
  // `src/dashboard/` (or `dist/dashboard/`) → package root is two levels up.
  const launcher = resolve(here, '../../bin/noldor.mjs');
  const child = spawn(process.execPath, [launcher, 'dashboard', 'server'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, PORT: String(port) },
  });
  child.unref();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Idempotent dashboard auto-start: probe `/health`, spawn a detached server
 * only when nothing answers. Safe to call from every project-load entry point
 * (session-start hook, worktree spawn) — the first caller wins the port and
 * later callers see `already-running`.
 *
 * @param opts - See {@link EnsureOptions}
 * @returns Outcome + the probed `baseUrl`
 */
export async function ensureDashboard(opts: EnsureOptions = {}): Promise<EnsureResult> {
  const port = opts.port ?? Number(process.env.PORT ?? DEFAULT_PORT);
  const baseUrl = `http://localhost:${port}`;
  if (await isDashboardUp(baseUrl)) return { status: 'already-running', baseUrl };

  const spawnFn = opts.spawnFn ?? spawnDetachedServer;
  spawnFn(port);
  if (opts.wait === false) return { status: 'spawned', baseUrl };

  const deadline = Date.now() + (opts.waitMs ?? 10_000);
  while (Date.now() < deadline) {
    if (await isDashboardUp(baseUrl, 500)) return { status: 'started', baseUrl };
    await sleep(250);
  }
  throw new Error(
    `dashboard spawned but ${baseUrl}/health did not answer within the wait window — see ${DASHBOARD_LOG_PATH}`,
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const portIdx = argv.indexOf('--port');
  const port = portIdx >= 0 ? Number(argv[portIdx + 1]) : undefined;
  if (port !== undefined && !Number.isInteger(port)) {
    console.error('--port requires an integer value');
    process.exit(1);
  }
  const wait = !argv.includes('--no-wait');
  const result = await ensureDashboard({ port, wait });
  const label =
    result.status === 'already-running'
      ? 'already running'
      : result.status === 'started'
        ? 'started'
        : 'spawning (not waited)';
  console.log(`dashboard ${label} → ${result.baseUrl}`);
}

if (process.argv[1]?.endsWith('ensure.ts') || process.argv[1]?.endsWith('ensure.js')) {
  void main();
}
