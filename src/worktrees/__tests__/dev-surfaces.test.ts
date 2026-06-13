import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootDevSurfaces } from '../dev-surfaces.js';

function fakeChild(pid: number) {
  return { pid, unref: vi.fn() };
}

describe('bootDevSurfaces', () => {
  it('boots each surface on base+offset, substitutes vars, writes pids, never kills', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devsurf-'));
    const spawnImpl = vi.fn(() => fakeChild(4242));
    // URL-keyed (not call-count) so it's robust to concurrent boots: the first
    // touch of each url = occupancy pre-check → reject (free); later = 200.
    const seen = new Set<string>();
    const fetchImpl = (async (url: string) => {
      if (!seen.has(url)) {
        seen.add(url);
        throw new Error('free');
      }
      return { status: 200 } as Response;
    }) as unknown as typeof fetch;

    const booted = await bootDevSurfaces({
      treePath: '/tmp/wt',
      slug: 'demo',
      surfaces: {
        web: {
          command: 'pnpm dev --port {port}',
          healthPath: '/',
          readyTimeoutMs: 2000,
          portOffset: 0,
        },
        api: {
          command: 'serve {path} --port {port}',
          healthPath: '/health',
          readyTimeoutMs: 2000,
          portOffset: 100,
        },
      },
      basePort: 5174,
      cwd,
      spawnImpl: spawnImpl as never,
      fetchImpl,
    });

    const web = booted.find((b) => b.name === 'web')!;
    const api = booted.find((b) => b.name === 'api')!;
    expect(web.port).toBe(5174);
    expect(api.port).toBe(5274);
    expect(web.ready).toBe(true);
    expect(spawnImpl).toHaveBeenCalledWith(
      '/bin/sh',
      ['-c', 'serve /tmp/wt --port 5274'],
      expect.objectContaining({ cwd: '/tmp/wt', detached: true }),
    );
    // pids file written, no process.kill anywhere
    const pids = readFileSync(join(cwd, '.noldor', 'dev-demo.pids'), 'utf8');
    expect(pids).toMatch(/web 4242 5174/);
    expect(pids).toMatch(/api 4242 5274/);
  });

  it('fails a surface whose port is already occupied before boot', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devsurf-'));
    const spawnImpl = vi.fn(() => fakeChild(1));
    const fetchImpl = (async () => ({ status: 200 }) as Response) as unknown as typeof fetch;
    const booted = await bootDevSurfaces({
      treePath: '/tmp/wt',
      slug: 'demo',
      surfaces: {
        web: { command: 'x --port {port}', healthPath: '/', readyTimeoutMs: 500, portOffset: 0 },
      },
      basePort: 5174,
      cwd,
      spawnImpl: spawnImpl as never,
      fetchImpl,
    });
    expect(booted[0]!.ready).toBe(false);
    expect(spawnImpl).not.toHaveBeenCalled();
  });
});
