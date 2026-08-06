/**
 * `noldor dashboard status` — report which project owns which dashboard port,
 * without binding anything.
 *
 * The bind-free constraint is the point: `dashboard server` / `dashboard ensure`
 * answer the ownership question by *acting* on it, so an operator staring at an
 * `EADDRINUSE` (or at two dashboards on 4321/4322) needs a read-only way to ask
 * the same question. Everything here is a TCP connect plus `GET /identity`.
 */

import { resolveBindHost, healthUrl } from './host.js';
import {
  DEFAULT_MAX_PORT_TRIES,
  DEFAULT_PORT,
  MAX_PORT,
  MIN_PORT,
  describeProbe,
  normalizePort,
  probePort,
  sameProject,
  resolveMainRoot,
  type PortProbe,
} from './identity.js';

/**
 * Widest `--scan` accepted. Probes are serial and a free port costs a full
 * connect timeout, so an unbounded scan (`--scan 65535`) would sit silently for
 * hours. 64 ports is ~25s worst case — long enough to be useful, short enough
 * that a wrong flag is obvious.
 */
export const MAX_SCAN = 64;

/** One scanned port and what holds it. */
export interface PortStatus {
  port: number;
  probe: PortProbe;
  /** True when `probe` is a dashboard serving the project we asked about. */
  mine: boolean;
}

export interface ScanOptions {
  /** First port to scan (default {@link DEFAULT_PORT}). */
  from?: number;
  /** How many consecutive ports to scan (default {@link DEFAULT_MAX_PORT_TRIES}). */
  count?: number;
  host?: string;
  /** Project root to compare ownership against; defaults to {@link resolveMainRoot}. */
  root?: string;
  /** Injection seam for tests — replaces {@link probePort}. */
  probe?: (host: string, port: number) => Promise<PortProbe>;
}

/**
 * Probe a contiguous port range and label each occupant.
 *
 * @returns One entry per occupied port, in ascending port order. Free ports are
 *   omitted — a list of "nothing there" is noise.
 */
export async function scanPorts(opts: ScanOptions = {}): Promise<PortStatus[]> {
  const from = normalizePort(opts.from ?? DEFAULT_PORT);
  const count = opts.count ?? DEFAULT_MAX_PORT_TRIES;
  const host = opts.host ?? resolveBindHost();
  const root = opts.root ?? resolveMainRoot();
  const probe = opts.probe ?? probePort;
  // Clamp so a wide --scan near the top of the range cannot probe port 65536.
  const last = Math.min(from + count - 1, MAX_PORT);

  const out: PortStatus[] = [];
  for (let port = from; port <= last; port++) {
    const result = await probe(host, port);
    if (result.kind === 'free') continue;
    const mine = result.kind === 'dashboard' && sameProject(result.identity.root, root);
    out.push({ port, probe: result, mine });
  }
  return out;
}

/** Human-readable rendering of a scan, one line per occupied port. */
export function formatStatus(statuses: PortStatus[], host: string, root: string): string {
  const lines: string[] = [];
  const mine = statuses.find((s) => s.mine);
  lines.push(
    mine
      ? `this project (${root}) → ${healthUrl(host, mine.port)}`
      : `this project (${root}) → not running`,
  );
  if (statuses.length === 0) {
    lines.push('no dashboard found on the scanned range');
    return lines.join('\n');
  }
  for (const s of statuses) {
    lines.push(`  ${s.port} — ${describeProbe(s.probe)}${s.mine ? '  ← this project' : ''}`);
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const readNum = (flag: string, min: number, max: number): number | undefined => {
    const i = argv.indexOf(flag);
    if (i < 0) return undefined;
    const n = Number(argv[i + 1]);
    if (!Number.isInteger(n) || n < min || n > max) {
      console.error(`${flag} requires an integer in ${min}..${max}`);
      process.exit(1);
    }
    return n;
  };
  const from = readNum('--port', MIN_PORT, MAX_PORT);
  const count = readNum('--scan', 1, MAX_SCAN);
  const host = resolveBindHost();
  const root = resolveMainRoot();
  const statuses = await scanPorts({ from, count, host, root });
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ root, host, ports: statuses }, null, 2));
  } else {
    console.log(formatStatus(statuses, host, root));
  }
  // Exit 1 when this project has no dashboard up, so `dashboard status && open …`
  // is a usable idiom. Occupied-by-someone-else is not an error here.
  // `exitCode` rather than `exit()`: a piped stdout write is async on POSIX, and
  // `exit()` would truncate `dashboard status --json | jq`.
  process.exitCode = statuses.some((s) => s.mine) ? 0 : 1;
}

if (process.argv[1]?.endsWith('status.ts') || process.argv[1]?.endsWith('status.js')) {
  void main();
}
