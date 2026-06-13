import { describe, it, expect, vi } from 'vitest';
import { upWorktree } from '../up-worktree.js';

function deps(overrides = {}) {
  return {
    createWorktreeImpl: vi.fn(async () => ({
      path: '/repo/.worktrees/foo',
      branch: 'feat/foo',
      port: 5174,
      installWarning: null,
    })),
    existsImpl: vi.fn(() => false),
    readPortImpl: vi.fn(async () => 5174),
    openEditorImpl: vi.fn(async () => ({ opened: true })),
    launchTreeImpl: vi.fn(async () => {}),
    bootDevSurfacesImpl: vi.fn(async () => [
      { name: 'web', port: 5174, url: 'http://127.0.0.1:5174/', pid: 9, ready: true },
    ]),
    loadDevConfigImpl: () => ({
      editor: { command: 'code {path}' },
      surfaces: { web: { command: 'x', healthPath: '/', readyTimeoutMs: 1, portOffset: 0 } },
    }),
    readTemplateImpl: async () => 'tmpl',
    ...overrides,
  };
}

describe('upWorktree', () => {
  it('runs every step by default and returns a summary', async () => {
    const d = deps();
    const r = await upWorktree({ slug: 'foo', cwd: '/repo' }, d as never);
    expect(d.createWorktreeImpl).toHaveBeenCalled();
    expect(d.openEditorImpl).toHaveBeenCalled();
    expect(d.launchTreeImpl).toHaveBeenCalled();
    expect(d.bootDevSurfacesImpl).toHaveBeenCalled();
    expect(r.surfaces[0]!.ready).toBe(true);
  });
  it('honours --no-* flags', async () => {
    const d = deps();
    await upWorktree(
      {
        slug: 'foo',
        cwd: '/repo',
        noCreate: true,
        noEditor: true,
        noTerminal: true,
        noServers: true,
      },
      d as never,
    );
    expect(d.createWorktreeImpl).not.toHaveBeenCalled();
    expect(d.openEditorImpl).not.toHaveBeenCalled();
    expect(d.launchTreeImpl).not.toHaveBeenCalled();
    expect(d.bootDevSurfacesImpl).not.toHaveBeenCalled();
  });
  it('reuses an existing worktree instead of creating', async () => {
    const d = deps({ existsImpl: vi.fn(() => true) });
    await upWorktree({ slug: 'foo', cwd: '/repo' }, d as never);
    expect(d.createWorktreeImpl).not.toHaveBeenCalled();
    expect(d.bootDevSurfacesImpl).toHaveBeenCalled();
  });
});
