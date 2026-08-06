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
    expect(result).toEqual({ status: 'already-running', baseUrl, port, skipped: [] });
    expect(spawned).toBe(0);
  });

  it('skips a port owned by another project and spawns on the next one', async () => {
    let spawnedPort = 0;
    const result = await ensureDashboard({
      port,
      wait: false,
      root: '/some/other/project',
      probe: async (_host, p) =>
        p === port
          ? { kind: 'dashboard', identity: { root: '/a/charuy', name: 'charuy', pid: 1 } }
          : { kind: 'free' },
      spawnFn: (p) => {
        spawnedPort = p;
      },
    });
    expect(result.status).toBe('spawned');
    expect(result.port).toBe(port + 1);
    expect(spawnedPort).toBe(port + 1);
    expect(result.skipped).toHaveLength(1);
  });

  it('reports started at the port the child actually landed on, not the planned one', async () => {
    // The child re-plans too: if the planned port is claimed in the gap between
    // the parent's probe and the child's bind, the child starts on port+1. The
    // wait must find it there instead of timing out on a live dashboard.
    let calls = 0;
    const mine = { kind: 'dashboard' as const, identity: { root: '/a/noldor', name: 'n', pid: 2 } };
    const result = await ensureDashboard({
      port: 4321,
      root: '/a/noldor',
      waitMs: 3000,
      probe: async (_host, p) => {
        calls += 1;
        if (calls === 1) return { kind: 'free' }; // planning pass
        if (p === 4321) return { kind: 'foreign' }; // lost the race
        return mine; // child landed here
      },
      spawnFn: () => {
        /* child re-plans to 4322 */
      },
    });
    expect(result.status).toBe('started');
    expect(result.port).toBe(4322);
    expect(result.baseUrl).toBe('http://127.0.0.1:4322');
  });

  it('does not report started when the port ends up serving another project', async () => {
    // Race: our child re-plans and moves on, another project's child wins the
    // port. A /health-only readiness check would have called this "started".
    let calls = 0;
    const result = await ensureDashboard({
      port: 1,
      root: '/a/noldor',
      waitMs: 600,
      probe: async () => {
        calls += 1;
        // First probe plans the port (free); every later one is the readiness
        // poll, by which time charuy's child has bound it.
        return calls === 1
          ? { kind: 'free' }
          : { kind: 'dashboard', identity: { root: '/a/charuy', name: 'charuy', pid: 1 } };
      },
      spawnFn: () => {
        /* the port is taken by charuy's server, not ours */
      },
    }).catch((err: unknown) => err);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('no dashboard for this project answered');
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
    expect((result as Error).message).toContain('no dashboard for this project answered');
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
