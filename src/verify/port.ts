// @tests: acceptance-verify-lane
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';

/**
 * Resolve the port for verify-lane boots, exactly once per lane run: always a
 * fresh free ephemeral port found by binding port 0. Deliberately NOT the
 * worktree's `.env.local` `PORT` — that port may carry the operator's live
 * dev server, and verify needs exclusive ownership (its pre-boot occupancy
 * check fails on any listener and its reap kills whatever holds the port).
 * Callers pass the concrete number everywhere (smoke and the verifier prompt)
 * so all boots in one run target the same port.
 */
export function resolvePort(_cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}
