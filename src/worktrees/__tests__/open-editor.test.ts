// @tests: de-superpowers-vendor-spec-plan-and-worktree-flows
import { describe, it, expect, vi } from 'vitest';
import { openEditor } from '../open-editor.js';

describe('openEditor', () => {
  it('returns opened:false and spawns nothing when command undefined', async () => {
    const spawnImpl = vi.fn();
    const r = await openEditor('/tmp/wt', undefined, spawnImpl as never);
    expect(r.opened).toBe(false);
    expect(spawnImpl).not.toHaveBeenCalled();
  });
  it('substitutes {path} and spawns detached', async () => {
    const unref = vi.fn();
    const spawnImpl = vi.fn(() => ({ unref }));
    const r = await openEditor('/tmp/wt', 'code {path}', spawnImpl as never);
    expect(r.opened).toBe(true);
    expect(spawnImpl).toHaveBeenCalledWith(
      '/bin/sh',
      ['-c', 'code /tmp/wt'],
      expect.objectContaining({ detached: true }),
    );
    expect(unref).toHaveBeenCalled();
  });
});
