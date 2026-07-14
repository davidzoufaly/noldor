// @tests: dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics, project-tracking-dashboard
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ensureDashboard, isDashboardUp, resolveMainRoot } from '../ensure.js';
import { startServer } from '../server.js';

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

let server: Server;
let baseUrl: string;
let port: number;

beforeAll(async () => {
  ({ server, baseUrl } = await startServer({ port: 0 }));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('isDashboardUp', () => {
  it('returns true when a server answers /health', async () => {
    expect(await isDashboardUp(baseUrl)).toBe(true);
  });

  it('returns false when nothing listens on the port', async () => {
    expect(await isDashboardUp('http://localhost:1', 300)).toBe(false);
  });
});

describe('resolveMainRoot', () => {
  it('maps the main checkout git dir to the checkout root', () => {
    expect(resolveMainRoot(() => '/repo/.git')).toBe('/repo');
  });

  it('maps a worktree git-common-dir to the MAIN checkout root, not the worktree', () => {
    // From .worktrees/<slug>, --git-common-dir points at the main .git.
    expect(resolveMainRoot(() => '/repo/.git')).toBe('/repo');
  });

  it('falls back to cwd when git is unavailable', () => {
    expect(
      resolveMainRoot(() => {
        throw new Error('not a git repo');
      }),
    ).toBe(process.cwd());
  });

  it('falls back to cwd on a layout without a .git suffix (bare repo)', () => {
    expect(resolveMainRoot(() => '/srv/bare-repo')).toBe(process.cwd());
  });
});

describe('ensureDashboard', () => {
  it('reports already-running and does not spawn when a server answers', async () => {
    let spawned = 0;
    const result = await ensureDashboard({
      port,
      spawnFn: () => {
        spawned += 1;
      },
    });
    expect(result).toEqual({ status: 'already-running', baseUrl });
    expect(spawned).toBe(0);
  });

  it('throws when the spawned server never becomes healthy', async () => {
    let spawnedPort = 0;
    const result = await ensureDashboard({
      port: 1, // nothing answers here — forces the spawn branch
      spawnFn: (p) => {
        spawnedPort = p;
      },
      waitMs: 600,
    }).catch((err: unknown) => err);
    expect(spawnedPort).toBe(1);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('/health did not answer');
  });

  it('returns spawned without waiting when wait is false', async () => {
    let spawned = 0;
    const result = await ensureDashboard({
      port: 1,
      wait: false,
      spawnFn: () => {
        spawned += 1;
      },
    });
    expect(result.status).toBe('spawned');
    expect(spawned).toBe(1);
  });

  it('resolves started once the spawned server answers', async () => {
    let extra: { server: Server; baseUrl: string } | null = null;
    // Reserve a free port first, close it, then have spawnFn bind it — mirrors
    // the real flow where the probe and the spawned server share the port.
    const probe = await startServer({ port: 0 });
    const freePort = (probe.server.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.server.close(() => resolve()));

    const result = await ensureDashboard({
      port: freePort,
      waitMs: 5000,
      spawnFn: () => {
        void startServer({ port: freePort }).then((s) => {
          extra = s;
        });
      },
    });
    expect(result.status).toBe('started');
    expect(result.baseUrl).toBe(`http://127.0.0.1:${freePort}`);
    if (extra !== null) {
      const { server: extraServer } = extra as { server: Server; baseUrl: string };
      await new Promise<void>((resolve) => extraServer.close(() => resolve()));
    }
  });
});
