// @tests: acceptance-verify-lane
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

/**
 * Resolve the port for verify-lane boots, exactly once per lane run: the
 * worktree's `PORT` from `.env.local` (the port-per-tree convention in
 * docs/noldor/worktree-discipline.md), else a free ephemeral port found by
 * binding port 0. Callers pass the concrete number everywhere (smoke and the
 * verifier prompt) so all boots in one run target the same port.
 */
export function resolvePort(cwd: string): Promise<number> {
  try {
    const env = readFileSync(join(cwd, '.env.local'), 'utf8');
    // No end anchor: tolerate trailing comments/whitespace (`PORT=4321 # dev`).
    const m = env.match(/^PORT=(\d+)/m);
    if (m) return Promise.resolve(Number(m[1]));
  } catch {
    /* no .env.local — fall through to free-port probe */
  }
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}
