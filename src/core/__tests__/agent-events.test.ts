// @tests: make-noldor-agent-agnostic
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendAgentEvent, type AgentEvent } from '../agent-events';

const EVENT: AgentEvent = {
  ts: '2026-06-11T00:00:00.000Z',
  runner: 'claude',
  role: 'implementer',
  site: 'drain.spawnGate',
  exitCode: 0,
  durationMs: 1234,
  timedOut: false,
};

describe('appendAgentEvent', () => {
  it('creates .noldor and appends one JSON line per call', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-events-'));
    appendAgentEvent(dir, EVENT);
    appendAgentEvent(dir, { ...EVENT, exitCode: 1 });
    const lines = readFileSync(join(dir, '.noldor', 'agent-events.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual(EVENT);
    expect(JSON.parse(lines[1]!).exitCode).toBe(1);
  });

  it('fails open on unwritable target', () => {
    expect(() => appendAgentEvent('/dev/null/nope', EVENT)).not.toThrow();
  });
});
