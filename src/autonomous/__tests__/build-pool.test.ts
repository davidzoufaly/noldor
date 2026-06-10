import { describe, expect, it, vi } from 'vitest';
import { runDrain, type DrainDeps, type DrainOpts } from '../drain-loop.js';
import type { DrainSource } from '../drain-source.js';

/**
 * K>1 harness: `spawnGate` OPENS a PR (open-only — does not ship); the coordinator's `mergePr`
 * is what ships (mutates the fake roadmap). Tracks builder peak and merge peak separately so a
 * test can assert builds fan out (≤ K) while merges serialize (peak 1).
 */
function poolHarness(initial: string[], concurrency: number) {
  let roadmap = [...initial];
  let building = 0;
  let buildPeak = 0;
  let merging = 0;
  let mergePeak = 0;
  const assignedSlugs: string[] = [];
  const built = new Set<string>(); // slugs whose child has opened a PR (false pre-spawn, true post-spawn)
  const source: DrainSource = {
    id: 'roadmap',
    nextItem: (skip) => {
      const slug = roadmap.find((s) => !skip.has(s));
      return slug === undefined ? null : { slug, description: 'x', eligible: true };
    },
    parseAll: () => [...roadmap],
    gatePrompt: () => '/gate',
    branchFor: (s) => `fast/${s}`,
  };
  const spawnGate = vi.fn(async (env: Record<string, string>) => {
    const slug = env.NOLDOR_DRAIN_SLUG!;
    assignedSlugs.push(slug);
    building += 1;
    buildPeak = Math.max(buildPeak, building);
    await new Promise((r) => setTimeout(r, 5));
    building -= 1;
    built.add(slug); // child opened a PR; did NOT ship (open-only)
    return 0;
  });
  const deps: DrainDeps = {
    source,
    spawnGate,
    syncMainCleanState: vi.fn(), // coordinator calls this after each merge (no-op here; mergePr mutates roadmap)
    mergePr: vi.fn(async (slug: string) => {
      merging += 1;
      mergePeak = Math.max(mergePeak, merging);
      await new Promise((r) => setTimeout(r, 3));
      merging -= 1;
      roadmap = roadmap.filter((s) => s !== slug); // server-side squash; oracle reads it post-advance
      return 'merged' as const;
    }),
    // false pre-spawn (no prior PR → build it), true post-spawn (child opened a PR → coordinator merges).
    openPrExistsFor: vi.fn((slug: string) => built.has(slug)),
    writeState: vi.fn(),
    stopRequested: vi.fn(() => false),
  };
  const opts: DrainOpts = {
    maxFeatures: 20,
    maxRetries: 2,
    maxSpawns: 40,
    timeoutMs: 1000,
    dryRun: false,
    cwd: '/x',
    concurrency,
    startupStaggerMs: 0,
  };
  return {
    deps,
    opts,
    get buildPeak() {
      return buildPeak;
    },
    get mergePeak() {
      return mergePeak;
    },
    assignedSlugs,
  };
}

describe('build pool + coordinator (K>1)', () => {
  it('keeps at most K builders in flight and ships all', async () => {
    const h = poolHarness(['a', 'b', 'c', 'd', 'e'], 3);
    const r = await runDrain(h.deps, h.opts);
    expect(r.shipped).toBe(5);
    expect(r.skipped).toEqual([]); // catches an awaiting-merge slug wrongly re-selected + skipped
    expect(h.buildPeak).toBeLessThanOrEqual(3);
    expect(h.buildPeak).toBeGreaterThan(1); // genuinely parallel builds
  });

  it('assigns each child its exact slug via NOLDOR_DRAIN_SLUG', async () => {
    const h = poolHarness(['a', 'b', 'c'], 3);
    await runDrain(h.deps, h.opts);
    expect([...h.assignedSlugs].sort()).toEqual(['a', 'b', 'c']);
  });

  it('serializes merges (merge peak 1) even with K=3 builders', async () => {
    const h = poolHarness(['a', 'b', 'c'], 3);
    await runDrain(h.deps, h.opts);
    expect(h.mergePeak).toBe(1);
  });

  it('maxFeatures counts awaiting-merge: never ships OR builds more than the cap', async () => {
    // 5 queued, K=3, cap 2 → exactly 2 ship AND only 2 builds ever dispatched: dispatched counts
    // against the cap, so no third child is spawned while a/b await merge.
    const h = poolHarness(['a', 'b', 'c', 'd', 'e'], 3);
    const r = await runDrain(h.deps, { ...h.opts, maxFeatures: 2 });
    expect(r.shipped).toBe(2);
    expect(h.assignedSlugs.length).toBe(2); // no over-dispatch past the cap
  });

  it('heartbeat reports >1 in-flight builder under concurrency', async () => {
    const h = poolHarness(['a', 'b', 'c', 'd', 'e'], 3);
    const seenInFlight: number[] = [];
    h.deps.writeState = vi.fn((s) => seenInFlight.push(s.inFlight.length));
    await runDrain(h.deps, h.opts);
    expect(Math.max(...seenInFlight)).toBeGreaterThan(1); // genuinely concurrent builders observed
  });

  it('stop after first build halts NEW scheduling, drains in-flight, exits 130', async () => {
    let stopped = false;
    const h = poolHarness(['a', 'b', 'c', 'd', 'e'], 2); // 5 queued, K=2
    h.deps.stopRequested = vi.fn(() => stopped);
    // Flip stop the instant the first builder resolves — so at most the 2 already in-flight run.
    const orig = h.deps.spawnGate;
    let n = 0;
    h.deps.spawnGate = vi.fn(async (env: Record<string, string>) => {
      const r = await orig(env, 1000, '/gate');
      if (++n === 1) stopped = true;
      return r;
    });
    const r = await runDrain(h.deps, h.opts);
    expect(r.exitCode).toBe(130); // stop wins over the 0 "drained" exit
    expect(h.assignedSlugs.length).toBeLessThanOrEqual(2); // c/d/e never started — no new scheduling
    expect(r.shipped).toBe(h.assignedSlugs.length); // in-flight builds drained through the coordinator
  });
});
