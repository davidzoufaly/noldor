// @tests: acceptance-verify-lane, agent-events-phase-tracking-run-ids-and-agents-dashboard-page, autonomous-queue-drain-runner, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox, drain-startup-reconciliation-of-a-prior-dead-run, parallel-drain, plan-runner
import { describe, expect, it, vi } from 'vitest';
import { runDrain } from '../drain-loop.js';
import type { DrainSource } from '../drain-source.js';

/**
 * Mutable-roadmap harness. The mock source's `nextItem(skip)` returns the live
 * list minus `skip` (so the loop's skip filter genuinely terminates it);
 * `parseAll()` returns the live list (the success oracle); a "shipping" spawn
 * removes the just-targeted slug (simulating a merged PR). Every test terminates
 * for the RIGHT reason — not via the maxSpawns backstop.
 */
function harness(
  initial: string[],
  opts: {
    ships?: (slug: string) => boolean;
    spawnImpl?: () => number;
    openPr?: () => boolean;
    mergedPr?: () => boolean;
    /** omit → dep absent entirely (pre-finish-mode behavior) */
    branchWork?: () => boolean;
    /** false → source offers no delivery-only prompt (e.g. plansSource) */
    finishPrompt?: boolean;
    /** omit → dep absent entirely */
    closedUnmergedPr?: () => boolean;
    stop?: () => boolean;
    eligibleFor?: (slug: string) => boolean;
    nextItemImpl?: (skip: ReadonlySet<string>) => ReturnType<DrainSource['nextItem']>;
    parseAllImpl?: () => string[];
  } = {},
) {
  let roadmap = [...initial];
  let lastTarget: string | null = null;
  const ships = opts.ships ?? (() => true);
  const eligibleFor = opts.eligibleFor ?? (() => true);
  const nextItem = vi.fn(
    opts.nextItemImpl ??
      ((skip: ReadonlySet<string>) => {
        lastTarget = roadmap.find((s) => !skip.has(s)) ?? null;
        if (lastTarget === null) return null;
        return { slug: lastTarget, description: 'x', eligible: eligibleFor(lastTarget) };
      }),
  );
  const spawnGate = vi.fn(
    async (
      _env: Record<string, string>,
      _timeoutMs: number,
      _prompt: string,
      _onSpawn?: (pgid: number) => void,
      _slug?: string,
    ) => {
      const code = (opts.spawnImpl ?? (() => 0))(); // may throw (timeout) → no removal
      if (lastTarget !== null && ships(lastTarget))
        roadmap = roadmap.filter((s) => s !== lastTarget);
      return code;
    },
  );
  const source: DrainSource = {
    id: 'roadmap',
    nextItem,
    parseAll: vi.fn(opts.parseAllImpl ?? (() => [...roadmap])),
    gatePrompt: (s) => `/gate ${s}`,
    ...(opts.finishPrompt === false ? {} : { finishPrompt: (s: string) => `/finish ${s}` }),
    branchFor: (s) => `fast/${s}`,
  };
  return {
    deps: {
      source,
      spawnGate,
      syncMainCleanState: vi.fn(),
      openPrExistsFor: vi.fn(opts.openPr ?? (() => false)),
      mergedPrExistsFor: vi.fn(opts.mergedPr ?? (() => false)),
      ...(opts.branchWork !== undefined ? { branchHasUnshippedWork: vi.fn(opts.branchWork) } : {}),
      ...(opts.closedUnmergedPr !== undefined
        ? { closedUnmergedPrExistsFor: vi.fn(opts.closedUnmergedPr) }
        : {}),
      mergePr: vi.fn(async () => 'merged' as const),
      writeState: vi.fn(),
      stopRequested: vi.fn(opts.stop ?? (() => false)),
    },
    spawnGate,
    nextItem,
  };
}
const opts = {
  maxFeatures: 20,
  maxRetries: 2,
  maxSpawns: 40,
  timeoutMs: 1000,
  dryRun: false,
  cwd: '/x',
  concurrency: 1,
  startupStaggerMs: 0,
};

describe('runDrain', () => {
  it('(a) ships entry a, skips entry b after maxRetries', async () => {
    const h = harness(['a', 'b'], { ships: (s) => s === 'a' });
    const r = await runDrain(h.deps, opts);
    expect(r.shipped).toBe(1);
    expect(r.skipped).toContain('b');
    expect(r.exitCode).toBe(0);
    expect(h.spawnGate).toHaveBeenCalledTimes(1 + (opts.maxRetries + 1)); // a once + b (1 + retries)
  });

  it('(b) aborts exit 1 when source.nextItem throws, surfacing the cause', async () => {
    const h = harness(['a'], {
      nextItemImpl: () => {
        throw new Error('parse boom');
      },
    });
    const r = await runDrain(h.deps, opts);
    expect(r.exitCode).toBe(1);
    expect(r.error).toContain('parse boom');
  });

  it('(c) child timeout → retry then skip', async () => {
    const h = harness(['a'], {
      spawnImpl: () => {
        throw new Error('iteration-timeout');
      },
    });
    const r = await runDrain(h.deps, { ...opts, maxRetries: 1 });
    expect(r.skipped).toContain('a');
  });

  it('(d) shipped entry leaves the roadmap → counts shipped, one spawn', async () => {
    const h = harness(['a'], { ships: () => true });
    const r = await runDrain(h.deps, opts);
    expect(r.shipped).toBe(1);
    expect(h.spawnGate).toHaveBeenCalledTimes(1);
  });

  it('(d2) fast-track-shipped slug still on roadmap but with a MERGED PR → counts shipped, never re-spawns (#11)', async () => {
    // ships:false → spawn would NOT remove the entry (mimics fast-track leaving it in place);
    // mergedPr:true → a merged fast/<slug> PR exists. The merged check is post-spawn only, so the
    // slug is built once this run and then RECOGNIZED as shipped at settle — the key property is that
    // it is NOT re-spawned on retry (without the fix each retry re-spawns ~170k tokens).
    const h = harness(['a'], { ships: () => false, mergedPr: () => true });
    const r = await runDrain(h.deps, opts);
    expect(r.shipped).toBe(1);
    expect(h.spawnGate).toHaveBeenCalledTimes(1); // built once, recognized at settle — no retry re-spawn
  });

  it('(d3) K>1: merged fast-track PR at settle → shipped, not handed to coordinator, no re-spawn (#11)', async () => {
    const h = harness(['a'], { ships: () => false, mergedPr: () => true });
    const r = await runDrain(h.deps, { ...opts, concurrency: 2, startupStaggerMs: 0 });
    expect(r.shipped).toBe(1);
    expect(h.spawnGate).toHaveBeenCalledTimes(1); // built once, recognized at settle
    expect(h.deps.mergePr).not.toHaveBeenCalled(); // never handed a merged PR to the coordinator
  });

  it('(e) dry-run never spawns', async () => {
    const h = harness(['a']);
    await runDrain(h.deps, { ...opts, dryRun: true });
    expect(h.spawnGate).not.toHaveBeenCalled();
  });

  it('(f) stop-signal at iteration top → exit 130', async () => {
    const h = harness(['a'], { stop: () => true });
    expect((await runDrain(h.deps, opts)).exitCode).toBe(130);
  });

  it('(g) out-of-scope entry skipped without spawning', async () => {
    const h = harness(['a'], { eligibleFor: () => false });
    await runDrain(h.deps, opts);
    expect(h.spawnGate).not.toHaveBeenCalled();
  });

  it('(i) post-spawn open PR → skip, no re-spawn', async () => {
    // Coupling: the loop consults openPrExistsFor exactly twice per spawned iteration —
    // call 0 = pre-spawn (false here), call 1 = post-spawn (true). If the loop ever adds
    // another consult, update this counter.
    let calls = 0;
    const h = harness(['a'], { ships: () => false, openPr: () => calls++ >= 1 });
    const r = await runDrain(h.deps, opts);
    expect(r.skipped).toContain('a');
    expect(h.spawnGate).toHaveBeenCalledTimes(1);
  });

  it('(j) pre-spawn open PR (restart) → skip without spawning', async () => {
    const h = harness(['a'], { openPr: () => true });
    await runDrain(h.deps, opts);
    expect(h.spawnGate).not.toHaveBeenCalled();
  });

  it('(k) openPrExistsFor gh failure → abort exit 1 (fail-closed)', async () => {
    const h = harness(['a'], {
      openPr: () => {
        throw new Error('gh offline');
      },
    });
    expect((await runDrain(h.deps, opts)).exitCode).toBe(1);
  });

  it('(l) parseAll failure (oracle read) → abort exit 1', async () => {
    const h = harness(['a'], {
      ships: () => false,
      parseAllImpl: () => {
        throw new Error('parse');
      },
    });
    expect((await runDrain(h.deps, opts)).exitCode).toBe(1);
  });

  it('(m) systemic spawn error (non-timeout) → abort exit 1, not retry-churn', async () => {
    const h = harness(['a', 'b'], {
      spawnImpl: () => {
        throw new Error('spawn-failed: claude ENOENT');
      },
    });
    const r = await runDrain(h.deps, opts);
    expect(r.exitCode).toBe(1);
    expect(h.spawnGate).toHaveBeenCalledTimes(1); // aborts on the first failure, no churn
  });

  it('passes the candidate slug to spawnGate (agent-event slug stamping)', async () => {
    const h = harness(['a']);
    await runDrain(h.deps, opts);
    expect(h.spawnGate).toHaveBeenCalledTimes(1);
    expect(h.spawnGate.mock.calls[0]![4]).toBe('a');
  });
});

describe('reason recording + salvage dep', () => {
  it('records retries-exhausted when a slug crosses maxRetries into skip', async () => {
    const h = harness(['a'], { ships: () => false });
    const res = await runDrain(h.deps, { ...opts, maxFeatures: 5, maxRetries: 1, maxSpawns: 10 });
    expect(res.skipped).toEqual(['a']);
    expect(res.skipReasons).toEqual({ a: 'retries-exhausted' });
  });

  it('records pr-open-unmerged on the K=1 verdict branch (PR opened, oracle still sees slug)', async () => {
    let spawned = false;
    const h = harness(['a'], {
      ships: () => false,
      openPr: () => spawned, // no PR pre-spawn; PR exists at verdict time
    });
    const inner = h.deps.spawnGate;
    h.deps.spawnGate = async (env: Record<string, string>, t: number, p: string) => {
      const code = await inner(env, t, p);
      spawned = true;
      return code;
    };
    const res = await runDrain(h.deps, { ...opts, maxFeatures: 5, maxSpawns: 10 });
    expect(res.skipped).toEqual(['a']);
    expect(res.skipReasons).toEqual({ a: 'pr-open-unmerged' });
  });

  it('records pr-open-unmerged on the restart-safety guard (open PR at pickup)', async () => {
    const h = harness(['a'], { openPr: () => true });
    const res = await runDrain(h.deps, { ...opts, maxFeatures: 5, maxSpawns: 10 });
    expect(h.deps.spawnGate).not.toHaveBeenCalled();
    expect(res.skipReasons).toEqual({ a: 'pr-open-unmerged' });
  });

  it('calls salvageStaleBase before each spawn and aborts the drain when it throws', async () => {
    const calls: string[] = [];
    const h1 = harness(['a']);
    const deps1 = {
      ...h1.deps,
      salvageStaleBase: (slug: string, branch: string) => {
        calls.push(`${slug}|${branch}`);
        return 'salvaged' as const;
      },
    };
    const res1 = await runDrain(deps1, { ...opts, maxFeatures: 5, maxSpawns: 10 });
    expect(res1.shipped).toBe(1);
    expect(calls).toEqual(['a|fast/a']);

    const h2 = harness(['b']);
    const deps2 = {
      ...h2.deps,
      salvageStaleBase: () => {
        throw new Error('gh exploded');
      },
    };
    const res2 = await runDrain(deps2, { ...opts, maxFeatures: 5, maxSpawns: 10 });
    expect(res2.exitCode).toBe(1);
    expect(res2.error).toBe('gh exploded');
  });

  it('does NOT call salvageStaleBase in dry-run', async () => {
    const salvage = vi.fn(() => 'clean' as const);
    const h = harness(['a']);
    const deps = { ...h.deps, salvageStaleBase: salvage };
    await runDrain(deps, { ...opts, maxFeatures: 5, maxSpawns: 10, dryRun: true });
    expect(salvage).not.toHaveBeenCalled();
  });
});

/**
 * Finish mode (Q-0073). A child that commits its work and then ends its turn without pushing —
 * classically by backgrounding the code-stage CR lane and reporting "waiting on the reviewer" —
 * leaves exit 0, no PR, and a branch ahead of `origin/main`. Pre-fix that read as a failed build
 * and every retry re-spawned a from-scratch rebuild (~13min / ~170k tokens each). It must now
 * re-spawn delivery-only instead.
 */
describe('finish mode: committed-but-undelivered work', () => {
  const promptsOf = (h: ReturnType<typeof harness>): string[] =>
    h.spawnGate.mock.calls.map((c) => c[2]);

  it('clean exit + no PR + branch ahead of main → retries are delivery-only, not rebuilds', async () => {
    const h = harness(['a'], { ships: () => false, branchWork: () => true });
    const res = await runDrain(h.deps, { ...opts, maxRetries: 2 });
    // 1 build + 2 finish attempts, then retries-exhausted.
    expect(promptsOf(h)).toEqual(['/gate a', '/finish a', '/finish a']);
    expect(res.skipReasons).toEqual({ a: 'retries-exhausted' });
  });

  it('marks the delivery-only re-spawn with NOLDOR_DRAIN_FINISH (env belt-and-suspenders)', async () => {
    const h = harness(['a'], { ships: () => false, branchWork: () => true });
    await runDrain(h.deps, { ...opts, maxRetries: 1 });
    expect(h.spawnGate.mock.calls[0]![0].NOLDOR_DRAIN_FINISH).toBeUndefined();
    expect(h.spawnGate.mock.calls[1]![0].NOLDOR_DRAIN_FINISH).toBe('1');
  });

  it('suppresses salvage on a finish re-spawn — repair would delete the commits being finished', async () => {
    const h = harness(['a'], { ships: () => false, branchWork: () => true });
    const salvage = vi.fn(() => 'clean' as const);
    await runDrain({ ...h.deps, salvageStaleBase: salvage }, { ...opts, maxRetries: 2 });
    expect(h.spawnGate).toHaveBeenCalledTimes(3);
    expect(salvage).toHaveBeenCalledTimes(1); // the initial build only
  });

  it('non-zero exit → NOT finishable (a genuinely failed build must be rebuilt)', async () => {
    const h = harness(['a'], { ships: () => false, branchWork: () => true, spawnImpl: () => 1 });
    await runDrain(h.deps, { ...opts, maxRetries: 2 });
    expect(promptsOf(h)).toEqual(['/gate a', '/gate a', '/gate a']);
  });

  it('branch level with origin/main → nothing was built, so rebuild as before', async () => {
    const h = harness(['a'], { ships: () => false, branchWork: () => false });
    await runDrain(h.deps, { ...opts, maxRetries: 1 });
    expect(promptsOf(h)).toEqual(['/gate a', '/gate a']);
  });

  it('dep absent → unchanged retry-from-scratch behavior', async () => {
    const h = harness(['a'], { ships: () => false });
    await runDrain(h.deps, { ...opts, maxRetries: 1 });
    expect(promptsOf(h)).toEqual(['/gate a', '/gate a']);
  });

  it('source without finishPrompt (plansSource) → dep never consulted, always rebuilds', async () => {
    const h = harness(['a'], {
      ships: () => false,
      branchWork: () => true,
      finishPrompt: false,
    });
    await runDrain(h.deps, { ...opts, maxRetries: 1 });
    expect(h.deps.branchHasUnshippedWork).not.toHaveBeenCalled();
    expect(promptsOf(h)).toEqual(['/gate a', '/gate a']);
  });

  it('an open PR at settle still wins over finish — never spawn against a live PR', async () => {
    let calls = 0;
    const h = harness(['a'], {
      ships: () => false,
      branchWork: () => true,
      openPr: () => calls++ >= 1, // false pre-spawn, true at settle
    });
    const res = await runDrain(h.deps, opts);
    expect(h.spawnGate).toHaveBeenCalledTimes(1);
    expect(res.skipReasons).toEqual({ a: 'pr-open-unmerged' });
  });

  it('membership un-sticks when the branch loses its commits between retries → back to rebuild', async () => {
    // A finish child that hard-resets or deletes the branch leaves nothing to deliver. Sticky
    // membership would keep telling the next child "do NOT re-implement" over an empty branch and
    // burn the remaining retries delivering nothing.
    let probes = 0;
    const h = harness(['a'], { ships: () => false, branchWork: () => probes++ === 0 });
    const salvage = vi.fn(() => 'clean' as const);
    await runDrain({ ...h.deps, salvageStaleBase: salvage }, { ...opts, maxRetries: 2 });
    expect(promptsOf(h)).toEqual(['/gate a', '/finish a', '/gate a']);
    expect(salvage).toHaveBeenCalledTimes(2); // suppressed for the finish spawn only
  });

  it('closed-unmerged PR on the branch → never finishable (a human rejected that work)', async () => {
    // Finish mode suppresses salvage, whose whole job is to rebuild a closed-unmerged base from
    // fresh main. Reusing the branch would re-deliver rejected commits with no clean room.
    const h = harness(['a'], {
      ships: () => false,
      branchWork: () => true,
      closedUnmergedPr: () => true,
    });
    await runDrain(h.deps, { ...opts, maxRetries: 1 });
    expect(promptsOf(h)).toEqual(['/gate a', '/gate a']);
  });

  it('a throwing branch probe excludes the slug instead of aborting the drain', async () => {
    // Both probes only DISqualify, so tool noise must degrade to a rebuild — never to exit 1.
    const h = harness(['a'], {
      ships: () => false,
      branchWork: () => {
        throw new Error('git offline');
      },
    });
    const res = await runDrain(h.deps, { ...opts, maxRetries: 1 });
    expect(res.exitCode).toBe(0);
    expect(promptsOf(h)).toEqual(['/gate a', '/gate a']);
  });

  it('a throwing closed-PR probe excludes the slug instead of aborting the drain', async () => {
    const h = harness(['a'], {
      ships: () => false,
      branchWork: () => true,
      closedUnmergedPr: () => {
        throw new Error('gh offline');
      },
    });
    const res = await runDrain(h.deps, { ...opts, maxRetries: 1 });
    expect(res.exitCode).toBe(0);
    expect(res.skipReasons).toEqual({ a: 'retries-exhausted' });
    expect(promptsOf(h)).toEqual(['/gate a', '/gate a']);
  });

  it('K>1: a post-open failure (non-zero exit, PR open) never becomes finishable', async () => {
    // The PR IS the delivery here; finish mode's premise ("ended without opening a PR") is false,
    // so the slug must stay on the rebuild path even though the branch is ahead of main.
    const h = harness(['a'], {
      ships: () => false,
      branchWork: () => true,
      openPr: () => true,
      spawnImpl: () => 1,
    });
    await runDrain(h.deps, { ...opts, maxRetries: 1, concurrency: 2, startupStaggerMs: 0 });
    // Pre-spawn open-PR guard skips it outright, so nothing spawns and nothing is marked finishable.
    expect(h.spawnGate).not.toHaveBeenCalled();
    expect(h.deps.branchHasUnshippedWork).not.toHaveBeenCalled();
  });

  it('per-entry timeout → rebuild, never finish (a child killed mid-flight may be half-done)', async () => {
    // Nothing on the branch separates "committed the whole entry then hung in CR" from "committed
    // half of it then died": the roadmap-retirement commit lands before implementation and the CR
    // receipt only after it. Promoting here would hand the next child "do NOT re-implement" over
    // partial work, with prose judgement as the only guard.
    const h = harness(['a'], {
      ships: () => false,
      branchWork: () => true,
      spawnImpl: () => {
        throw new Error('iteration-timeout');
      },
    });
    await runDrain(h.deps, { ...opts, maxRetries: 1 });
    expect(promptsOf(h)).toEqual(['/gate a', '/gate a']);
    expect(h.deps.branchHasUnshippedWork).not.toHaveBeenCalled();
  });

  it('K>1: clean exit with no PR + branch ahead → finish re-spawn, not rebuild', async () => {
    const h = harness(['a'], { ships: () => false, branchWork: () => true });
    await runDrain(h.deps, { ...opts, maxRetries: 1, concurrency: 2, startupStaggerMs: 0 });
    expect(promptsOf(h)).toEqual(['/gate a', '/finish a']);
    expect(h.deps.mergePr).not.toHaveBeenCalled(); // no PR was ever opened
  });
});
