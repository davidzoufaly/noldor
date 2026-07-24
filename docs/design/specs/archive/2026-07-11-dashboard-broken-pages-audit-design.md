# Dashboard Broken-Pages Audit — Design

**Slug:** dashboard-broken-pages-audit
**FD:** docs/features/dashboard-broken-pages-audit.md
**Date:** 2026-07-11
**Tier:** specs-only
**Deps:** none

## Problem

Roadmap entry Q-0027 reported "many dashboard pages broken" and "live drain-observation view missing from the main menu (and not working when reached directly)". An empirical audit (2026-07-11, this session) could **not reproduce page breakage**: all 20 GET routes plus 123 crawled internal links return 200 with rendered content, zero `Internal error` bodies, and zero browser console errors — verified in both the noldor self-host repo (tsx source and `pnpm dashboard` launch paths) and the charuy consumer (installed `@davidzoufaly/noldor@0.5.1`). The operator confirmed the breakage impression is stale and re-scoped the entry to what the audit *did* find:

1. **Drain state is invisible.** `.noldor/drain-state.json` (phase, in-flight slugs, merging, shipped count, skip set, retries) and `.noldor/drain-park.json` (parked entries) surface nowhere in the dashboard. `/agents` (`src/dashboard/views.ts:renderAgents`) shows only agent-level rows derived from `agent-events.jsonl`.
2. **The watch-log tail is not live.** `/agents/log` (`renderAgentsLog`) renders a static `<pre>` — no auto-refresh, while the `/agents` live board polls every ~2s via `/static/agents.js`.
3. **Attached drains write no log at all.** `.noldor/watch.log` is produced only by `watch --detach`'s stdio redirect (`src/autonomous/watch-detach.ts:71`). Foreground `autonomous run`/`watch` children spawn `stdio: 'inherit'` (`src/core/agent-runner/registry.ts:135`), so the log pane shows "no watch log" exactly when an operator is most likely watching a drain.
4. **Favicon 404** — the only console error on every page (`layout.ts` head has no favicon link).
5. **No regression net.** Nothing prevents a future route from silently 500ing; the audit exists only as this session's evidence.

## Goals

- Enrich `/agents` into the first-class live drain-observation surface (operator decision — no new route).
- Surface `drain-state.json` + `drain-park.json` on `/agents`, live-updating.
- Auto-tail the watch log on `/agents` (inline pane) and `/agents/log` (deep link), ~2s poll.
- Make `.noldor/watch.log` exist for **every** drain mode by teeing attached-drain child output.
- Fix the favicon 404.
- Land a route-sweep regression test encoding the audit ("every GET route renders 200, no `Internal error`").

## Non-goals

- No new `/drain` route; no nav reshuffle beyond the `/agents` label.
- No historical drain-run analytics (the `/agents` run timeline already covers per-run outcomes).
- No log rotation/size management for `watch.log` beyond what exists (tail reads last 200 lines).
- No fixes to pages the audit proved healthy — there are none to fix.

## Design

### Unit 1 — `loadDrainObservation` (src/dashboard/data.ts)

New loader beside `loadAgentActivity` (which stays untouched for back-compat):

```ts
export interface DrainObservation {
  state: {
    pid: number; pidAlive: boolean; startedAt: string;
    phase: 'spawning' | 'awaiting-merge' | 'idle';
    inFlight: Array<{ slug: string; phase: string }>;
    merging: string | null; shipped: number;
    skip: string[]; retries: Record<string, number>;
  } | null;              // null ⇒ no drain-state.json ⇒ "no drain recorded"
  parked: Array<{ slug: string; source: string; reason: string; ts: string }>;
  logTail: string | null; // loadWatchLogTail(cwd) — null ⇒ no watch.log
}
```

Reads `.noldor/drain-state.json` (schema: `src/autonomous/drain-state.ts:DrainState`), `.noldor/drain-park.json`, and reuses `loadWatchLogTail`. **Park shape:** on disk the file is a `ParkMap = Record<string, { reason; ts }>` keyed `"${source}:${slug}"` (`src/autonomous/escalations.ts:29-33`) — `slug`/`source` are NOT stored fields. The loader reuses `loadPark` from `escalations.ts` and splits each key at the first `:` into `{ source, slug }`; a key with no `:` maps to `source: ''` + the whole key as slug (defensive convention chosen here; the branch is unreachable in practice since `parkKey` always writes `source:slug`). **Single drain-state read:** `loadAgentActivity` already parses `drain-state.json` for `retries` (`data.ts:2121-2128`); rather than parsing it twice per poll, `handleApiAgents` calls `loadDrainObservation` first and passes its parsed `retries` into `loadAgentActivity` via a new optional `deps.retries` override (falls back to its own read when absent, so existing callers/tests are untouched) — one file read per poll, `retries` shipped once. When `drain-state.json` is absent (`state: null`), `handleApiAgents` passes `state?.retries ?? {}` — an explicit empty object, not undefined — so the fallback read never fires on the poll path. `pidAlive` reuses the injected `isPidAlive` pattern from `loadAgentActivity` (`AgentActivityDeps`) so tests stub it. All three reads are individually failure-tolerant (missing/corrupt file → null / empty), matching the existing `try/catch → {}` idiom at `data.ts:2120-2127`.

### Unit 2 — `/agents` page + `/api/agents` payload (server.ts, views.ts)

- `handleApiAgents` returns `{ ...await loadAgentActivity(), drain: await loadDrainObservation() }`. Additive — existing consumers (`agents.js` poller, tests) keep working.
- `renderAgents` gains a **Drain** section above "Live board": status strip (phase badge, `running`/`dead`/`no drain recorded` from `pidAlive`, shipped count, started-at), in-flight table (slug → phase → retries), merging indicator, skip + parked lists, and an auto-tailing `<pre id="drain-log-pane">` (server-side first paint from `logTail`, no-JS safe like the rest of the page).
- `renderAgentsLog` keeps its layout; the `<pre>` gets `id="drain-log-pane"` so the same poller tails it on the deep link. Empty-state copy changes to "no watch log yet — appears once a drain starts" (the attached/detached distinction dies with Unit 4).

### Unit 3 — poller (src/dashboard/static/agents.ts)

`poll()` additionally patches `#drain-log-pane` — only when `drain.logTail !== null` (null keeps the server-rendered empty-state copy; assigning null to `textContent` blanks the pane to `""`, erasing that copy) — then pins scroll to bottom **only when the pane was already at bottom** (preserve manual scrollback) and the drain strip counters/tables (same `renderX(body, rows)` pattern as `renderLive`/`renderInbox`). `init()` now also activates on `/agents/log` (presence of `#drain-log-pane` instead of only `#agents-live-body`); on that page the poller fetches `/api/agents` and touches only the log pane.

### Unit 4 — tee attached drains (src/core/agent-runner + src/autonomous)

- `SpawnAgentOpts` (`src/core/agent-runner/types.ts:52`) gains `logSink?: string` — an absolute path to append child output to.
- `spawnAgent` (`registry.ts:94`): when `logSink` is set, child stdout/stderr become `'pipe'` and every chunk is forwarded to `process.stdout`/`process.stderr` **and** appended (single `fs.createWriteStream(..., { flags: 'a' })` per child) — terminal behavior stays identical to `inherit`, plus the file copy. When unset, behavior is byte-for-byte today's. **Tee mode never accumulates:** the existing `'pipe'` capture path (`registry.ts:158,183-185`) builds `stdout += chunk` and returns it in `AgentResult.stdout`; tee chunks are forwarded + appended only and MUST NOT feed that accumulator — `result.stdout` stays `''` exactly as the `stdio: 'inherit'` contract documents (`types.ts:86`). Otherwise an hours-long gate child would buffer its whole output in drain-loop memory. Unit-asserted alongside the stdio-tuple assertion.
- The drain loop (`src/autonomous/drain-loop.ts` spawn site) passes `logSink: join(cwd, WATCH_LOG_REL)` for **attached** runs (`run`, foreground `watch`). Detached watch keeps its whole-process stdio redirect (`watch-detach.ts`) — no double-write, because the detached child's drain loop runs with `logSink` unset (no env marker exists today — `watch-detach.ts:80` passes `env: process.env` verbatim, so add `NOLDOR_WATCH_DETACHED=1` to the daemon child's env there and gate the tee on its absence). Supervisor-level lines (spawn/retry/skip) already go to stdout, so under detach they land in the log via redirect; attached mode gets child output teed and supervisor lines mirrored with a tiny `logLine()` helper writing to both.
- `WATCH_LOG_REL` stays exported from `watch-detach.ts` (`data.ts:34` already imports it); the drain loop imports the same const — no new module needed unless an import cycle appears (then hoist it to `drain-state.ts`).
- `loadWatchLogTail`'s doc comment (`data.ts:2231-2235`, "agents run `stdio: 'inherit'`, so there is no per-agent file") is updated in the same change — Unit 4 invalidates its premise; the log stays shared-single-file, but now exists in every drain mode.

### Unit 5 — favicon (src/dashboard/layout.ts)

Inline data-URI SVG in `renderLayout` head: `<link rel="icon" href="data:image/svg+xml,...">` (single glyph, no asset file, no new route). Kills the only console error found by the audit.

### Unit 6 — route-sweep regression test (src/dashboard/__tests__/route-sweep.test.ts)

Integration test: `startServer({ port: 0 })` against this repo's docs root, iterate every GET route in `matchRoute`'s literal list (source the list from a small exported `GET_ROUTES` array in `server.ts` so the test can't drift from the router), assert status 200 and body free of `Internal error`. Plus one dynamic-detail probe per family (`/features/<first-slug>`, `/framework/<first-page>`, `/skills/<first-skill>`, `/docs/<cat>/<first-doc>`) resolved from the live tree. Carries `// @tests:` tag (self-host src-layout presence rule, PR #191).

### Data flow

Drain writes `.noldor/{drain-state.json,drain-park.json,watch.log}` → `loadDrainObservation` merges → `/api/agents` (poll ~2s) → `agents.js` patches drain strip + log pane on `/agents` and `/agents/log`. First paint always server-side.

### Error handling

Every file read tolerant (missing → empty-state copy, corrupt JSON → treated as absent); poller keeps last-good DOM on non-200/network error (existing behavior, `agents.ts:117-127`). Tee stream errors are non-fatal: `logSink` write failure logs one stderr warning and disables the sink for that child (drain must never die because a log file is unwritable).

## Acceptance criteria

- `/agents` shows drain phase, pid liveness, shipped count, in-flight slugs with retries, merging slug, skip list, and parked entries sourced from real `.noldor` files; each section has an explicit empty state when the file is absent.
- With a drain running attached (`pnpm noldor autonomous run`), `.noldor/watch.log` grows and `/agents` + `/agents/log` log panes update within ~4s without manual reload; terminal output of the drain is unchanged.
- With `watch --detach`, log content appears exactly once (no double-teed lines).
- `spawnAgent` without `logSink` spawns with today's exact stdio tuple (unit-asserted).
- Route-sweep test fails if any enumerated GET route returns non-200 or an `Internal error` body; it covers every literal route in `matchRoute` via the shared `GET_ROUTES` list.
- No browser console errors on any dashboard page (favicon resolved).
- `pnpm verify` green; new tests carry `// @tests:` tags.

## Risks / trade-offs

- **Pipe vs inherit fidelity:** piping child stdout loses TTY-ness (`isatty` false) — a child that colorizes only on TTY prints plainer attached-drain output. Acceptable: detached mode already pipes to a file, and log readability beats color.
- **watch.log growth:** attached drains now append too; no rotation. Tail-read is capped (200 lines) so the dashboard is safe; disk growth is the operator's to prune (documented in the FD Usage).
- **Poll payload size:** `/api/agents` now carries a 200-line log tail every 2s (~tens of KB). Localhost-only dashboard; acceptable. If it ever matters, an `If-None-Match` on the tail hash is the escape hatch — not built now (YAGNI).
- **Audit claim scope:** "pages healthy" is evidenced for self-host + charuy on 2026-07-11; ps-offsite was not probed. The route-sweep test guards the framework's own surface going forward, which is the durable part.

## User Story

As an operator running an autonomous drain, I want the dashboard's `/agents` page to show the live drain state (queue progress, in-flight slugs, retries, parked entries) and a self-updating log tail for every drain mode, so that I can observe and diagnose a drain from the browser without attaching a terminal or reloading pages.

## Usage

- Open the dashboard (`pnpm dashboard`), nav item **Agents** → the Drain section shows current drain status; it live-updates every ~2s.
- Deep link `http://localhost:4321/agents/log` — auto-tailing watch log (also linked from every live-board row).
- Works for `pnpm noldor autonomous run` (attached) and `pnpm noldor autonomous watch --detach` alike; the log pane states "no watch log yet — appears once a drain starts" before the first drain.
- Regression: `pnpm vitest run src/dashboard/__tests__/route-sweep.test.ts` sweeps every dashboard route.

## Open questions (resolved)

1. *Where was the reported breakage?* -> Unreproducible; operator confirmed stale impression ("can't recall — trust audit"). Scope pivots to drain observation + audit hardening. Rationale: 20 routes + 123 links + console sweep all green in two repos and two launch modes.
2. *New `/drain` page or enrich `/agents`?* -> Enrich `/agents` (operator decision). Rationale: drain and agent activity are one operational surface; avoids nav sprawl and a second poller.
3. *Fix the attached-drain log gap here or defer?* -> Fix here via `logSink` tee (operator decision). Rationale: "live observation" is false advertising when the common drain mode produces no log.
4. *Rename the nav label?* -> Keep href `/agents`, label becomes **Agents & Drain**. Rationale: discoverability of the drain view from the main menu was the entry's ask; a label tweak delivers it without breaking bookmarks.
5. *Should the route-sweep test hit dynamic detail routes?* -> Yes, one representative per family, resolved from the live tree at test time. Rationale: static-list-only sweeps miss loader regressions in detail handlers (`loadFeatureDetail` etc.) at near-zero extra cost.
