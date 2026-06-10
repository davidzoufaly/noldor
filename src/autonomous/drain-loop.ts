import type { SuggestedEntry, Suggestions } from '../core/next-priority.js';
import { isDrainEligible } from './drain-eligibility.js';

export type DrainAction = 'spawn' | 'skip-out-of-scope' | 'done';

export interface DecideInput {
  entry: SuggestedEntry;
  shipped: number;
  maxFeatures: number;
  spawns: number;
  maxSpawns: number;
}

/**
 * Pure per-iteration decision. Retry-agnostic — {@link runDrain} owns retry
 * counting. `done` caps fire first (backstops), then scope checks
 * (suggestedPath + residue), else `spawn`.
 */
export function decideNext(input: DecideInput): { action: DrainAction; slug: string } {
  const { entry, shipped, maxFeatures, spawns, maxSpawns } = input;
  const slug = entry.slug;
  if (shipped >= maxFeatures || spawns >= maxSpawns) return { action: 'done', slug };
  if (entry.suggestedPath !== 'fast-track') return { action: 'skip-out-of-scope', slug };
  if (!isDrainEligible(entry.description)) return { action: 'skip-out-of-scope', slug };
  return { action: 'spawn', slug };
}

export interface DrainDeps {
  /** Skip-filtered suggestion buckets. May throw → abort. */
  nextPriority: (skip: ReadonlySet<string>) => Suggestions;
  /** ALL roadmap slugs (unfiltered) — the D2 success oracle. May throw → abort. */
  parseAll: () => string[];
  /** Spawn a headless gate run; returns the child exit code. May throw('iteration-timeout'). */
  spawnGate: (env: Record<string, string>, timeoutMs: number) => number;
  /** Sync local main to origin + clean leftover worktrees/branches. May throw → abort (ff-only reject). */
  syncMainCleanState: () => void;
  /** True when an open PR exists for fast/<slug>. May throw → abort (fail-closed). */
  openPrExistsFor: (slug: string) => boolean;
  /** Best-effort heartbeat write (never throws). */
  writeState: (s: {
    phase: string;
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
}

export interface DrainResult {
  shipped: number;
  skipped: string[];
  exitCode: 0 | 1 | 130;
  /** Set only on an abort (exitCode 1) — the message of the dep that threw. */
  error?: string;
}

/**
 * The drain loop. Pure of IO except through injected {@link DrainDeps}, so every
 * branch is unit-testable with mocks. Success === the target slug is absent from
 * the freshly-synced full roadmap (D2). Failure → retry up to `maxRetries`, then
 * skip. Termination on an empty `topPriority` (D4), the `done` caps, or a stop
 * request (exit 130). Any thrown dep (nextPriority / parseAll / openPrExistsFor /
 * syncMainCleanState) aborts the whole drain (exit 1) — never loop blind.
 */
export function runDrain(deps: DrainDeps, opts: DrainOpts): DrainResult {
  const skip = new Set<string>();
  const retries = new Map<string, number>();
  let shipped = 0;
  let spawns = 0;
  const result = (exitCode: 0 | 1 | 130, error?: string): DrainResult => ({
    shipped,
    skipped: [...skip],
    exitCode,
    ...(error !== undefined ? { error } : {}),
  });

  try {
    deps.syncMainCleanState();
    for (;;) {
      if (deps.stopRequested()) return result(130);
      const sugg = deps.nextPriority(skip);
      if (sugg.topPriority.length === 0) return result(0); // D4 — done
      const entry = sugg.topPriority[0];
      const d = decideNext({
        entry,
        shipped,
        maxFeatures: opts.maxFeatures,
        spawns,
        maxSpawns: opts.maxSpawns,
      });
      if (d.action === 'done') return result(0);
      if (d.action === 'skip-out-of-scope') {
        skip.add(entry.slug);
        continue;
      }

      if (deps.openPrExistsFor(entry.slug)) {
        skip.add(entry.slug); // restart-safety: a prior run's PR is in-flight
        continue;
      }
      if (opts.dryRun) {
        skip.add(entry.slug); // plan only — never spawn / merge
        continue;
      }

      spawns += 1;
      deps.writeState({
        phase: 'spawning',
        currentSlug: entry.slug,
        shipped,
        skip: [...skip],
        retries: Object.fromEntries(retries),
      });
      try {
        deps.spawnGate(
          { NOLDOR_DRAIN: '1', NOLDOR_DRAIN_SKIP: [...skip].join(',') },
          opts.timeoutMs,
        );
      } catch {
        // timeout / spawn error → treated as an iteration failure below
      }
      deps.syncMainCleanState(); // D5 — make the read authoritative
      const stillPresent = deps.parseAll().includes(entry.slug); // D2
      if (!stillPresent) {
        shipped += 1;
        retries.delete(entry.slug);
        continue;
      }
      if (deps.openPrExistsFor(entry.slug)) {
        skip.add(entry.slug); // D5b — PR landed in-flight; never re-spawn a duplicate
        continue;
      }
      const n = (retries.get(entry.slug) ?? 0) + 1;
      retries.set(entry.slug, n);
      if (n > opts.maxRetries) skip.add(entry.slug);
    }
  } catch (err) {
    // nextPriority / parseAll / openPrExistsFor / syncMain failure → abort, surfacing the cause.
    return result(1, err instanceof Error ? err.message : String(err));
  }
}
