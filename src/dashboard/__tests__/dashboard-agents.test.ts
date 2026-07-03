// @tests: agent-events-phase-tracking-run-ids-and-agents-dashboard-page

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadAgentActivity, loadWatchLogTail, NO_RUN_ID, type AgentActivity } from '../data.js';
import { startServer } from '../server.js';
import { renderAgents, renderAgentsLog } from '../views.js';
import { formatRuntime } from '../static/agents.js';

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

const sampleActivity: AgentActivity = {
  live: [
    {
      spawnId: 'live-1',
      runId: 'r-1',
      kind: 'implementer',
      slug: 'feat-a',
      lane: 'drain.spawnGate',
      phase: 'building',
      pid: 111,
      startedTs: T0,
      runtimeMs: 272_000,
      retries: 1,
      stale: false,
    },
  ],
  runs: [
    {
      runId: 'r-1',
      startTs: T0,
      endTs: '2026-07-03T10:10:00.000Z',
      bars: [
        {
          kind: 'implementer',
          slug: 'feat-b',
          lane: 'drain.spawnGate',
          startMs: Date.parse(T0),
          durationMs: 300_000,
          outcome: 'ok',
        },
        {
          kind: 'reviewer',
          slug: null,
          lane: 'cr.subagent-dispatch',
          startMs: Date.parse(T0) + 60_000,
          durationMs: 120_000,
          outcome: 'failed',
        },
      ],
      totals: { shipped: 1, unfinished: 0, escalated: 2 },
    },
  ],
  inbox: [
    {
      slug: 'feat-c',
      source: 'roadmap',
      reason: 'retries-exhausted',
      ts: T0,
      evidence: 'skip reason: retries-exhausted',
      suggestedAction: 'inspect sinks, then unpark',
    },
  ],
};

describe('renderAgents', () => {
  it('renders the three sections with poller anchor ids', () => {
    const html = renderAgents(sampleActivity);
    expect(html).toContain('<h1>Agents</h1>');
    expect(html).toContain('Live board');
    expect(html).toContain('Run timeline');
    expect(html).toContain('Escalation inbox');
    expect(html).toContain('id="agents-live-body"');
    expect(html).toContain('id="agents-inbox-body"');
    expect(html).toContain('id="agents-live-count"');
    expect(html).toContain('id="agents-inbox-count"');
  });

  it('renders live rows with slug link, lane, phase, runtime, retries and a log link', () => {
    const html = renderAgents(sampleActivity);
    expect(html).toContain('href="/features/feat-a"');
    expect(html).toContain('drain.spawnGate');
    expect(html).toContain('building');
    expect(html).toContain('4m 32s');
    expect(html).toContain('href="/agents/log"');
  });

  it('renders timeline bars with outcome classes and a totals line', () => {
    const html = renderAgents(sampleActivity);
    expect(html).toContain('agents-bar--ok');
    expect(html).toContain('agents-bar--failed');
    expect(html).toContain('<code>r-1</code>');
    expect(html).toContain('1 shipped · 0 unfinished · 2 escalated');
  });

  it('renders inbox rows mirroring the CLI columns', () => {
    const html = renderAgents(sampleActivity);
    expect(html).toContain('roadmap');
    expect(html).toContain('feat-c');
    expect(html).toContain('retries-exhausted');
    expect(html).toContain('inspect sinks, then unpark');
  });

  it('renders empty states for no live agents, no runs, and an empty inbox', () => {
    const html = renderAgents({ live: [], runs: [], inbox: [] });
    expect(html).toContain('no agents running');
    expect(html).toContain('no recorded runs');
    expect(html).toContain('inbox empty');
  });

  it('escapes HTML in event-sourced strings', () => {
    const evil: AgentActivity = {
      live: [
        {
          ...sampleActivity.live[0]!,
          slug: null,
          lane: '<script>alert(1)</script>',
          phase: null,
        },
      ],
      runs: [],
      inbox: [],
    };
    const html = renderAgents(evil);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderAgentsLog', () => {
  it('renders the friendly empty state when the log is absent', () => {
    const html = renderAgentsLog(null);
    expect(html).toContain('no watch log — drain running attached?');
    expect(html).not.toContain('<pre>');
  });

  it('renders the tail inside a pre, escaped', () => {
    const html = renderAgentsLog('cycle done <ok>');
    expect(html).toContain('<pre>');
    expect(html).toContain('cycle done &lt;ok&gt;');
    expect(html).toContain('shared');
  });
});

describe('formatRuntime (poller module, DOM-guarded import)', () => {
  it('formats seconds, minutes, and hours', () => {
    expect(formatRuntime(12_000)).toBe('12s');
    expect(formatRuntime(272_000)).toBe('4m 32s');
    expect(formatRuntime(3_840_000)).toBe('1h 04m');
  });
});

describe('GET /agents + /agents/log', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, baseUrl } = await startServer({ port: 0 }));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('serves the page with the Agents nav marked current', async () => {
    const res = await fetch(`${baseUrl}/agents`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<h1>Agents</h1>');
    expect(body).toMatch(/<a href="\/agents" aria-current="page">/);
    expect(body).toContain('/static/agents.js');
  });

  it('serves the log tail page', async () => {
    const res = await fetch(`${baseUrl}/agents/log`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Watch log');
  });

  it('GET /static/agents.js returns the compiled poller', async () => {
    const res = await fetch(`${baseUrl}/static/agents.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/javascript');
  });
});
