// @tests: dashboard-broken-pages-audit
// Regression net for the 2026-07-11 broken-pages audit: every static GET route
// the dashboard serves must render 200 with no "Internal error" body. The route
// list is GET_ROUTES — exported from the SAME map the router dispatches on, so
// this sweep cannot drift from the real routing table. One representative
// dynamic detail route per family is probed too (resolved from the live tree),
// covering the detail loaders a static-list sweep would miss.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { GET_ROUTES, startServer } from '../server.js';

import type { Server } from 'node:http';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  ({ server, baseUrl } = await startServer({ port: 0 }));
});

afterAll(async () => {
  await new Promise<void>((res) => server.close(() => res()));
});

async function expectHealthy(route: string): Promise<void> {
  const res = await fetch(`${baseUrl}${route}`);
  expect(res.status, `${route} status`).toBe(200);
  const body = await res.text();
  expect(body, `${route} body`).not.toContain('<h1>Internal error</h1>');
}

describe('dashboard route sweep', () => {
  it('covers every static GET route in the routing table', () => {
    // Belt-and-suspenders: the map must keep serving the known core surfaces.
    for (const must of ['/', '/roadmap', '/features', '/agents', '/agents/log', '/api/agents']) {
      expect(GET_ROUTES).toContain(must);
    }
  });

  it.each(GET_ROUTES)('GET %s renders 200 without an internal error', async (route) => {
    await expectHealthy(route);
  });

  it('one dynamic detail route per family renders healthy', async () => {
    const firstSlug = (dir: string, strip: RegExp): string | null => {
      try {
        // Only lowercase kebab names — the detail route regexes accept [a-z0-9-]+
        // (README.md and friends are not routable pages).
        const names = readdirSync(join(REPO_ROOT, dir)).filter(
          (n) => n.endsWith('.md') && /^[a-z0-9-]+\.md$/.test(n),
        );
        return names.length > 0 ? names[0]!.replace(strip, '') : null;
      } catch {
        return null;
      }
    };
    const probes: string[] = [];
    const feature = firstSlug('docs/features', /\.md$/);
    if (feature !== null) probes.push(`/features/${feature}`);
    const fwPage = firstSlug('docs/noldor', /\.md$/);
    if (fwPage !== null) probes.push(`/framework/${fwPage}`);
    // Self-host always has FDs + framework pages; an empty probe list means the
    // fixture assumptions broke — fail loudly rather than sweep nothing.
    expect(probes.length).toBeGreaterThan(0);
    for (const route of probes) {
      await expectHealthy(route);
    }
  });
});
