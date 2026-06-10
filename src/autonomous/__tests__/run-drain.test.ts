import { describe, expect, it, vi } from 'vitest';
import { runDrain } from '../drain-loop.js';
import type { SuggestedEntry, Suggestions } from '../../core/next-priority.js';

function entryOf(slug: string, over: Partial<SuggestedEntry> = {}): SuggestedEntry {
  return {
    name: slug,
    slug,
    suggestedPath: 'fast-track',
    description: 'x',
    ...over,
  } as SuggestedEntry;
}

/**
 * Mutable-roadmap harness. `nextPriority(skip)` returns the live roadmap minus
 * `skip` (so the loop's skip filter genuinely terminates it); `parseAll()`
 * returns the live roadmap (the D2 oracle); a "shipping" spawn removes the
 * just-targeted slug (simulating a merged PR). Every test terminates for the
 * RIGHT reason — not via the maxSpawns backstop.
 */
function harness(
  initial: string[],
  opts: {
    ships?: (slug: string) => boolean;
    spawnImpl?: () => number;
    openPr?: () => boolean;
    stop?: () => boolean;
    nextPriorityImpl?: (skip: ReadonlySet<string>) => Suggestions;
    parseAllImpl?: () => string[];
    entryOver?: (slug: string) => Partial<SuggestedEntry>;
  } = {},
) {
  let roadmap = [...initial];
  let lastTarget: string | null = null;
  const ships = opts.ships ?? (() => true);
  const nextPriority = vi.fn(
    opts.nextPriorityImpl ??
      ((skip: ReadonlySet<string>): Suggestions => {
        const visible = roadmap.filter((s) => !skip.has(s));
        lastTarget = visible[0] ?? null;
        return {
          inProgress: [],
          topPriority: visible.map((s) => entryOf(s, opts.entryOver?.(s))),
          smallHighImpact: [],
          milestoneAligned: null,
        };
      }),
  );
  const spawnGate = vi.fn((_env: Record<string, string>) => {
    const code = (opts.spawnImpl ?? (() => 0))(); // may throw (timeout) → no removal
    if (lastTarget && ships(lastTarget)) roadmap = roadmap.filter((s) => s !== lastTarget);
    return code;
  });
  return {
    deps: {
      nextPriority,
      parseAll: vi.fn(opts.parseAllImpl ?? (() => [...roadmap])),
      spawnGate,
      syncMainCleanState: vi.fn(),
      openPrExistsFor: vi.fn(opts.openPr ?? (() => false)),
      writeState: vi.fn(),
      stopRequested: vi.fn(opts.stop ?? (() => false)),
    },
    spawnGate,
    nextPriority,
  };
}
const opts = {
  maxFeatures: 20,
  maxRetries: 2,
  maxSpawns: 40,
  timeoutMs: 1000,
  dryRun: false,
  cwd: '/x',
};

describe('runDrain', () => {
  it('(a) ships entry a, skips entry b after maxRetries', () => {
    const h = harness(['a', 'b'], { ships: (s) => s === 'a' });
    const r = runDrain(h.deps, opts);
    expect(r.shipped).toBe(1);
    expect(r.skipped).toContain('b');
    expect(r.exitCode).toBe(0);
    expect(h.spawnGate).toHaveBeenCalledTimes(1 + (opts.maxRetries + 1)); // a once + b (1 + retries)
  });

  it('(b) aborts exit 1 when nextPriority throws, surfacing the cause', () => {
    const h = harness(['a'], {
      nextPriorityImpl: () => {
        throw new Error('parse boom');
      },
    });
    const r = runDrain(h.deps, opts);
    expect(r.exitCode).toBe(1);
    expect(r.error).toContain('parse boom');
  });

  it('(c) child timeout → retry then skip', () => {
    const h = harness(['a'], {
      spawnImpl: () => {
        throw new Error('iteration-timeout');
      },
    });
    const r = runDrain(h.deps, { ...opts, maxRetries: 1 });
    expect(r.skipped).toContain('a');
  });

  it('(d) shipped entry leaves the roadmap → counts shipped, one spawn', () => {
    const h = harness(['a'], { ships: () => true });
    const r = runDrain(h.deps, opts);
    expect(r.shipped).toBe(1);
    expect(h.spawnGate).toHaveBeenCalledTimes(1);
  });

  it('(e) dry-run never spawns', () => {
    const h = harness(['a']);
    runDrain(h.deps, { ...opts, dryRun: true });
    expect(h.spawnGate).not.toHaveBeenCalled();
  });

  it('(f) stop-signal at iteration top → exit 130', () => {
    const h = harness(['a'], { stop: () => true });
    expect(runDrain(h.deps, opts).exitCode).toBe(130);
  });

  it('(g) out-of-scope entry skipped without spawning', () => {
    const h = harness(['a'], { entryOver: () => ({ suggestedPath: 'full-attach' }) });
    runDrain(h.deps, opts);
    expect(h.spawnGate).not.toHaveBeenCalled();
  });

  it('(i) post-spawn open PR → skip, no re-spawn', () => {
    // Coupling: the loop consults openPrExistsFor exactly twice per spawned iteration —
    // call 0 = pre-spawn (false here), call 1 = post-spawn (true). If the loop ever adds
    // another consult, update this counter.
    let calls = 0;
    const h = harness(['a'], { ships: () => false, openPr: () => calls++ >= 1 });
    const r = runDrain(h.deps, opts);
    expect(r.skipped).toContain('a');
    expect(h.spawnGate).toHaveBeenCalledTimes(1);
  });

  it('(j) pre-spawn open PR (restart) → skip without spawning', () => {
    const h = harness(['a'], { openPr: () => true });
    runDrain(h.deps, opts);
    expect(h.spawnGate).not.toHaveBeenCalled();
  });

  it('(k) openPrExistsFor gh failure → abort exit 1 (fail-closed)', () => {
    const h = harness(['a'], {
      openPr: () => {
        throw new Error('gh offline');
      },
    });
    expect(runDrain(h.deps, opts).exitCode).toBe(1);
  });

  it('(l) parseAll failure (roadmap parse) → abort exit 1', () => {
    const h = harness(['a'], {
      ships: () => false,
      parseAllImpl: () => {
        throw new Error('parse');
      },
    });
    expect(runDrain(h.deps, opts).exitCode).toBe(1);
  });

  it('(m) systemic spawn error (non-timeout) → abort exit 1, not retry-churn', () => {
    const h = harness(['a', 'b'], {
      spawnImpl: () => {
        throw new Error('spawn-failed: claude ENOENT');
      },
    });
    const r = runDrain(h.deps, opts);
    expect(r.exitCode).toBe(1);
    expect(h.spawnGate).toHaveBeenCalledTimes(1); // aborts on the first failure, no churn
  });
});
