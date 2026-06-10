import type { DrainSource, DrainCandidate } from './drain-source.js';
import type { MergeOutcome } from './drain-io.js';
import type { InFlight } from './drain-state.js';

export type DrainAction = 'spawn' | 'skip-out-of-scope' | 'done';

export interface DecideInput {
  candidate: DrainCandidate;
  shipped: number;
  maxFeatures: number;
  spawns: number;
  maxSpawns: number;
}

/**
 * Pure per-iteration decision. Retry-agnostic — {@link runDrain} owns retry
 * counting. `done` caps fire first (backstops), then the source's eligibility
 * verdict, else `spawn`. No source/path literals here — eligibility is decided
 * by the {@link DrainSource} and read off the candidate.
 */
export function decideNext(input: DecideInput): { action: DrainAction; slug: string } {
  const { candidate, shipped, maxFeatures, spawns, maxSpawns } = input;
  const slug = candidate.slug;
  if (shipped >= maxFeatures || spawns >= maxSpawns) return { action: 'done', slug };
  if (!candidate.eligible) return { action: 'skip-out-of-scope', slug };
  return { action: 'spawn', slug };
}

export interface DrainDeps {
  /** Injected source — owns next-item selection, the success oracle, prompt, and branch. */
  source: DrainSource;
  /** Spawn a headless gate run with the source's prompt; resolves with the child exit code.
   *  Rejects with 'iteration-timeout' on a per-entry timeout, or 'spawn-failed: …' on a systemic
   *  spawn error. Async so the build pool can keep K children in flight at once. */
  spawnGate: (env: Record<string, string>, timeoutMs: number, prompt: string) => Promise<number>;
  /** Sync local main to origin + clean leftover worktrees/branches. May throw → abort (ff-only reject).
   *  At K>1 the coordinator also calls this after each merge to advance local main before the oracle. */
  syncMainCleanState: () => void;
  /** Serialized squash-merge of one open PR (K>1 only). Resolves with the merge outcome; rejects on a
   *  systemic gh failure (coordinator aborts fail-closed). Optional: only the K>1 path uses it, so the
   *  K=1 sequential callers (and tests) need not provide it. Asserted present before the coordinator runs. */
  mergePr?: (slug: string, branch: string) => Promise<MergeOutcome>;
  /** True when an open PR exists for the source's branch. May throw → abort (fail-closed). */
  openPrExistsFor: (slug: string, branch: string) => boolean;
  /** Best-effort heartbeat write (never throws). Reports ALL in-flight slugs (building or
   *  awaiting-merge) + the slug currently merging — the K>1 generalization of the old `currentSlug`. */
  writeState: (s: {
    phase: 'spawning' | 'awaiting-merge' | 'idle';
    inFlight: InFlight[];
    merging: string | null;
    shipped: number;
    skip: string[];
    retries: Record<string, number>;
  }) => void;
  /** True when a stop has been requested (SIGINT / sentinel). */
  stopRequested: () => boolean;
}

export interface DrainOpts {
  maxFeatures: number;
  maxRetries: number;
  maxSpawns: number;
  timeoutMs: number;
  dryRun: boolean;
  cwd: string;
  /** Max features built concurrently. 1 (default) = today's sequential, inline-merge behavior. */
  concurrency: number;
  /** Per-worker first-spawn stagger (ms) so K simultaneous `git worktree add` don't collide on the
   *  shared `.git`. Production passes 750; tests pass 0. Only applies at concurrency > 1. */
  startupStaggerMs: number;
}

export interface DrainResult {
  shipped: number;
  skipped: string[];
  /** Per-slug skip reasons (e.g. ineligible). Present only when at least one reason was recorded. */
  skipReasons?: Record<string, string>;
  /** Dry-run only: eligible candidates that WOULD ship, in FIFO order. Present only in --dry-run with ≥1 eligible. */
  planned?: string[];
  exitCode: 0 | 1 | 130;
  /** Set only on an abort (exitCode 1) — the message of the dep that threw. */
  error?: string;
}

/**
 * The drain loop. Pure of IO except through injected {@link DrainDeps}. Success
 * === the target slug is absent from the source's freshly-synced `parseAll()`
 * universe (absence === shipped). Failure → retry up to `maxRetries`, then skip.
 * Termination on a null `nextItem` (no items remain), the `done` caps, or a stop
 * request (exit 130). Any thrown dep (source.nextItem / source.parseAll /
 * openPrExistsFor / syncMainCleanState) aborts the whole drain (exit 1) — never
 * loop blind.
 */
export async function runDrain(deps: DrainDeps, opts: DrainOpts): Promise<DrainResult> {
  const skip = new Set<string>();
  const retries = new Map<string, number>();
  const skipReasons: Record<string, string> = {};
  const planned: string[] = [];
  let shipped = 0;
  let spawns = 0;
  const result = (exitCode: 0 | 1 | 130, error?: string): DrainResult => ({
    shipped,
    skipped: [...skip],
    ...(Object.keys(skipReasons).length > 0 ? { skipReasons } : {}),
    ...(planned.length > 0 ? { planned } : {}),
    exitCode,
    ...(error !== undefined ? { error } : {}),
  });

  // `dispatched` holds a slug from the moment a worker dispatches it until it is FULLY settled
  // (shipped / skipped / retry-bumped). At K>1 that window includes awaiting-merge — the COORDINATOR
  // removes the slug after settling it (not the worker), so the slug stays (a) counted against
  // maxFeatures and (b) excluded from re-selection while its PR is open.
  const dispatched = new Set<string>();
  const readyToMerge: Array<{ slug: string; branch: string }> = [];
  // Holder (not a bare `let`) so TS doesn't narrow the closure-mutated abort flag to `never` at the
  // outer read after `await Promise.all` — object properties aren't subject to that CFA collapse.
  const abortRef: { current: Error | null } = { current: null };
  let buildersDone = false;
  let wake: (() => void) | null = null; // resolves the coordinator's idle wait
  const signalCoordinator = (): void => {
    if (wake) {
      wake();
      wake = null;
    }
  };
  const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  let merging: string | null = null; // slug the coordinator is merging right now (K>1)

  // Best-effort heartbeat: derive inFlight (building vs awaiting-merge) from the live sets.
  const emitState = (): void => {
    const pending = new Set(readyToMerge.map((r) => r.slug));
    const inFlight: InFlight[] = [...dispatched].map((slug) => ({
      slug,
      phase: pending.has(slug) || slug === merging ? 'awaiting-merge' : 'building',
    }));
    deps.writeState({
      phase: merging !== null ? 'awaiting-merge' : inFlight.length > 0 ? 'spawning' : 'idle',
      inFlight,
      merging,
      shipped,
      skip: [...skip],
      retries: Object.fromEntries(retries),
    });
  };

  const recordRetryOrSkip = (slug: string): void => {
    const n = (retries.get(slug) ?? 0) + 1;
    retries.set(slug, n);
    if (n > opts.maxRetries) skip.add(slug);
  };

  // K=1 → EXACTLY today's env (no slug assignment / open-only): the gate falls back to topPriority[0],
  // which the single worker selected anyway. Slug-assignment + open-only are K>1-only.
  const envFor = (slug: string): Record<string, string> => {
    const base = { NOLDOR_DRAIN: '1', NOLDOR_DRAIN_SKIP: [...skip].join(',') };
    return opts.concurrency > 1
      ? { ...base, NOLDOR_DRAIN_SLUG: slug, NOLDOR_DRAIN_OPEN_ONLY: '1' }
      : base;
  };

  /** Returns true iff the slug was handed to the coordinator (worker must NOT drop it from
   *  `dispatched` — the coordinator owns its removal). K=1 settles inline and returns false.
   *  `code` is the gate child's exit code. At K=1 it's ignored (the oracle is authoritative, as
   *  today); at K>1 a non-zero exit means a post-open failure — don't merge that PR, skip it. */
  const settleShipVerdict = (slug: string, branch: string, code: number): boolean => {
    if (opts.concurrency === 1) {
      deps.syncMainCleanState(); // today's inline authority: advance local main, then read the oracle
      const stillPresent = deps.source.parseAll().includes(slug);
      if (!stillPresent) {
        shipped += 1;
        retries.delete(slug);
        return false;
      }
      if (deps.openPrExistsFor(slug, branch)) {
        skip.add(slug); // PR landed in-flight; never re-spawn a duplicate
        return false;
      }
      recordRetryOrSkip(slug);
      return false;
    }
    // K>1: hand off to the coordinator ONLY when the child exited cleanly AND opened a PR. A non-zero
    // exit with an open PR (post-open failure) is skipped — its PR is left open, matching K=1's
    // "don't ship a failed build" intent rather than letting the coordinator merge it blindly.
    if (code === 0 && deps.openPrExistsFor(slug, branch)) {
      readyToMerge.push({ slug, branch });
      signalCoordinator();
      emitState(); // slug transitions building → awaiting-merge
      return true;
    }
    recordRetryOrSkip(slug); // no PR / non-zero exit → build failed → retry/skip; worker drops it
    return false;
  };

  const worker = async (index: number): Promise<void> => {
    if (opts.concurrency > 1 && opts.startupStaggerMs > 0)
      await delay(index * opts.startupStaggerMs);
    for (;;) {
      if (abortRef.current || deps.stopRequested()) return;
      // ---- selection critical section (synchronous, no await) ----
      if (shipped + dispatched.size >= opts.maxFeatures) return; // cap counts in-flight + awaiting-merge
      const candidate = deps.source.nextItem(new Set([...skip, ...dispatched]));
      if (candidate === null) return;
      const d = decideNext({
        candidate,
        shipped,
        maxFeatures: opts.maxFeatures,
        spawns,
        maxSpawns: opts.maxSpawns,
      });
      if (d.action === 'done') return;
      if (d.action === 'skip-out-of-scope') {
        skip.add(candidate.slug);
        if (candidate.reason !== undefined) skipReasons[candidate.slug] = candidate.reason;
        continue;
      }
      const branch = deps.source.branchFor(candidate.slug);
      if (deps.openPrExistsFor(candidate.slug, branch)) {
        skip.add(candidate.slug); // restart-safety: a prior run's PR is in-flight
        continue;
      }
      if (opts.dryRun) {
        planned.push(candidate.slug);
        skip.add(candidate.slug);
        continue;
      }
      spawns += 1;
      dispatched.add(candidate.slug);
      emitState();
      // ---- end critical section ----
      let handedToCoordinator = false;
      try {
        const code = await deps.spawnGate(
          envFor(candidate.slug),
          opts.timeoutMs,
          deps.source.gatePrompt(candidate.slug),
        );
        handedToCoordinator = settleShipVerdict(candidate.slug, branch, code);
      } catch (e) {
        // A per-entry timeout is recoverable (retry/skip). Any other spawn error is systemic → abort.
        if (e instanceof Error && e.message === 'iteration-timeout')
          recordRetryOrSkip(candidate.slug);
        else abortRef.current = e instanceof Error ? e : new Error(String(e));
      } finally {
        if (!handedToCoordinator) dispatched.delete(candidate.slug);
      }
      if (abortRef.current) return;
    }
  };

  const coordinator = async (): Promise<void> => {
    for (;;) {
      if (abortRef.current) return;
      const next = readyToMerge.shift();
      if (next === undefined) {
        if (buildersDone) return;
        await new Promise<void>((r) => {
          wake = r;
        }); // woken by a worker push or by buildersDone + signal
        continue;
      }
      merging = next.slug;
      emitState();
      try {
        const outcome = await deps.mergePr!(next.slug, next.branch); // non-null: asserted at K>1 entry
        if (outcome !== 'merged') {
          skip.add(next.slug);
          skipReasons[next.slug] = `${outcome} — PR left open for human resolution`;
        } else {
          deps.syncMainCleanState(); // advance local main so parseAll() reflects the squash before the oracle
          const stillPresent = deps.source.parseAll().includes(next.slug);
          if (!stillPresent) {
            shipped += 1;
            retries.delete(next.slug);
          } else {
            recordRetryOrSkip(next.slug);
          }
        }
      } catch (e) {
        abortRef.current = e instanceof Error ? e : new Error(String(e));
        return;
      } finally {
        merging = null;
        dispatched.delete(next.slug); // settled (any outcome) → free the cap slot + re-selection guard
        emitState();
      }
    }
  };

  try {
    if (opts.concurrency > 1 && deps.mergePr === undefined) {
      throw new Error('concurrency > 1 requires a mergePr dep');
    }
    deps.syncMainCleanState();
    const coordinatorPromise = opts.concurrency > 1 ? coordinator() : Promise.resolve();
    const workers = Array.from({ length: Math.max(1, opts.concurrency) }, (_, i) => worker(i));
    await Promise.all(workers);
    buildersDone = true;
    signalCoordinator(); // unblock a parked coordinator so it observes buildersDone and exits
    await coordinatorPromise;
    if (abortRef.current) return result(1, abortRef.current.message); // abort (1) wins
    if (deps.stopRequested()) return result(130); // stop (130) wins over the drained 0
    return result(0);
  } catch (err) {
    // source.nextItem / parseAll / openPrExistsFor / syncMain failure → abort, surfacing the cause.
    return result(1, err instanceof Error ? err.message : String(err));
  }
}
