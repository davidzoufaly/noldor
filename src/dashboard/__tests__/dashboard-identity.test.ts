// @tests: project-tracking-dashboard
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PORT,
  MAX_PORT,
  describeProbe,
  findMyDashboard,
  describeSkipped,
  isPortListening,
  isValidPort,
  localIdentity,
  mergeSkipped,
  normalizePort,
  parseIdentity,
  planPort,
  probePort,
  resolveMainRoot,
  sameProject,
} from '../identity.js';
import { startServer } from '../server.js';

import type { PortProbe } from '../identity.js';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const HOST = '127.0.0.1';

function dashboardAt(root: string): PortProbe {
  return { kind: 'dashboard', identity: { root, name: 'x', pid: 1 } };
}

describe('resolveMainRoot', () => {
  it('maps the main checkout git dir to the checkout root', () => {
    expect(resolveMainRoot(() => '/repo/.git')).toBe('/repo');
  });

  it('falls back to cwd when git is unavailable', () => {
    expect(
      resolveMainRoot(() => {
        throw new Error('not a git repo');
      }),
    ).toBe(process.cwd());
  });
});

describe('localIdentity', () => {
  it('names the project after the root basename', () => {
    const id = localIdentity('/Users/dev/code/charuy');
    expect(id).toMatchObject({ root: '/Users/dev/code/charuy', name: 'charuy' });
    expect(id.pid).toBe(process.pid);
  });
});

describe('sameProject', () => {
  it('ignores a trailing separator', () => {
    expect(sameProject('/a/b/', '/a/b')).toBe(true);
  });

  it('does not confuse sibling projects with a shared prefix', () => {
    expect(sameProject('/a/noldor', '/a/noldor-consumer')).toBe(false);
  });
});

describe('parseIdentity', () => {
  it('rejects a payload without a root', () => {
    expect(parseIdentity({ name: 'x' })).toBeNull();
    expect(parseIdentity('nope')).toBeNull();
    expect(parseIdentity(null)).toBeNull();
  });

  it('strips control characters a hostile peer could use to rewrite the terminal', () => {
    const hostile = parseIdentity({
      root: '/a/\u001b[31mevil',
      name: 'x\u0000y',
      pid: -1,
    });
    expect(hostile).toEqual({ root: '/a/[31mevil', name: 'xy', pid: 0 });
  });

  it('caps an over-long root instead of printing megabytes', () => {
    const parsed = parseIdentity({ root: `/a/${'x'.repeat(5000)}` });
    expect(parsed?.root.length).toBe(513);
    expect(parsed?.root.endsWith('…')).toBe(true);
  });

  it('rejects a root that is nothing but control characters', () => {
    expect(parseIdentity({ root: '\u0001\u0000' })).toBeNull();
  });

  it('derives a missing name from the root and defaults pid to 0', () => {
    expect(parseIdentity({ root: '/a/charuy' })).toEqual({
      root: '/a/charuy',
      name: 'charuy',
      pid: 0,
    });
  });
});

describe('normalizePort', () => {
  it('accepts an in-range integer from a number or a string', () => {
    expect(normalizePort(4322)).toBe(4322);
    expect(normalizePort('4322')).toBe(4322);
  });

  it('falls back on a non-numeric PORT rather than yielding NaN', () => {
    expect(normalizePort('abc')).toBe(DEFAULT_PORT);
    expect(normalizePort(undefined)).toBe(DEFAULT_PORT);
  });

  it('falls back on out-of-range and non-integer ports', () => {
    expect(normalizePort(0)).toBe(DEFAULT_PORT);
    expect(normalizePort(-1)).toBe(DEFAULT_PORT);
    expect(normalizePort(MAX_PORT + 1)).toBe(DEFAULT_PORT);
    expect(normalizePort(4321.5)).toBe(DEFAULT_PORT);
  });

  it('honors an explicit fallback', () => {
    expect(normalizePort('abc', 9999)).toBe(9999);
  });

  it('isValidPort rejects the boundaries the socket layer rejects', () => {
    expect(isValidPort(1)).toBe(true);
    expect(isValidPort(MAX_PORT)).toBe(true);
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(MAX_PORT + 1)).toBe(false);
    expect(isValidPort('4321')).toBe(false);
  });
});

describe('planPort', () => {
  const root = '/a/noldor';

  it('clamps the scan at the top of the port space instead of probing 65536', async () => {
    const probed: number[] = [];
    await expect(
      planPort({
        desired: MAX_PORT - 1,
        host: HOST,
        root,
        maxTries: 5,
        probe: async (_h, port) => {
          probed.push(port);
          return { kind: 'foreign' };
        },
      }),
    ).rejects.toThrow(`no free dashboard port in ${MAX_PORT - 1}..${MAX_PORT}`);
    expect(probed).toEqual([MAX_PORT - 1, MAX_PORT]);
  });

  it('falls back to the default port when the desired one is not a port', async () => {
    const plan = await planPort({
      desired: Number('abc'),
      host: HOST,
      root,
      probe: async () => ({ kind: 'free' }),
    });
    expect(plan).toMatchObject({ action: 'bind', port: DEFAULT_PORT });
  });

  it('binds the desired port when nothing is listening', async () => {
    const plan = await planPort({
      desired: 4321,
      host: HOST,
      root,
      probe: async () => ({ kind: 'free' }),
    });
    expect(plan).toEqual({ action: 'bind', port: 4321, skipped: [] });
  });

  it('reuses the desired port when this project already serves it', async () => {
    const plan = await planPort({
      desired: 4321,
      host: HOST,
      root,
      probe: async () => dashboardAt(root),
    });
    expect(plan).toMatchObject({ action: 'reuse', port: 4321 });
  });

  it('moves to the next free port when another project owns the desired one', async () => {
    const plan = await planPort({
      desired: 4321,
      host: HOST,
      root,
      probe: async (_h, port) => (port === 4321 ? dashboardAt('/a/charuy') : { kind: 'free' }),
    });
    expect(plan.action).toBe('bind');
    expect(plan.port).toBe(4322);
    expect(plan.skipped).toEqual([{ port: 4321, probe: dashboardAt('/a/charuy') }]);
  });

  it('reuses this project across a foreign occupant on the desired port', async () => {
    const plan = await planPort({
      desired: 4321,
      host: HOST,
      root,
      probe: async (_h, port) => (port === 4321 ? { kind: 'foreign' } : dashboardAt(root)),
    });
    expect(plan).toMatchObject({ action: 'reuse', port: 4322 });
  });

  it('treats an identity-less dashboard as foreign rather than reusing it', async () => {
    const plan = await planPort({
      desired: 4321,
      host: HOST,
      root,
      probe: async (_h, port) =>
        port === 4321 ? { kind: 'legacy-dashboard' } : ({ kind: 'free' } as PortProbe),
    });
    expect(plan).toMatchObject({ action: 'bind', port: 4322 });
  });

  it('throws with the occupants listed when the whole range is taken', async () => {
    await expect(
      planPort({
        desired: 4321,
        host: HOST,
        root,
        maxTries: 2,
        probe: async () => ({ kind: 'foreign' }),
      }),
    ).rejects.toThrow(/no free dashboard port in 4321\.\.4322/);
  });
});

describe('findMyDashboard', () => {
  const root = '/a/noldor';

  it('keeps scanning past a free port, unlike planPort', async () => {
    const probe = async (_h: string, port: number): Promise<PortProbe> =>
      port === 4323 ? dashboardAt(root) : { kind: 'free' };
    // planPort stops at the first free port and would never see 4323.
    await expect(planPort({ desired: 4321, host: HOST, root, probe })).resolves.toMatchObject({
      action: 'bind',
      port: 4321,
    });
    await expect(
      findMyDashboard({ desired: 4321, host: HOST, root, probe }),
    ).resolves.toMatchObject({ port: 4323 });
  });

  it('records the occupied ports it passed over, but not the free ones', async () => {
    const found = await findMyDashboard({
      desired: 4321,
      host: HOST,
      root,
      probe: async (_h, port) => {
        if (port === 4321) return { kind: 'foreign' };
        if (port === 4322) return { kind: 'free' };
        return dashboardAt(root);
      },
    });
    expect(found?.port).toBe(4323);
    expect(found?.skipped).toEqual([{ port: 4321, probe: { kind: 'foreign' } }]);
  });

  it('returns null when no port in range serves this project', async () => {
    await expect(
      findMyDashboard({
        desired: 4321,
        host: HOST,
        root,
        maxTries: 3,
        probe: async () => dashboardAt('/a/charuy'),
      }),
    ).resolves.toBeNull();
  });
});

describe('mergeSkipped', () => {
  it('dedupes by port, keeps the later observation, and sorts', () => {
    expect(
      mergeSkipped(
        [{ port: 4322, probe: { kind: 'foreign' } }],
        [
          { port: 4322, probe: dashboardAt('/a/charuy') },
          { port: 4321, probe: { kind: 'legacy-dashboard' } },
        ],
      ),
    ).toEqual([
      { port: 4321, probe: { kind: 'legacy-dashboard' } },
      { port: 4322, probe: dashboardAt('/a/charuy') },
    ]);
  });
});

describe('describeProbe', () => {
  it('names the owning project and pid for a dashboard', () => {
    expect(
      describeProbe({ kind: 'dashboard', identity: { root: '/a/charuy', name: 'charuy', pid: 7 } }),
    ).toBe('charuy (/a/charuy, pid 7)');
  });

  it('joins skipped ports into one line', () => {
    expect(describeSkipped([{ port: 4321, probe: { kind: 'foreign' } }])).toBe(
      '4321 — a non-dashboard process',
    );
  });
});

describe('probePort against a live dashboard', () => {
  let server: Server;
  let port: number;

  it('reports free for a port nothing listens on', async () => {
    expect(await isPortListening(HOST, 1, 200)).toBe(false);
    expect(await probePort(HOST, 1, 200)).toEqual({ kind: 'free' });
  });

  it('answers false for an out-of-range port instead of throwing ERR_SOCKET_BAD_PORT', async () => {
    await expect(isPortListening(HOST, MAX_PORT + 1, 200)).resolves.toBe(false);
    await expect(probePort(HOST, MAX_PORT + 1, 200)).resolves.toEqual({ kind: 'free' });
  });

  it('reports this repo as the owner of a running dashboard', async () => {
    ({ server } = await startServer({ port: 0, host: HOST }));
    port = (server.address() as AddressInfo).port;
    try {
      const result = await probePort(HOST, port);
      expect(result.kind).toBe('dashboard');
      if (result.kind !== 'dashboard') return;
      expect(sameProject(result.identity.root, resolveMainRoot())).toBe(true);
      expect(result.identity.pid).toBe(process.pid);
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }
  });
});
