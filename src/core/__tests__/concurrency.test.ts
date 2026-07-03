// @tests: parallel-agent-dispatch-for-research-jobs
import { describe, expect, it } from 'vitest';
import { runWithConcurrency } from '../concurrency';

describe('runWithConcurrency', () => {
  it('processes every item exactly once', async () => {
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item);
    });
    expect(seen.toSorted()).toEqual([1, 2, 3, 4, 5]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(1); // it actually ran in parallel
  });

  it('resolves immediately on empty input', async () => {
    let called = false;
    await runWithConcurrency([], 4, async () => {
      called = true;
    });
    expect(called).toBe(false);
  });

  it('passes the item index through', async () => {
    const pairs: Array<[string, number]> = [];
    await runWithConcurrency(['a', 'b'], 1, async (item, index) => {
      pairs.push([item, index]);
    });
    expect(pairs).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });
});
