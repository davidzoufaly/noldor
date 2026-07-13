// @tests: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, continuous-drain-daemon-and-escalation-inbox, make-noldor-agent-agnostic
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

  it('serializes a phase row without exit fields (vocabulary extension)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-events-'));
    appendAgentEvent(dir, {
      event: 'phase',
      ts: '2026-07-03T00:00:00.000Z',
      runner: '-',
      role: 'drain',
      site: 'drain.heartbeat',
      runId: '2026-07-03T00:00:00.000Z.123',
      slug: 'foo',
      phase: 'building',
    });
    const parsed = JSON.parse(
      readFileSync(join(dir, '.noldor/agent-events.jsonl'), 'utf8').trim(),
    ) as Record<string, unknown>;
    expect(parsed).toMatchObject({ event: 'phase', phase: 'building', slug: 'foo' });
    expect(parsed.exitCode).toBeUndefined();
    expect(parsed.timedOut).toBeUndefined();
  });

  it('serializes optional kind and slug when present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-events-'));
    appendAgentEvent(dir, {
      ts: '2026-06-12T00:00:00.000Z',
      runner: 'drain',
      role: 'watch',
      kind: 'salvaged',
      slug: 'foo-bar',
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    });
    const line = readFileSync(join(dir, '.noldor/agent-events.jsonl'), 'utf8').trim();
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.kind).toBe('salvaged');
    expect(parsed.slug).toBe('foo-bar');
  });
});

describe('rotation', () => {
  const row = (runId: string, i: number) =>
    JSON.stringify({ ...EVENT, runId, spawnId: `s${i}`, pad: 'x'.repeat(300) });

  /** Seed a live file of `runs` distinct runIds × `perRun` lines, well past the 512KiB trigger. */
  const seedOversize = (runs: number, perRun: number) => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-rotate-'));
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    const lines: string[] = [];
    for (let r = 0; r < runs; r++) {
      for (let i = 0; i < perRun; i++) lines.push(row(`run-${String(r).padStart(3, '0')}`, i));
    }
    writeFileSync(join(dir, '.noldor', 'agent-events.jsonl'), lines.join('\n') + '\n', 'utf8');
    return dir;
  };

  it('below the size threshold nothing rotates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-rotate-'));
    appendAgentEvent(dir, { ...EVENT, runId: 'r1' });
    appendAgentEvent(dir, { ...EVENT, runId: 'r2' });
    expect(existsSync(join(dir, '.noldor', 'agent-events.archive.jsonl'))).toBe(false);
    const lines = readFileSync(join(dir, '.noldor', 'agent-events.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(lines).toHaveLength(2);
  });

  it('past the threshold keeps the newest 20 runs live and archives the rest', () => {
    const dir = seedOversize(30, 60); // 30 runs × 60 lines × ~380B ≈ 680KiB
    appendAgentEvent(dir, { ...EVENT, runId: 'run-030' });
    const live = readFileSync(join(dir, '.noldor', 'agent-events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { runId?: string });
    const liveRuns = new Set(live.map((e) => e.runId));
    expect(liveRuns.has('run-010')).toBe(true); // newest 20 seeded runs survive
    expect(liveRuns.has('run-029')).toBe(true);
    expect(liveRuns.has('run-009')).toBe(false); // older runs rotated out
    expect(liveRuns.has('run-030')).toBe(true); // the triggering append still lands
    const archived = readFileSync(join(dir, '.noldor', 'agent-events.archive.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { runId?: string });
    expect(new Set(archived.map((e) => e.runId))).toEqual(
      new Set(Array.from({ length: 10 }, (_, r) => `run-${String(r).padStart(3, '0')}`)),
    );
    // no line lost or duplicated across the split
    expect(live.length - 1 + archived.length).toBe(30 * 60);
  });

  it('caps the live file by line count when rows carry no runId', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-rotate-'));
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    const lines = Array.from({ length: 3000 }, (_, i) =>
      JSON.stringify({ ...EVENT, spawnId: `s${i}`, pad: 'x'.repeat(300) }),
    );
    writeFileSync(join(dir, '.noldor', 'agent-events.jsonl'), lines.join('\n') + '\n', 'utf8');
    appendAgentEvent(dir, EVENT);
    const live = readFileSync(join(dir, '.noldor', 'agent-events.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(live).toHaveLength(2000 + 1); // ROTATE_KEEP_LINES survivors + the new append
    expect(JSON.parse(live[0]!).spawnId).toBe('s1000');
    const archived = readFileSync(join(dir, '.noldor', 'agent-events.archive.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(archived).toHaveLength(1000);
  });
});

describe('tokens field', () => {
  it('serializes tokens when present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-events-'));
    appendAgentEvent(dir, {
      ...EVENT,
      tokens: { input: 1200, output: 340, total: 1540, source: 'claude-jsonl' },
    });
    const line = readFileSync(join(dir, '.noldor', 'agent-events.jsonl'), 'utf8').trim();
    expect(JSON.parse(line).tokens).toEqual({
      input: 1200,
      output: 340,
      total: 1540,
      source: 'claude-jsonl',
    });
  });
});
