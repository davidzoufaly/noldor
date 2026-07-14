/**
 * Dashboard bind-host resolution + probe-URL formatting, shared by `server.ts`
 * (which binds) and `ensure.ts` (which probes). Kept in its own tiny module so
 * the session-start hot path (`ensureDashboard`) does not import the heavy
 * `server.ts` graph just to format a URL.
 */

/**
 * The interface the dashboard binds to. Defaults to loopback (`127.0.0.1`): the
 * dashboard has no auth and exposes state-mutating POST routes (roadmap
 * add/move/remove), so binding all interfaces — Node's default when the host
 * arg is omitted — would put a roadmap-inject surface on the LAN. Opt into wider
 * exposure explicitly via `--host` or the `DASHBOARD_HOST` env var (e.g.
 * `0.0.0.0`).
 */
export function resolveBindHost(explicit?: string): string {
  return explicit ?? process.env.DASHBOARD_HOST ?? '127.0.0.1';
}

/**
 * A connectable `http://host:port` URL for health probes and display. A
 * wildcard bind (`0.0.0.0` / `::`) is not a portable connect target, so probe
 * loopback instead; IPv6 literals are bracketed for a valid URL authority.
 */
export function healthUrl(host: string, port: number): string {
  const connect = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const authority = connect.includes(':') ? `[${connect}]` : connect;
  return `http://${authority}:${port}`;
}
