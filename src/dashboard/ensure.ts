import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { resolve } from 'node:path';

import { noldorCliCommand } from '../core/noldor-cli.js';

import { resolveBindHost, healthUrl } from './host.js';
import {
  DEFAULT_PORT,
  MAX_PORT,
  MIN_PORT,
  describeSkipped,
  findMyDashboard,
  isValidPort,
  mergeSkipped,
  normalizePort,
  planPort,
  probePort,
  resolveMainRoot,
  type PortPlan,
} from './identity.js';

export { DEFAULT_PORT, resolveMainRoot };

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
  /**
   * The port actually used — not necessarily the requested one (see
   * {@link planPort}). On `already-running` and `started` this is where a
   * dashboard for this project was *observed*. On `spawned` (`wait: false`)
   * it is only where the child was *asked* to start: the child re-plans on its
   * own, so with nothing waiting to observe the result it may end up elsewhere.
   */
  port: number;
  /** Ports passed over on the way to {@link EnsureResult.port}, and who held them. */
  skipped: PortPlan['skipped'];
}

export interface EnsureOptions {
  port?: number;
  /** Poll `/health` after spawning until it answers (default true). */
  wait?: boolean;
  /** Max ms to wait for the spawned server to become healthy. */
  waitMs?: number;
  /** Injection seam for tests — replaces the detached-process spawn. */
  spawnFn?: (port: number) => void;
  /** This project's root; defaults to {@link resolveMainRoot}. Injection seam for tests. */
  root?: string;
  /** Injection seam for tests — replaces `planPort`'s port probe. */
  probe?: PlanPortProbe;
}

type PlanPortProbe = NonNullable<Parameters<typeof planPort>[0]['probe']>;

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
  // Routed through noldorCliCommand so the launcher is correct on both
  // channels — bin/noldor.mjs under Node, direct self-exec under the compiled
  // binary (spec Unit 3b).
  const [cliCmd, cliArgs] = noldorCliCommand(['dashboard', 'server']);
  const child = spawn(cliCmd, cliArgs, {
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
 * Idempotent dashboard auto-start: work out which port belongs to this project
 * (see {@link planPort}) and spawn a detached server only when none is serving
 * it yet. Safe to call from every project-load entry point (session-start hook,
 * worktree spawn) — the first caller wins the port and later callers see
 * `already-running`.
 *
 * A port held by a *different* project's dashboard no longer blocks the spawn:
 * the plan moves to the next free port instead of colliding.
 *
 * @param opts - See {@link EnsureOptions}
 * @returns Outcome + the `baseUrl` and port actually used
 */
export async function ensureDashboard(opts: EnsureOptions = {}): Promise<EnsureResult> {
  const desired = normalizePort(opts.port ?? process.env.PORT, DEFAULT_PORT);
  // Probe the same loopback (or DASHBOARD_HOST) the detached server binds — not
  // `localhost`, which can resolve to ::1 and miss an IPv4-only 127.0.0.1 bind.
  const host = resolveBindHost();
  const root = opts.root ?? resolveMainRoot();
  const probe = opts.probe ?? probePort;
  const plan = await planPort({ desired, host, root, probe });
  const baseUrl = healthUrl(host, plan.port);
  const { port, skipped } = plan;
  if (plan.action === 'reuse') return { status: 'already-running', baseUrl, port, skipped };

  const spawnFn = opts.spawnFn ?? spawnDetachedServer;
  spawnFn(port);
  if (opts.wait === false) return { status: 'spawned', baseUrl, port, skipped };

  // Confirm readiness by IDENTITY over the same upward range the child scans.
  //
  // Two failure modes rule out the obvious `/health` check on a single port.
  // Identity: the child re-plans, so in a two-project race the *other* repo's
  // dashboard can be what answers — `/health` would return `started` with a
  // baseUrl serving the wrong docs. Range: for the same reason the child may
  // legitimately land on `port + N`, so polling only `port` would time out on a
  // dashboard that is actually up. `findMyDashboard` covers both, and unlike
  // `planPort` it keeps scanning past a free port — the occupant that pushed
  // the child upward may well exit while we are waiting.
  const deadline = Date.now() + (opts.waitMs ?? 10_000);
  while (Date.now() < deadline) {
    const found = await findMyDashboard({ desired: port, host, root, probe });
    if (found) {
      return {
        status: 'started',
        baseUrl: healthUrl(host, found.port),
        port: found.port,
        skipped: mergeSkipped(skipped, found.skipped),
      };
    }
    await sleep(250);
  }
  throw new Error(
    `dashboard spawned but no dashboard for this project answered at or above ${baseUrl} ` +
      `within the wait window — see ${DASHBOARD_LOG_PATH}`,
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const portIdx = argv.indexOf('--port');
  const port = portIdx >= 0 ? Number(argv[portIdx + 1]) : undefined;
  if (port !== undefined && !isValidPort(port)) {
    console.error(`--port requires an integer in ${MIN_PORT}..${MAX_PORT}`);
    process.exit(1);
  }
  const wait = !argv.includes('--no-wait');
  const result = await ensureDashboard({ port, wait });
  if (result.skipped.length > 0) {
    console.log(`port(s) skipped: ${describeSkipped(result.skipped)}`);
  }
  const label =
    result.status === 'already-running'
      ? 'already running for this project'
      : result.status === 'started'
        ? 'started'
        : 'spawning (not waited)';
  console.log(`dashboard ${label} → ${result.baseUrl}`);
}

if (process.argv[1]?.endsWith('ensure.ts') || process.argv[1]?.endsWith('ensure.js')) {
  void main();
}
