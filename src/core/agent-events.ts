import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface AgentEvent {
  ts: string;
  runner: string;
  role: string;
  site?: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

/**
 * Append one event line to `.noldor/agent-events.jsonl`. FAIL-OPEN: an
 * events-write failure must never break a spawn, so every fs error is
 * swallowed. Rotation/retention is the agent-events roadmap entry's concern.
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
