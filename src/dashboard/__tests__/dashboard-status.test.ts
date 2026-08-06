// @tests: project-tracking-dashboard
import { describe, expect, it } from 'vitest';

import { formatStatus, scanPorts } from '../status.js';

import type { PortProbe, DashboardIdentity } from '../identity.js';

const HOST = '127.0.0.1';

function dash(root: string, name: string): PortProbe {
  const identity: DashboardIdentity = { root, name, pid: 42 };
  return { kind: 'dashboard', identity };
}

describe('scanPorts', () => {
  it('omits free ports and flags the one this project owns', async () => {
    const statuses = await scanPorts({
      from: 4321,
      count: 3,
      host: HOST,
      root: '/a/noldor',
      probe: async (_h, port) => {
        if (port === 4321) return dash('/a/charuy', 'charuy');
        if (port === 4322) return dash('/a/noldor', 'noldor');
        return { kind: 'free' };
      },
    });
    expect(statuses.map((s) => [s.port, s.mine])).toEqual([
      [4321, false],
      [4322, true],
    ]);
  });

  it('returns nothing when the whole range is free', async () => {
    const statuses = await scanPorts({
      from: 4321,
      count: 2,
      host: HOST,
      root: '/a/noldor',
      probe: async () => ({ kind: 'free' }),
    });
    expect(statuses).toEqual([]);
  });

  it('clamps a wide scan at the top of the port space', async () => {
    const probed: number[] = [];
    await scanPorts({
      from: 65534,
      count: 10,
      host: HOST,
      root: '/a/noldor',
      probe: async (_h, port) => {
        probed.push(port);
        return { kind: 'free' };
      },
    });
    expect(probed).toEqual([65534, 65535]);
  });

  it('never claims ownership of an identity-less dashboard', async () => {
    const statuses = await scanPorts({
      from: 4321,
      count: 1,
      host: HOST,
      root: '/a/noldor',
      probe: async () => ({ kind: 'legacy-dashboard' }),
    });
    expect(statuses).toEqual([{ port: 4321, probe: { kind: 'legacy-dashboard' }, mine: false }]);
  });
});

describe('formatStatus', () => {
  it('leads with this project running and marks its row', () => {
    const out = formatStatus(
      [
        { port: 4321, probe: dash('/a/charuy', 'charuy'), mine: false },
        { port: 4322, probe: dash('/a/noldor', 'noldor'), mine: true },
      ],
      HOST,
      '/a/noldor',
    );
    expect(out).toContain('this project (/a/noldor) → http://127.0.0.1:4322');
    expect(out).toContain('4321 — charuy (/a/charuy, pid 42)');
    expect(out).toContain('← this project');
  });

  it('says not running when no scanned port belongs to this project', () => {
    const out = formatStatus(
      [{ port: 4321, probe: dash('/a/charuy', 'charuy'), mine: false }],
      HOST,
      '/a/noldor',
    );
    expect(out).toContain('→ not running');
  });

  it('says nothing found on an empty scan', () => {
    expect(formatStatus([], HOST, '/a/noldor')).toContain('no dashboard found');
  });
});
