import { describe, it, expect } from 'vitest';
import { waitForHttp200 } from '../health.js';

describe('waitForHttp200', () => {
  it('resolves true when fetch reaches 200 before deadline', async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      if (n < 2) throw new Error('refused');
      return { status: 200 } as Response;
    }) as unknown as typeof fetch;
    const ok = await waitForHttp200('http://127.0.0.1:5174/', Date.now() + 2000, fetchImpl);
    expect(ok).toBe(true);
  });
  it('resolves false after the deadline with no 200', async () => {
    const fetchImpl = (async () => ({ status: 500 }) as Response) as unknown as typeof fetch;
    const ok = await waitForHttp200('http://127.0.0.1:5174/', Date.now() + 300, fetchImpl);
    expect(ok).toBe(false);
  });
});
