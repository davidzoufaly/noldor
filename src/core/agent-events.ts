import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One line of `.noldor/agent-events.jsonl`.
 *
 * Per-event field contract (`event` absent ⇒ `'exited'` — every historical row
 * was written by the registry's close handler, so readers MUST treat a missing
 * `event` as a completed-spawn record):
 * - `spawned` — spawn started: carries `pid` (+ `spawnId`, `runId`, `slug`);
 *   never carries `exitCode`/`durationMs`/`timedOut`.
 * - `exited`  — spawn completed: carries `exitCode`/`durationMs`/`timedOut`
 *   (+ `spawnId` pairing it to its `spawned` row, `tokens` when known).
 * - `phase`   — coarse drain phase transition from the heartbeat tap: carries
 *   `slug` + `phase` (building | awaiting-merge | merging | merged).
 */
export interface AgentEvent {
  ts: string;
  runner: string;
  role: string;
  site?: string;
  /** Row vocabulary. Absent ⇒ 'exited' (pre-vocabulary rows; readers honor this). */
  event?: 'spawned' | 'exited' | 'phase';
  /** Optional writer-specific kind (e.g. 'salvaged', 'resolved'). */
  kind?: string;
  /** Slug the event concerns, when item-scoped. */
  slug?: string;
  /** Drain-run correlation id (`<startedAt ISO>.<pid>`); absent on pre-run-id rows. */
  runId?: string;
  /** Pairs one spawn's spawned/exited rows (randomUUID); pid is unsafe for pairing (reuse). */
  spawnId?: string;
  /** Child pid at spawn time — liveness probes only, never pairing. */
  pid?: number;
  /** Coarse drain phase — only on event:'phase' rows. */
  phase?: string;
  /** Only meaningful on exited rows (event absent or 'exited'). */
  exitCode?: number;
  /** Only meaningful on exited rows. */
  durationMs?: number;
  /** Only meaningful on exited rows. */
  timedOut?: boolean;
  /**
   * Raw token usage, read VERBATIM from the runner's native usage records
   * (never estimated, never derived from text length). Absent when the
   * runner exposed no trustworthy usage data. NEVER converted to cost.
   */
  tokens?: { input: number; output: number; total: number; source: string };
}

/**
 * Append one event line to `.noldor/agent-events.jsonl`. FAIL-OPEN: an
 * events-write failure must never break a spawn, so every fs error is
 * swallowed. Rotation/retention is deliberately deferred — see the
 * "agent-events log rotation" follow-up seeded in ideas.md (spec D5).
 */
export function appendAgentEvent(cwd: string, event: AgentEvent): void {
  try {
    const dir = join(cwd, '.noldor');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'agent-events.jsonl'), JSON.stringify(event) + '\n', 'utf8');
  } catch {
    // fail-open by contract
  }
}
