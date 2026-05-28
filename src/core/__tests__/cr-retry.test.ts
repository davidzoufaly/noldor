import { describe, expect, it, vi } from 'vitest';

import { runCrRetryLoop, type CodexRunFn, type AddressFindingsFn } from '../cr-retry.js';

describe('runCrRetryLoop', () => {
  it('returns clean after pass 1 when no findings', async () => {
    const codex: CodexRunFn = vi.fn(async () => ({
      tipSha: 'aaa',
      findings: [],
    }));
    const address: AddressFindingsFn = vi.fn();
    const result = await runCrRetryLoop({ codex, address, maxRetries: 3 });
    expect(result.status).toBe('clean');
    expect(result.passes).toHaveLength(1);
    expect(result.passes[0].findings).toBe(0);
    expect(address).not.toHaveBeenCalled();
  });

  it('returns clean after pass 2 when first has findings, second is clean', async () => {
    let pass = 0;
    const codex: CodexRunFn = vi.fn(async () => {
      pass++;
      if (pass === 1) return { tipSha: 'aaa', findings: [{ file: 'x.ts', message: 'oops' }] };
      return { tipSha: 'bbb', findings: [] };
    });
    const address: AddressFindingsFn = vi.fn(async () => undefined);
    const result = await runCrRetryLoop({ codex, address, maxRetries: 3 });
    expect(result.status).toBe('clean');
    expect(result.passes).toHaveLength(2);
    expect(result.passes[0]).toMatchObject({ findings: 1, status: 'addressed', tipSha: 'aaa' });
    expect(result.passes[1]).toMatchObject({ findings: 0, status: 'clean', tipSha: 'bbb' });
    expect(address).toHaveBeenCalledTimes(1);
  });

  it('returns exhausted after maxRetries when findings persist', async () => {
    const codex: CodexRunFn = vi.fn(async () => ({
      tipSha: 'aaa',
      findings: [{ file: 'x.ts', message: 'persistent' }],
    }));
    const address: AddressFindingsFn = vi.fn(async () => undefined);
    const result = await runCrRetryLoop({ codex, address, maxRetries: 3 });
    expect(result.status).toBe('exhausted');
    expect(result.passes).toHaveLength(3);
    expect(address).toHaveBeenCalledTimes(2);
  });
});
