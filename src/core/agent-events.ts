import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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

/** Rotation trips only past this size — steady-state appends pay one statSync, nothing more. */
const ROTATE_MAX_BYTES = 512 * 1024;
/** Distinct runIds kept in the live file so the /agents timeline stays readable post-rotation. */
const ROTATE_KEEP_RUNS = 20;
/** Hard line cap — guarantees shrink even when rows carry no runId (ad-hoc spawns, legacy rows). */
const ROTATE_KEEP_LINES = 2000;

/**
 * Trim `agent-events.jsonl` when it exceeds ROTATE_MAX_BYTES: the newest
 * ROTATE_KEEP_RUNS runs (capped at ROTATE_KEEP_LINES lines) stay live; older
 * lines move to `agent-events.archive.jsonl` (append-only, never rotated
 * itself — operators prune it by hand). The live file is replaced via
 * temp-write + rename so readers never observe a half-written file. A
 * concurrent append between read and rename can be lost — accepted for a
 * fail-open telemetry sink; the window is one rotation per ~512KiB.
 */
function rotateIfNeeded(dir: string): void {
  const file = join(dir, 'agent-events.jsonl');
  if (statSync(file).size <= ROTATE_MAX_BYTES) return;
  const lines = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0);
  const seenRuns = new Set<string>();
  let cut = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    let runId: unknown;
    try {
      runId = (JSON.parse(lines[i]!) as Record<string, unknown>).runId;
    } catch {
      runId = undefined;
    }
    if (typeof runId === 'string' && !seenRuns.has(runId)) {
      if (seenRuns.size === ROTATE_KEEP_RUNS) {
        cut = i + 1;
        break;
      }
      seenRuns.add(runId);
    }
  }
  cut = Math.max(cut, lines.length - ROTATE_KEEP_LINES);
  if (cut <= 0) return;
  appendFileSync(
    join(dir, 'agent-events.archive.jsonl'),
    lines.slice(0, cut).join('\n') + '\n',
    'utf8',
  );
  const tmp = join(dir, 'agent-events.jsonl.tmp');
  writeFileSync(
    tmp,
    lines
      .slice(cut)
      .map((l) => l + '\n')
      .join(''),
    'utf8',
  );
  renameSync(tmp, file);
}

/**
 * Append one event line to `.noldor/agent-events.jsonl`. FAIL-OPEN: an
 * events-write failure must never break a spawn, so every fs error is
 * swallowed. Size-triggered rotation (see rotateIfNeeded) runs before the
 * append under the same fail-open contract.
 */
export function appendAgentEvent(cwd: string, event: AgentEvent): void {
  try {
    const dir = join(cwd, '.noldor');
    mkdirSync(dir, { recursive: true });
    try {
      rotateIfNeeded(dir);
    } catch {
      // fail-open: a rotation failure must never block the append
    }
    appendFileSync(join(dir, 'agent-events.jsonl'), JSON.stringify(event) + '\n', 'utf8');
  } catch {
    // fail-open by contract
  }
}
