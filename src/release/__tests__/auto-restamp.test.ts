// @tests: noldor
import { describe, it, expect, vi } from 'vitest';
import { autoStampOnCleanDetect } from '../auto-restamp';

describe('autoStampOnCleanDetect', () => {
  it('stamps the receipt when detect exits 0 with empty findings', async () => {
    const runDetect = vi.fn().mockResolvedValue({ exitCode: 0, findings: [] });
    const stamp = vi.fn();
    const log = vi.fn();
    await autoStampOnCleanDetect({ cwd: '/tmp/repo', runDetect, stamp, log });
    expect(stamp).toHaveBeenCalledOnce();
    expect(stamp).toHaveBeenCalledWith({ cwd: '/tmp/repo' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('auto-stamped'));
  });

  it('does NOT stamp when detect surfaces findings', async () => {
    const runDetect = vi.fn().mockResolvedValue({
      exitCode: 0,
      findings: [{ kind: 'stale-plan' }],
    });
    const stamp = vi.fn();
    const log = vi.fn();
    await autoStampOnCleanDetect({ cwd: '/tmp/repo', runDetect, stamp, log });
    expect(stamp).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('NOT auto-stamped'));
  });

  it('does NOT stamp on detect subprocess error', async () => {
    const runDetect = vi.fn().mockResolvedValue({ exitCode: 2, findings: [] });
    const stamp = vi.fn();
    const log = vi.fn();
    await autoStampOnCleanDetect({ cwd: '/tmp/repo', runDetect, stamp, log });
    expect(stamp).not.toHaveBeenCalled();
  });

  it('does NOT throw if stamp throws — release should fail loud at ensureGardenFresh, not here', async () => {
    const runDetect = vi.fn().mockResolvedValue({ exitCode: 0, findings: [] });
    const stamp = vi.fn().mockImplementation(() => {
      throw new Error('disk full');
    });
    const log = vi.fn();
    await expect(
      autoStampOnCleanDetect({ cwd: '/tmp/repo', runDetect, stamp, log }),
    ).resolves.not.toThrow();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('stamp failed'));
  });
});
