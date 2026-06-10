import { describe, expect, it, vi } from 'vitest';
import { runDrain, type DrainDeps, type DrainOpts } from '../drain-loop.js';
import type { DrainSource } from '../drain-source.js';

/**
 * Locks the K>1 coordinator's conflict/timeout contract (the loop itself shipped in Task 4 against an
 * injected `mergePr`): a non-`merged` outcome skips that slug with a reason + leaves its PR open, while
 * the other slugs still ship. `badOn` maps a slug → the non-merged outcome its merge returns.
 */
function coordHarness(
  initial: string[],
  badOn: Record<string, 'merge-conflict' | 'merge-timeout'> = {},
) {
  let roadmap = [...initial];
  const built = new Set<string>();
  const source: DrainSource = {
    id: 'roadmap',
    nextItem: (skip) => {
      const slug = roadmap.find((s) => !skip.has(s));
      return slug === undefined ? null : { slug, description: '', eligible: true };
    },
    parseAll: () => [...roadmap],
    gatePrompt: () => '/gate',
    branchFor: (s) => `fast/${s}`,
  };
  const deps: DrainDeps = {
    source,
    spawnGate: vi.fn(async (env: Record<string, string>) => {
      built.add(env.NOLDOR_DRAIN_SLUG!); // child opened a PR (open-only)
      return 0;
    }),
    syncMainCleanState: vi.fn(),
    mergePr: vi.fn(async (slug: string) => {
      if (badOn[slug]) return badOn[slug];
      roadmap = roadmap.filter((s) => s !== slug);
      return 'merged' as const;
    }),
    openPrExistsFor: vi.fn((slug: string) => built.has(slug)),
    writeState: vi.fn(),
    stopRequested: vi.fn(() => false),
  };
  const opts: DrainOpts = {
    maxFeatures: 20,
    maxRetries: 0,
    maxSpawns: 40,
    timeoutMs: 1000,
    dryRun: false,
    cwd: '/x',
    concurrency: 3,
    startupStaggerMs: 0,
  };
  return { deps, opts };
}

describe('merge coordinator contract', () => {
  it('a merge-conflict slug is skipped (PR left open), others still ship', async () => {
    const h = coordHarness(['a', 'b', 'c'], { b: 'merge-conflict' });
    const r = await runDrain(h.deps, h.opts);
    expect(r.shipped).toBe(2);
    expect(r.skipped).toContain('b');
    expect(r.skipReasons?.b).toMatch(/conflict/i);
  });

  it('a merge-timeout slug is skipped with a timeout reason, others still ship', async () => {
    const h = coordHarness(['a', 'b', 'c'], { b: 'merge-timeout' });
    const r = await runDrain(h.deps, h.opts);
    expect(r.shipped).toBe(2);
    expect(r.skipped).toContain('b');
    expect(r.skipReasons?.b).toMatch(/timeout/i);
  });
});
