import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface DrainState {
  pid: number;
  startedAt: string;
  phase: 'spawning' | 'awaiting-merge' | 'idle';
  currentSlug: string | null;
  shipped: number;
  skip: string[];
  retries: Record<string, number>;
}

/**
 * Best-effort heartbeat write to `.noldor/drain-state.json`. A failure logs to
 * stderr but never throws — a state-write failure must not crash the loop (spec
 * Error handling). Not a cross-run cache; a fresh drain run overwrites it.
 */
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
