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
        const visible = roadmap.filter((s) => !skip.has(s));
        lastTarget = visible[0] ?? null;
        if (lastTarget === null) return null;
        return { slug: lastTarget, description: 'x', eligible: eligibleFor(lastTarget) };
      }),
  );
  const spawnGate = vi.fn(
    async (_env: Record<string, string>, _timeoutMs: number, _prompt: string) => {
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
    gatePrompt: () => '/gate',
    branchFor: (s) => `fast/${s}`,
  };
  return {
    deps: {
      source,
      spawnGate,
      syncMainCleanState: vi.fn(),
      openPrExistsFor: vi.fn(opts.openPr ?? (() => false)),
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
});
