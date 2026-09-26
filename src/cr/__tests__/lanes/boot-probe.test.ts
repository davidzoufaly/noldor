// @tests: ui-design-review-lane
import { describe, expect, it } from 'vitest';

import type { VerifySurface } from '../../../core/consumer-config.js';
import { forEachBootedSurface, type BootProbeDeps } from '../../lanes/boot-probe.js';

interface Job {
  surface: string;
  recipe: { verifyCommand: string; route: string };
}
const job = (surface: string, verifyCommand = 'web'): Job => ({
  surface,
  recipe: { verifyCommand, route: `/${surface}` },
});
const server: VerifySurface = {
  command: 'dev --port {port}',
  kind: 'server',
  healthPath: '/',
  readyTimeoutMs: 1000,
};

interface Log {
  boots: number;
  kills: number;
  unreachable: string[];
  reached: string[];
}

function harness(over: Partial<BootProbeDeps> = {}): { log: Log; deps: BootProbeDeps } {
  const log: Log = { boots: 0, kills: 0, unreachable: [], reached: [] };
  const deps: BootProbeDeps = {
    resolvePort: async () => 4100,
    routeProbeBudgetMs: 100,
    boot: async (s, port) => {
      log.boots++;
      return {
        ok: true,
        url: `http://127.0.0.1:${port}/`,
        command: s.command,
        kill: () => {
          log.kills++;
        },
      };
    },
    fetchImpl: (async () => new Response('', { status: 200 })) as typeof fetch,
    ...over,
  };
  return { log, deps };
}

const walk = (
  jobs: Job[],
  { log, deps }: { log: Log; deps: BootProbeDeps },
  opts: { cmds?: Map<string, VerifySurface>; budgetMs?: number } = {},
): Promise<void> =>
  forEachBootedSurface({
    jobs,
    verifyCommands: opts.cmds ?? new Map([['web', server]]),
    repoRoot: '/repo',
    deps,
    ...(opts.budgetMs !== undefined ? { budgetMs: opts.budgetMs } : {}),
    unreachable: (j, reason, detail) => {
      log.unreachable.push(`${j.surface} ${reason}: ${detail}`);
    },
    reached: async (j, url) => {
      log.reached.push(`${j.surface} ${url}`);
    },
  });

describe('forEachBootedSurface', () => {
  it('boots once per verifyCommand group, reaches every route, and kills each boot', async () => {
    const h = harness();
    const cmds = new Map([
      ['web', server],
      ['api', server],
    ]);
    await walk([job('a'), job('b'), job('c', 'api')], h, { cmds });
    expect(h.log.boots).toBe(2);
    expect(h.log.kills).toBe(2);
    expect(h.log.reached).toEqual([
      'a http://127.0.0.1:4100/a',
      'b http://127.0.0.1:4100/b',
      'c http://127.0.0.1:4100/c',
    ]);
  });

  it('fails a group whose verifyCommand is missing without booting it', async () => {
    const h = harness();
    await walk([job('a', 'api')], h);
    expect(h.log.boots).toBe(0);
    expect(h.log.unreachable).toEqual([
      "a boot-failed: verifyCommand 'api' is missing from consumer.verifyCommands",
    ]);
  });

  it('fails every surface of a group whose boot fails', async () => {
    const h = harness({
      boot: async (s) => ({
        ok: false,
        url: 'u',
        command: s.command,
        observed: 'no 200 in 1000ms',
      }),
    });
    await walk([job('a'), job('b')], h);
    expect(h.log.unreachable).toEqual([
      'a boot-failed: no 200 in 1000ms',
      'b boot-failed: no 200 in 1000ms',
    ]);
    expect(h.log.kills).toBe(0);
  });

  it('refuses to boot once the round budget is spent', async () => {
    const h = harness();
    await walk([job('a')], h, { budgetMs: 0 });
    expect(h.log.boots).toBe(0);
    expect(h.log.unreachable).toEqual([
      'a boot-failed: round budget (0ms) exhausted before this group booted',
    ]);
  });

  it('retries a cold route that does not answer yet, within routeProbeBudgetMs', async () => {
    let calls = 0;
    const h = harness({
      routeProbeBudgetMs: 2000,
      fetchImpl: (async () => {
        calls++;
        if (calls < 3) throw new Error('ECONNREFUSED');
        return new Response('', { status: 200 });
      }) as typeof fetch,
    });
    await walk([job('a')], h);
    expect(calls).toBe(3);
    expect(h.log.reached).toEqual(['a http://127.0.0.1:4100/a']);
  });

  it('declines a non-2xx route and still kills the boot', async () => {
    const h = harness({
      fetchImpl: (async () => new Response('', { status: 404 })) as typeof fetch,
    });
    await walk([job('a')], h);
    expect(h.log.unreachable).toEqual([
      'a route-unreachable: GET http://127.0.0.1:4100/a → 404 (want 2xx)',
    ]);
    expect(h.log.kills).toBe(1);
  });

  it('declines a route that never answers within the probe budget', async () => {
    const h = harness({
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch,
    });
    await walk([job('a')], h);
    expect(h.log.unreachable).toEqual([
      'a route-unreachable: GET http://127.0.0.1:4100/a got no response within 100ms: ECONNREFUSED',
    ]);
  });

  it('kills the boot even when the per-surface callback throws', async () => {
    const h = harness();
    await expect(
      forEachBootedSurface({
        jobs: [job('a')],
        verifyCommands: new Map([['web', server]]),
        repoRoot: '/repo',
        deps: h.deps,
        unreachable: () => {},
        reached: async () => {
          throw new Error('boom');
        },
      }),
    ).rejects.toThrow('boom');
    expect(h.log.kills).toBe(1);
  });
});
