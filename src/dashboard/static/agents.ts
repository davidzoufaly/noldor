// Vanilla TS /agents poller — compiled to dist/agents.js and served by
// /static/<file>. Fetches /api/agents every ~2s and patches the live board
// and escalation inbox in place (spec D4: client fetch, not meta refresh —
// a full reload would reset scroll every 2s). First paint is server-side;
// this module no-ops on every other page.

interface LiveRowPayload {
  kind: string;
  slug: string | null;
  lane: string | null;
  phase: string | null;
  runtimeMs: number;
  retries: number;
  stale: boolean;
}

interface InboxRowPayload {
  slug: string;
  source: string;
  reason: string;
  ts: string;
  evidence: string;
  suggestedAction: string;
}

interface DrainStatePayload {
  pid: number;
  pidAlive: boolean;
  startedAt: string;
  phase: string;
  inFlight: Array<{ slug: string; phase: string }>;
  merging: string | null;
  shipped: number;
  skip: string[];
  retries: Record<string, number>;
}

interface DrainPayload {
  state: DrainStatePayload | null;
  parked: Array<{ slug: string; source: string; reason: string; ts: string }>;
  /** True ⇒ drain-park.json is corrupt; render a corruption row, not an empty list. */
  parkedCorrupt?: boolean;
  logTail: string | null;
}

interface AgentsPayload {
  live: LiveRowPayload[];
  inbox: InboxRowPayload[];
  drain?: DrainPayload;
}

/** Mirror of the server-side formatAgentDuration — exported for unit tests. */
export function formatRuntime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

function emptyRow(body: HTMLTableSectionElement, colSpan: number, text: string): void {
  const tr = body.insertRow();
  const c = tr.insertCell();
  c.colSpan = colSpan;
  c.className = 'empty';
  c.textContent = text;
}

function renderLive(body: HTMLTableSectionElement, rows: LiveRowPayload[]): void {
  body.textContent = '';
  if (rows.length === 0) {
    emptyRow(body, 7, 'no agents running');
    return;
  }
  for (const r of rows) {
    const tr = body.insertRow();
    if (r.stale) tr.className = 'row-stale';
    tr.insertCell().textContent = r.kind;
    const slugCell = tr.insertCell();
    if (r.slug === null) {
      slugCell.textContent = '—';
    } else {
      const a = document.createElement('a');
      a.href = `/features/${encodeURIComponent(r.slug)}`;
      a.textContent = r.slug;
      slugCell.appendChild(a);
    }
    const laneCell = tr.insertCell();
    if (r.lane === null) {
      laneCell.textContent = '—';
    } else {
      const code = document.createElement('code');
      code.textContent = r.lane;
      laneCell.appendChild(code);
    }
    tr.insertCell().textContent = r.phase ?? '—';
    tr.insertCell().textContent = formatRuntime(r.runtimeMs) + (r.stale ? ' (stale)' : '');
    tr.insertCell().textContent = String(r.retries);
    const logCell = tr.insertCell();
    const log = document.createElement('a');
    log.href = '/agents/log';
    log.textContent = 'log';
    logCell.appendChild(log);
  }
}

function renderInbox(body: HTMLTableSectionElement, rows: InboxRowPayload[]): void {
  body.textContent = '';
  if (rows.length === 0) {
    emptyRow(body, 5, 'inbox empty — nothing needs you');
    return;
  }
  for (const r of rows) {
    const tr = body.insertRow();
    const key = tr.insertCell();
    const code = document.createElement('code');
    code.textContent = `${r.source}:${r.slug}`;
    key.appendChild(code);
    tr.insertCell().textContent = r.reason;
    tr.insertCell().textContent = r.ts;
    tr.insertCell().textContent = r.evidence || '(none)';
    tr.insertCell().textContent = r.suggestedAction;
  }
}

function setCount(id: string, n: number): void {
  const el = document.getElementById(id);
  if (el !== null) el.textContent = String(n);
}

/** Mirror of the server-side drainStatusLine (views.ts) — exported for unit tests. */
export function drainStatusText(state: DrainStatePayload | null): string {
  if (state === null) return 'no drain recorded';
  const parts = [
    `drain ${state.pidAlive ? 'running' : 'dead'} (pid ${String(state.pid)})`,
    `phase ${state.phase}`,
    `shipped ${String(state.shipped)}`,
    `started ${state.startedAt}`,
  ];
  if (state.merging !== null) parts.push(`merging ${state.merging}`);
  if (state.skip.length > 0) parts.push(`skipped: ${state.skip.join(', ')}`);
  return parts.join(' · ');
}

function renderDrainInFlight(body: HTMLTableSectionElement, state: DrainStatePayload | null): void {
  body.textContent = '';
  if (state === null || state.inFlight.length === 0) {
    emptyRow(body, 3, 'nothing in flight');
    return;
  }
  for (const f of state.inFlight) {
    const tr = body.insertRow();
    const slugCell = tr.insertCell();
    const a = document.createElement('a');
    a.href = `/features/${encodeURIComponent(f.slug)}`;
    a.textContent = f.slug;
    slugCell.appendChild(a);
    tr.insertCell().textContent = f.phase;
    tr.insertCell().textContent = String(state.retries[f.slug] ?? 0);
  }
}

function renderDrainParked(
  body: HTMLTableSectionElement,
  parked: DrainPayload['parked'],
  corrupt: boolean,
): void {
  body.textContent = '';
  if (corrupt) {
    // Match the server-side DRAIN_PARKED_CORRUPT_COPY (views.ts): a torn park
    // file must never render as an empty "nothing parked" list (fail-open view).
    emptyRow(body, 3, '⚠ parked list unreadable — corrupt .noldor/drain-park.json');
    return;
  }
  if (parked.length === 0) {
    emptyRow(body, 3, 'nothing parked');
    return;
  }
  for (const p of parked) {
    const tr = body.insertRow();
    const key = tr.insertCell();
    const code = document.createElement('code');
    code.textContent = `${p.source}:${p.slug}`;
    key.appendChild(code);
    tr.insertCell().textContent = p.reason;
    tr.insertCell().textContent = p.ts;
  }
}

function patchDrain(drain: DrainPayload | undefined): void {
  if (drain === undefined) return;
  const status = document.getElementById('drain-status');
  if (status !== null) status.textContent = drainStatusText(drain.state);
  const inflight = document.getElementById('drain-inflight-body');
  if (inflight instanceof HTMLTableSectionElement) renderDrainInFlight(inflight, drain.state);
  const parked = document.getElementById('drain-parked-body');
  if (parked instanceof HTMLTableSectionElement)
    renderDrainParked(parked, drain.parked, drain.parkedCorrupt ?? false);
  const pane = document.getElementById('drain-log-pane');
  // null logTail keeps the server-rendered empty-state copy — assigning null
  // would blank the pane to "" and erase it.
  if (pane !== null && drain.logTail !== null) {
    const atBottom = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 4;
    pane.textContent = drain.logTail;
    // Pin to the newest lines only when the reader was already at the bottom —
    // never yank a manually scrolled-back view.
    if (atBottom) pane.scrollTop = pane.scrollHeight;
  }
}

async function poll(): Promise<void> {
  const liveBody = document.getElementById('agents-live-body');
  const inboxBody = document.getElementById('agents-inbox-body');
  try {
    const res = await fetch('/api/agents');
    if (!res.ok) return; // transient server hiccup — keep the last-good DOM
    const data = (await res.json()) as AgentsPayload;
    if (liveBody instanceof HTMLTableSectionElement) {
      renderLive(liveBody, data.live);
      setCount('agents-live-count', data.live.length);
    }
    if (inboxBody instanceof HTMLTableSectionElement) {
      renderInbox(inboxBody, data.inbox);
      setCount('agents-inbox-count', data.inbox.length);
    }
    patchDrain(data.drain);
  } catch {
    // network error — leave the last-good DOM, the next tick retries
  }
}

function init(): void {
  // /agents has the live board; /agents/log has only the log pane — poll on both.
  const onAgentsPage = document.getElementById('agents-live-body') !== null;
  const onLogPage = document.getElementById('drain-log-pane') !== null;
  if (!onAgentsPage && !onLogPage) return;
  setInterval(() => {
    void poll();
  }, 2000);
}

// Guard the auto-init so this module can be imported from non-DOM contexts
// (vitest unit-tests formatRuntime). The compiled dist/agents.js runs in the
// browser where `document` is always defined. Same pattern as drag.ts.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
