// @tests: de-superpowers-vendor-spec-plan-and-worktree-flows
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

/** The summary every step-taken run produces, as an independent literal. */
const FULL_SUMMARY = {
  treePath: '/repo/.worktrees/foo',
  basePort: 5174,
  editorOpened: true,
  terminalSpawned: true,
  surfaces: [{ name: 'web', port: 5174, url: 'http://127.0.0.1:5174/', pid: 9, ready: true }],
};

describe('upWorktree', () => {
  it('runs every step by default and returns a summary', async () => {
    const d = deps();
    const r = await upWorktree({ slug: 'foo', cwd: '/repo' }, d as never);
    // The whole summary, not just `surfaces[0].ready` — that lone field is echo
    // of what `bootDevSurfacesImpl` was told to return, and left `editorOpened`
    // / `terminalSpawned` unpinned, so a run that skipped both stayed green.
    expect(r).toEqual(FULL_SUMMARY);
    expect(d.createWorktreeImpl).toHaveBeenCalled();
    expect(d.openEditorImpl).toHaveBeenCalled();
    expect(d.launchTreeImpl).toHaveBeenCalled();
    expect(d.bootDevSurfacesImpl).toHaveBeenCalled();
  });
  it('honours --no-* flags', async () => {
    const d = deps();
    const r = await upWorktree(
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
    // The summary is the observable contract: every skippable step reports as
    // not-taken. The call assertions below only corroborate that no seam ran.
    expect(r).toEqual({
      treePath: '/repo/.worktrees/foo',
      basePort: 5174,
      editorOpened: false,
      terminalSpawned: false,
      surfaces: [],
    });
    expect(d.createWorktreeImpl).not.toHaveBeenCalled();
    expect(d.openEditorImpl).not.toHaveBeenCalled();
    expect(d.launchTreeImpl).not.toHaveBeenCalled();
    expect(d.bootDevSurfacesImpl).not.toHaveBeenCalled();
  });
  it('reuses an existing worktree instead of creating', async () => {
    const d = deps({ existsImpl: vi.fn(() => true) });
    const r = await upWorktree({ slug: 'foo', cwd: '/repo' }, d as never);
    // Reuse is invisible in the summary — an existing tree yields the same
    // shape a fresh one does — so the full summary pins "every other step still
    // ran" and the call assertion carries the reuse itself.
    expect(r).toEqual(FULL_SUMMARY);
    expect(d.createWorktreeImpl).not.toHaveBeenCalled();
  });
});
