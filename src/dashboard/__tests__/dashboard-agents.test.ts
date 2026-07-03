// @tests: agent-events-phase-tracking-run-ids-and-agents-dashboard-page

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadAgentActivity, loadWatchLogTail, NO_RUN_ID } from '../data.js';
import { startServer } from '../server.js';

import type { Server } from 'node:http';

const T0 = '2026-07-03T10:00:00.000Z';

function eventsFixture(lines: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-agents-'));
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  writeFileSync(
    join(dir, '.noldor', 'agent-events.jsonl'),
    lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n',
    'utf8',
  );
  return dir;
}

describe('loadAgentActivity', () => {
  it('derives the live board: unpaired spawned rows, pid-liveness filtered, phase + retries joined', async () => {
    const dir = eventsFixture([
      {
        ts: T0,
        runner: 'claude',
        role: 'implementer',
        site: 'drain.spawnGate',
        event: 'spawned',
        spawnId: 'live-1',
        pid: 111,
        runId: 'r-1',
        slug: 'feat-a',
      },
      {
        ts: T0,
        runner: 'claude',
        role: 'reviewer',
        site: 'cr.subagent-dispatch',
        event: 'spawned',
        spawnId: 'dead-1',
        pid: 222,
        runId: 'r-1',
      },
      {
        ts: T0,
        runner: 'claude',
        role: 'implementer',
        site: 'drain.spawnGate',
        event: 'spawned',
        spawnId: 'done-1',
        pid: 333,
        runId: 'r-1',
        slug: 'feat-b',
      },
      {
        ts: T0,
        runner: 'claude',
        role: 'implementer',
        site: 'drain.spawnGate',
        event: 'exited',
        spawnId: 'done-1',
        runId: 'r-1',
        slug: 'feat-b',
        exitCode: 0,
        durationMs: 60_000,
        timedOut: false,
      },
      {
        ts: T0,
        runner: '-',
        role: 'drain',
        site: 'drain.heartbeat',
        event: 'phase',
        runId: 'r-1',
        slug: 'feat-a',
        phase: 'building',
      },
    ]);
    writeFileSync(
      join(dir, '.noldor', 'drain-state.json'),
      JSON.stringify({
        pid: 1,
        startedAt: T0,
        phase: 'spawning',
        inFlight: [],
        merging: null,
        currentSlug: null,
        shipped: 0,
        skip: [],
        retries: { 'feat-a': 1 },
      }),
    );
    const activity = await loadAgentActivity(dir, {
      isPidAlive: (pid) => pid !== 222, // dead-1's pid is gone
      nowMs: () => Date.parse(T0) + 90_000,
    });
    expect(activity.live).toHaveLength(1);
    expect(activity.live[0]).toMatchObject({
      spawnId: 'live-1',
      kind: 'implementer',
      slug: 'feat-a',
      lane: 'drain.spawnGate',
      phase: 'building',
      retries: 1,
      stale: false,
      runId: 'r-1',
      pid: 111,
    });
    expect(activity.live[0]!.runtimeMs).toBe(90_000);
  });

  it('flags a live row past the staleness ceiling as stale (pid-reuse mitigation)', async () => {
    const dir = eventsFixture([
      {
        ts: T0,
        runner: 'claude',
        role: 'implementer',
        event: 'spawned',
        spawnId: 's',
        pid: 1,
      },
    ]);
    const activity = await loadAgentActivity(dir, {
      isPidAlive: () => true,
      nowMs: () => Date.parse(T0) + 3 * 60 * 60 * 1000, // 3h later
    });
    expect(activity.live).toHaveLength(1);
    expect(activity.live[0]!.stale).toBe(true);
  });

  it('groups runs newest-first with the legacy (no run id) bucket last, event-absent rows as exited', async () => {
    const dir = eventsFixture([
      // pre-vocabulary row: no event, no runId → exited bar in the legacy bucket
      {
        ts: '2026-06-01T00:00:00.000Z',
        runner: 'claude',
        role: 'implementer',
        exitCode: 0,
        durationMs: 1000,
        timedOut: false,
      },
      {
        ts: '2026-07-03T10:00:00.000Z',
        runner: 'claude',
        role: 'implementer',
        event: 'spawned',
        spawnId: 's1',
        pid: 1,
        runId: 'r-old',
      },
      {
        ts: '2026-07-03T10:01:00.000Z',
        runner: 'claude',
        role: 'implementer',
        event: 'exited',
        spawnId: 's1',
        runId: 'r-old',
        exitCode: 1,
        durationMs: 60_000,
        timedOut: false,
      },
      {
        ts: '2026-07-03T11:00:00.000Z',
        runner: 'claude',
        role: 'implementer',
        event: 'spawned',
        spawnId: 's2',
        pid: 2,
        runId: 'r-new',
        slug: 'feat-a',
      },
      {
        ts: '2026-07-03T11:05:00.000Z',
        runner: 'claude',
        role: 'implementer',
        event: 'exited',
        spawnId: 's2',
        runId: 'r-new',
        slug: 'feat-a',
        exitCode: 0,
        durationMs: 300_000,
        timedOut: false,
      },
      {
        ts: '2026-07-03T11:06:00.000Z',
        runner: '-',
        role: 'drain',
        event: 'phase',
        runId: 'r-new',
        slug: 'feat-a',
        phase: 'merged',
      },
    ]);
    const activity = await loadAgentActivity(dir, { isPidAlive: () => false });
    expect(activity.runs.map((r) => r.runId)).toEqual(['r-new', 'r-old', NO_RUN_ID]);
    expect(activity.runs[0]!.totals).toEqual({ shipped: 1, unfinished: 0, escalated: 0 });
    expect(activity.runs[0]!.bars[0]).toMatchObject({
      outcome: 'ok',
      durationMs: 300_000,
      slug: 'feat-a',
    });
    expect(activity.runs[0]!.bars[0]!.startMs).toBe(Date.parse('2026-07-03T11:00:00.000Z'));
    expect(activity.runs[1]!.bars[0]).toMatchObject({ outcome: 'failed' });
    expect(activity.runs[2]!.bars).toHaveLength(1); // legacy row renders as an exited bar
  });

  it('classifies timeout and salvaged outcomes and counts runId-matching escalations', async () => {
    const dir = eventsFixture([
      {
        ts: T0,
        runner: 'claude',
        role: 'implementer',
        event: 'exited',
        spawnId: 't1',
        runId: 'r-1',
        exitCode: -1,
        durationMs: 5000,
        timedOut: true,
      },
      {
        ts: T0,
        runner: 'drain',
        role: 'run',
        kind: 'salvaged',
        slug: 'feat-x',
        runId: 'r-1',
        exitCode: 0,
        durationMs: 100,
        timedOut: false,
      },
    ]);
    writeFileSync(
      join(dir, '.noldor', 'escalations.jsonl'),
      `${JSON.stringify({ ts: T0, slug: 'feat-x', source: 'roadmap', reason: 'retries-exhausted', evidence: 'e', stateSnapshot: { shipped: 0, skipped: [] }, suggestedAction: 'x', runId: 'r-1' })}\n`,
      'utf8',
    );
    const activity = await loadAgentActivity(dir, { isPidAlive: () => false });
    expect(activity.runs).toHaveLength(1);
    const outcomes = activity.runs[0]!.bars.map((b) => b.outcome).toSorted();
    expect(outcomes).toEqual(['salvaged', 'timeout']);
    expect(activity.runs[0]!.totals.escalated).toBe(1);
  });

  it('skips corrupt lines and tolerates absent files entirely', async () => {
    const dir = eventsFixture([
      '{not json',
      { ts: T0, runner: 'claude', role: 'implementer', event: 'spawned', spawnId: 'x', pid: 9 },
    ]);
    const activity = await loadAgentActivity(dir, { isPidAlive: () => true });
    expect(activity.runs).toHaveLength(1);
    expect(activity.live).toHaveLength(1);
    const empty = await loadAgentActivity(mkdtempSync(join(tmpdir(), 'noldor-agents-empty-')));
    expect(empty).toEqual({ live: [], runs: [], inbox: [] });
  });
});

describe('loadWatchLogTail', () => {
  it('returns null when the watch log is absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-agents-log-'));
    expect(await loadWatchLogTail(dir)).toBeNull();
  });

  it('returns only the last N lines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-agents-log-'));
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    const lines = Array.from({ length: 300 }, (_, i) => `line-${i}`);
    writeFileSync(join(dir, '.noldor', 'watch.log'), lines.join('\n'), 'utf8');
    const tail = await loadWatchLogTail(dir, 200);
    expect(tail).not.toBeNull();
    expect(tail).not.toContain('line-99\n');
    expect(tail!.startsWith('line-100')).toBe(true);
    expect(tail!.trimEnd().endsWith('line-299')).toBe(true);
  });
});

describe('GET /api/agents', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, baseUrl } = await startServer({ port: 0 }));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns application/json with live, runs, and inbox keys', async () => {
    const res = await fetch(`${baseUrl}/api/agents`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(body.live)).toBe(true);
    expect(Array.isArray(body.runs)).toBe(true);
    expect(Array.isArray(body.inbox)).toBe(true);
  });
});
