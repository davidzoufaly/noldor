import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface InFlight {
  slug: string;
  phase: 'building' | 'awaiting-merge';
}

export interface DrainState {
  pid: number;
  startedAt: string;
  phase: 'spawning' | 'awaiting-merge' | 'idle';
  /** All slugs currently in flight (building or awaiting merge). Empty at K=1 between iterations. */
  inFlight: InFlight[];
  /** The slug the serialized coordinator is merging right now, or null. */
  merging: string | null;
  /** Back-compat projection for readers written against the sequential heartbeat: `inFlight[0]?.slug`. */
  currentSlug: string | null;
  shipped: number;
  skip: string[];
  retries: Record<string, number>;
  /**
   * Process-group ids of the gate children currently in flight. Populated by the
   * drain loop's `emitState` from its live pgid set (each child is spawned
   * `detached: true`, so `pgid === child.pid`). On runner SIGKILL — which runs no
   * exit handler — these survive as orphans; the NEXT run's startup
   * `reapOrphanAgents` reads them from the dead run's state file and group-kills
   * each before acquiring the lock. Optional for back-compat with state files
   * written before this field existed.
   */
  agentPgids?: number[];
}

/** Per-heartbeat snapshot the drain loop reports (the `DrainDeps.writeState` argument). */
export interface DrainStateSnapshot {
  phase: 'spawning' | 'awaiting-merge' | 'idle';
  inFlight: InFlight[];
  merging: string | null;
  shipped: number;
  skip: string[];
  retries: Record<string, number>;
  /** pgids of the gate children currently in flight — the orphan-reap carrier. */
  agentPgids: number[];
}

/**
 * Project a loop snapshot into the persisted {@link DrainState} heartbeat.
 * Shared by `run` and `watch` so no runner can silently drop a field —
 * `watch` omitting `agentPgids` here is exactly what left its dead-run agent
 * children invisible to the next startup's `reapOrphanAgents`.
 */
export function projectDrainState(
  pid: number,
  startedAt: string,
  s: DrainStateSnapshot,
): DrainState {
  return {
    pid,
    startedAt,
    phase: s.phase,
    inFlight: s.inFlight,
    merging: s.merging,
    currentSlug: s.inFlight[0]?.slug ?? null, // back-compat projection
    shipped: s.shipped,
    skip: s.skip,
    retries: s.retries,
    agentPgids: s.agentPgids,
  };
}

/**
 * Best-effort heartbeat write to `.noldor/drain-state.json`. A failure logs to
 * stderr but never throws — a state-write failure must not crash the loop (spec
 * Error handling). Not a cross-run cache; a fresh drain run overwrites it.
 */
/**
 * Read the latest `.noldor/drain-state.json` heartbeat, or `null` when the file
 * is missing or holds a garbage payload. Callers own liveness interpretation —
 * the returned state may belong to a dead run (check `pid` against the lock).
 */
export function readState(cwd: string): DrainState | null {
  try {
    return JSON.parse(readFileSync(join(cwd, '.noldor/drain-state.json'), 'utf8')) as DrainState;
  } catch {
    return null; // missing or garbage payload — no readable prior state
  }
}

export function writeState(cwd: string, state: DrainState): void {
  try {
    mkdirSync(join(cwd, '.noldor'), { recursive: true });
    writeFileSync(
      join(cwd, '.noldor/drain-state.json'),
      `${JSON.stringify(state, null, 2)}\n`,
      'utf8',
    );
  } catch (err) {
    process.stderr.write(`drain-state write failed (non-fatal): ${String(err)}\n`);
  }
}
