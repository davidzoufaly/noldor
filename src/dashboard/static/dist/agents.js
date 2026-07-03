// Vanilla TS /agents poller — compiled to dist/agents.js and served by
// /static/<file>. Fetches /api/agents every ~2s and patches the live board
// and escalation inbox in place (spec D4: client fetch, not meta refresh —
// a full reload would reset scroll every 2s). First paint is server-side;
// this module no-ops on every other page.
/** Mirror of the server-side formatAgentDuration — exported for unit tests. */
export function formatRuntime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}
function emptyRow(body, colSpan, text) {
  const tr = body.insertRow();
  const c = tr.insertCell();
  c.colSpan = colSpan;
  c.className = 'empty';
  c.textContent = text;
}
function renderLive(body, rows) {
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
function renderInbox(body, rows) {
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
function setCount(id, n) {
  const el = document.getElementById(id);
  if (el !== null) el.textContent = String(n);
}
async function poll() {
  const liveBody = document.getElementById('agents-live-body');
  const inboxBody = document.getElementById('agents-inbox-body');
  if (!(liveBody instanceof HTMLTableSectionElement)) return;
  try {
    const res = await fetch('/api/agents');
    if (!res.ok) return; // transient server hiccup — keep the last-good DOM
    const data = await res.json();
    renderLive(liveBody, data.live);
    setCount('agents-live-count', data.live.length);
    if (inboxBody instanceof HTMLTableSectionElement) {
      renderInbox(inboxBody, data.inbox);
      setCount('agents-inbox-count', data.inbox.length);
    }
  } catch {
    // network error — leave the last-good DOM, the next tick retries
  }
}
function init() {
  if (document.getElementById('agents-live-body') === null) return; // not the /agents page
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
