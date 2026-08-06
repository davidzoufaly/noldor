/**
 * Dashboard project identity + port-ownership resolution.
 *
 * Multi-project dev setups (the framework repo plus consumer repos) each run
 * their own `noldor dashboard server`, all defaulting to the same port. Without
 * an identity payload the second server can only see "something is on 4321" —
 * not whether that something is *this* project's dashboard (safe to reuse) or a
 * *different* project's (needs another port). This module supplies the payload
 * (`/identity` on the server) and the probe/plan logic both `server.ts` and
 * `ensure.ts` use to decide reuse-vs-move.
 *
 * Deliberately free of the heavy `server.ts` graph so the session-start hot
 * path (`ensureDashboard`) stays cheap, and free of any bind attempt so
 * `dashboard status` can report ownership without stealing a port.
 */

import { execFileSync } from 'node:child_process';
import { connect } from 'node:net';
import { basename, dirname, resolve, sep } from 'node:path';

import { healthUrl } from './host.js';

/** Default dashboard port, mirroring `startServer` in `server.ts`. */
export const DEFAULT_PORT = 4321;

/** How many consecutive ports `planPort` probes before giving up. */
export const DEFAULT_MAX_PORT_TRIES = 10;

/** Lowest and highest port a scan may reach. */
export const MIN_PORT = 1;
export const MAX_PORT = 65535;

/** True when `value` is an integer inside `[MIN_PORT, MAX_PORT]`. */
export function isValidPort(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= MIN_PORT && value <= MAX_PORT
  );
}

/**
 * Coerce a port from an untrusted source (`PORT` env, a CLI arg) into a
 * bindable one, falling back to `fallback` when it is not.
 *
 * Without this, `PORT=abc` reaches {@link planPort} as `NaN`: the loop
 * condition is false on the first compare, so it runs zero iterations and
 * reports `no free dashboard port in NaN..NaN` — a range error for what is
 * really a bad env var.
 */
export function normalizePort(value: unknown, fallback = DEFAULT_PORT): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return isValidPort(n) ? n : fallback;
}

/** What a running dashboard reports about the project it serves. */
export interface DashboardIdentity {
  /** Absolute main-checkout root the server's docs are anchored at. */
  root: string;
  /** Display label — basename of {@link root}. */
  name: string;
  /** Server PID, so an operator can act on the answer without `lsof`. */
  pid: number;
}

/**
 * What occupies a port, as seen from the outside (connect + HTTP only, never a
 * bind):
 * - `free` — nothing is listening.
 * - `dashboard` — a Noldor dashboard that answered `/identity`.
 * - `legacy-dashboard` — answered `/health` but not `/identity`: a dashboard
 *   from a build predating this feature, whose project is unknowable.
 * - `foreign` — something is listening, but it is not a dashboard.
 */
export type PortProbe =
  | { kind: 'free' }
  | { kind: 'dashboard'; identity: DashboardIdentity }
  | { kind: 'legacy-dashboard' }
  | { kind: 'foreign' };

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
 * It is also the identity a dashboard reports, so every worktree of one repo
 * agrees on who owns the port.
 *
 * @param run - Injection seam for tests; returns `git rev-parse --git-common-dir` output
 * @returns Main checkout root, or `process.cwd()` when git is absent or the layout is odd
 */
export function resolveMainRoot(run: () => string = gitCommonDir): string {
  try {
    const common = run();
    // `<main-root>/.git` from main checkout AND from any linked worktree.
    // Git emits forward slashes even on win32, so don't test with path.sep.
    if (common.endsWith('/.git') || common.endsWith('\\.git')) return dirname(common);
    return process.cwd();
  } catch {
    return process.cwd();
  }
}

/** The identity this process would report for `root`. */
export function localIdentity(root: string = resolveMainRoot()): DashboardIdentity {
  const abs = resolve(root);
  return { root: abs, name: basename(abs) || abs, pid: process.pid };
}

/**
 * True when two roots name the same project. Compares resolved absolute paths;
 * a trailing separator on either side is not a difference.
 */
export function sameProject(a: string, b: string): boolean {
  const norm = (p: string): string => {
    const r = resolve(p);
    return r.length > 1 && r.endsWith(sep) ? r.slice(0, -1) : r;
  };
  return norm(a) === norm(b);
}

/** Longest `root` / `name` accepted from a peer, before truncation. */
const MAX_IDENTITY_FIELD = 512;

/**
 * Make a string from an unauthenticated HTTP peer safe to print. Anything
 * listening on the probed port can answer `/identity`, and the answer is
 * interpolated into `console.log` — so drop control characters (ANSI escapes,
 * `\r` line-rewrites) and cap the length.
 */
function sanitizeField(value: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control chars is the point
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '');
  return clean.length > MAX_IDENTITY_FIELD ? `${clean.slice(0, MAX_IDENTITY_FIELD)}…` : clean;
}

/**
 * Narrow an untyped `/identity` body, tolerating extra fields. Treats the
 * payload as untrusted: the peer is whoever happens to hold the port.
 */
export function parseIdentity(value: unknown): DashboardIdentity | null {
  if (typeof value !== 'object' || value === null) return null;
  const { root, name, pid } = value as Record<string, unknown>;
  if (typeof root !== 'string' || root.length === 0) return null;
  const safeRoot = sanitizeField(root);
  if (safeRoot.length === 0) return null;
  const rawName = typeof name === 'string' && name.length > 0 ? sanitizeField(name) : '';
  return {
    root: safeRoot,
    name: rawName.length > 0 ? rawName : basename(safeRoot) || safeRoot,
    pid: typeof pid === 'number' && Number.isInteger(pid) && pid >= 0 ? pid : 0,
  };
}

/**
 * True when something accepts a TCP connection on `host:port`. A *connect*, not
 * a bind — probing must never take the port away from whoever is starting up.
 */
export function isPortListening(host: string, port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((res) => {
    // `connect` throws ERR_SOCKET_BAD_PORT synchronously for an out-of-range
    // port. Nothing can be listening there, so answer false rather than letting
    // the rejection escape a probe loop.
    if (!isValidPort(port)) {
      res(false);
      return;
    }
    const socket = connect({ host, port });
    const done = (answer: boolean): void => {
      socket.destroy();
      res(answer);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/**
 * Classify what holds `host:port` without binding it.
 *
 * @param host - Host to probe (the same loopback the server binds)
 * @param port - Port to probe
 * @param timeoutMs - Per-request budget for the HTTP probes (default 1500)
 */
export async function probePort(host: string, port: number, timeoutMs = 1500): Promise<PortProbe> {
  // Raising `timeoutMs` must widen every leg, not just the HTTP ones — but a
  // caller shortening it must not drop the connect below its 400ms floor.
  if (!(await isPortListening(host, port, Math.max(timeoutMs, 400)))) return { kind: 'free' };
  const base = healthUrl(host, port);
  try {
    const res = await fetch(`${base}/identity`, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) {
      const identity = parseIdentity(await res.json());
      if (identity) return { kind: 'dashboard', identity };
    }
  } catch {
    // fall through to the /health probe
  }
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) return { kind: 'legacy-dashboard' };
  } catch {
    // not a dashboard
  }
  return { kind: 'foreign' };
}

/** Outcome of {@link planPort}. */
export interface PortPlan {
  /**
   * `reuse` — this project's dashboard already serves `port`; do not bind.
   * `bind` — `port` is free; bind it.
   */
  action: 'reuse' | 'bind';
  port: number;
  /**
   * Ports that were skipped and why — the desired port occupied by another
   * project, a non-dashboard process, etc. Empty when `port === desired`.
   */
  skipped: Array<{ port: number; probe: PortProbe }>;
}

export interface PlanPortOptions {
  /** First port to try (the configured/default port). */
  desired: number;
  host: string;
  /** This project's root, per {@link resolveMainRoot}. */
  root: string;
  /** How many consecutive ports to try (default {@link DEFAULT_MAX_PORT_TRIES}). */
  maxTries?: number;
  /** Injection seam for tests — replaces {@link probePort}. */
  probe?: (host: string, port: number) => Promise<PortProbe>;
}

/**
 * Decide which port this project's dashboard should use, scanning upward from
 * `desired`.
 *
 * A port already served by *this* project short-circuits to `reuse` — that is
 * the idempotent no-op the session-start hook wants. A port held by a different
 * project, by an identity-less older dashboard, or by an unrelated process is
 * skipped rather than fought over: `EADDRINUSE` told the operator nothing, and
 * a dashboard rendering the wrong repo's docs is worse than a second port.
 *
 * A `legacy-dashboard` is treated as foreign on purpose. It may well be this
 * project's own server from a pre-`/identity` build, but "may well be" is not
 * good enough to render another repo's roadmap — so the new server takes the
 * next port, and the duplicate resolves itself the next time the old one is
 * restarted.
 *
 * @throws When no port in `[desired, desired + maxTries)` is usable
 */
export async function planPort(opts: PlanPortOptions): Promise<PortPlan> {
  const { host, root } = opts;
  // A bad PORT env must not become a NaN range; the scan must not run off the
  // end of the port space (65536 is not a port, and probing it throws).
  const first = normalizePort(opts.desired);
  const maxTries = opts.maxTries ?? DEFAULT_MAX_PORT_TRIES;
  const last = Math.min(first + maxTries - 1, MAX_PORT);
  const probe = opts.probe ?? probePort;
  const skipped: PortPlan['skipped'] = [];

  for (let port = first; port <= last; port++) {
    const result = await probe(host, port);
    if (result.kind === 'free') return { action: 'bind', port, skipped };
    if (result.kind === 'dashboard' && sameProject(result.identity.root, root)) {
      return { action: 'reuse', port, skipped };
    }
    skipped.push({ port, probe: result });
  }
  throw new Error(
    `no free dashboard port in ${first}..${last} — occupied by: ${describeSkipped(skipped)}. ` +
      `Pass --port <n> to start the scan somewhere else.`,
  );
}

/** Where this project's dashboard was found, and what was passed over first. */
export interface DashboardSearch {
  port: number;
  skipped: PortPlan['skipped'];
}

/**
 * Find this project's running dashboard anywhere in the range, or `null`.
 *
 * Unlike {@link planPort} this does NOT stop at the first free port — it is
 * asking "where is my dashboard", not "where should one go". That distinction
 * matters for the post-spawn readiness poll: the spawned child re-plans on its
 * own and can land above the port the parent picked, and the occupant that
 * pushed it up there may exit during the wait. `planPort` would then see the
 * lower port free, answer `bind`, and never notice the healthy child above it.
 *
 * @param opts - Same shape as {@link PlanPortOptions}; `desired` is the first port scanned
 */
export async function findMyDashboard(opts: PlanPortOptions): Promise<DashboardSearch | null> {
  const { host, root } = opts;
  const first = normalizePort(opts.desired);
  const last = Math.min(first + (opts.maxTries ?? DEFAULT_MAX_PORT_TRIES) - 1, MAX_PORT);
  const probe = opts.probe ?? probePort;
  const skipped: PortPlan['skipped'] = [];

  for (let port = first; port <= last; port++) {
    const result = await probe(host, port);
    if (result.kind === 'dashboard' && sameProject(result.identity.root, root)) {
      return { port, skipped };
    }
    if (result.kind !== 'free') skipped.push({ port, probe: result });
  }
  return null;
}

/**
 * Merge two skip lists, deduped by port, with entries from `later` winning —
 * a second observation of the same port is the fresher truth.
 */
export function mergeSkipped(
  earlier: PortPlan['skipped'],
  later: PortPlan['skipped'],
): PortPlan['skipped'] {
  const byPort = new Map(earlier.map((s) => [s.port, s]));
  for (const s of later) byPort.set(s.port, s);
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

/** One-line human rendering of a probe result, for CLI messages. */
export function describeProbe(probe: PortProbe): string {
  switch (probe.kind) {
    case 'free':
      return 'free';
    case 'dashboard':
      return `${probe.identity.name} (${probe.identity.root}, pid ${probe.identity.pid})`;
    case 'legacy-dashboard':
      return 'a dashboard that does not report /identity (pre-1.1.2 build)';
    case 'foreign':
      return 'a non-dashboard process';
  }
}

/** Comma-joined `port — owner` rendering of {@link PortPlan.skipped}. */
export function describeSkipped(skipped: PortPlan['skipped']): string {
  return skipped.map((s) => `${s.port} — ${describeProbe(s.probe)}`).join(', ');
}
