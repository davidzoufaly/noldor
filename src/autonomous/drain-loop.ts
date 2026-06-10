import type { DrainSource, DrainCandidate } from './drain-source.js';

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
  /** Sync local main to origin + clean leftover worktrees/branches. May throw → abort (ff-only reject). */
  syncMainCleanState: () => void;
  /** True when an open PR exists for the source's branch. May throw → abort (fail-closed). */
  openPrExistsFor: (slug: string, branch: string) => boolean;
  /** Best-effort heartbeat write (never throws). */
  writeState: (s: {
    phase: 'spawning' | 'awaiting-merge' | 'idle';
    currentSlug: string | null;
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

  try {
    deps.syncMainCleanState();
    for (;;) {
      if (deps.stopRequested()) return result(130);
      const candidate = deps.source.nextItem(skip);
      if (candidate === null) return result(0); // no items remain — done
      const d = decideNext({
        candidate,
        shipped,
        maxFeatures: opts.maxFeatures,
        spawns,
        maxSpawns: opts.maxSpawns,
      });
      if (d.action === 'done') return result(0);
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
        planned.push(candidate.slug); // eligible — would ship (dry-run diagnostic, FIFO order)
        skip.add(candidate.slug); // plan only — never spawn / merge
        continue;
      }

      spawns += 1;
      deps.writeState({
        phase: 'spawning',
        currentSlug: candidate.slug,
        shipped,
        skip: [...skip],
        retries: Object.fromEntries(retries),
      });
      try {
        await deps.spawnGate(
          { NOLDOR_DRAIN: '1', NOLDOR_DRAIN_SKIP: [...skip].join(',') },
          opts.timeoutMs,
          deps.source.gatePrompt(candidate.slug),
        );
      } catch (e) {
        // A per-iteration timeout is recoverable (retry/skip below). Any other spawn error
        // (e.g. `claude` not on PATH) is systemic — re-throw so the outer catch aborts.
        if (!(e instanceof Error && e.message === 'iteration-timeout')) throw e;
      }
      deps.syncMainCleanState(); // make the read authoritative
      const stillPresent = deps.source.parseAll().includes(candidate.slug);
      if (!stillPresent) {
        shipped += 1;
        retries.delete(candidate.slug);
        continue;
      }
      if (deps.openPrExistsFor(candidate.slug, branch)) {
        skip.add(candidate.slug); // PR landed in-flight; never re-spawn a duplicate
        continue;
      }
      const n = (retries.get(candidate.slug) ?? 0) + 1;
      retries.set(candidate.slug, n);
      if (n > opts.maxRetries) skip.add(candidate.slug);
    }
  } catch (err) {
    // source.nextItem / parseAll / openPrExistsFor / syncMain failure → abort, surfacing the cause.
    return result(1, err instanceof Error ? err.message : String(err));
  }
}
