# Agent-Events Phase Tracking, Run IDs and `/agents` Dashboard Page — Design

**Slug:** agent-events-phase-tracking-run-ids-and-agents-dashboard-page
**FD:** docs/features/agent-events-phase-tracking-run-ids-and-agents-dashboard-page.md
**Date:** 2026-07-03
**Tier:** specs-only
**Deps:** none (attaches to parent FD `docs/features/project-tracking-dashboard.md`)

## Problem

The agent-events data spine shipped, but it answers "what ran" only in aggregate — not "what is running now" or "what happened in run X":

- `src/core/agent-events.ts` appends one row per **completed** spawn (`appendAgentEvent` is called only in the `'close'` handler at `src/core/agent-runner/registry.ts:172`). There is no `spawned` row, so a live board ("spawned without exited") is not derivable from the log at all today.
- Events carry no drain-run id. `src/metrics/collect/drain-reliability.ts:35` lists this as an explicit blind spot: "EscalationRow has no run identifier — per-run escalation grouping is not derivable". The same gap applies to agent-event rows.
- The only phase signal is `.noldor/drain-state.json` — a live snapshot overwritten per heartbeat (`writeState` in `src/autonomous/drain-state.ts:76`), so phase *history* (when did slug X move building → awaiting-merge → merged) evaporates.
- The escalation inbox is CLI-only (`noldor autonomous inbox`, `src/autonomous/inbox-cli.ts` over `readInboxRows` in `src/autonomous/escalations.ts:216`). An unattended operator watching the dashboard never sees the events that most need attention.

## Goals

1. Every agent-event and escalation row minted during a drain run carries that run's id; per-run grouping becomes a pure log query.
2. The event log gains `spawned` rows (with pid) and coarse `phase` rows (building / awaiting-merge / merging / merged), making live state and per-run timelines derivable from `.noldor/agent-events.jsonl` alone.
3. A `/agents` dashboard page shows: live board (running agents), per-run timeline, and the escalation inbox — polling every ~2s.
4. All writes stay fail-open (the `appendAgentEvent` contract); all readers stay back-compat with pre-existing rows.

## Non-goals

- SSE / websockets — v1 polls; SSE is a noted follow-up.
- Per-agent stdout/stderr capture. Gate children run `stdio: 'inherit'` (`registry.ts:126`); v1's log-tail links to the shared `.noldor/watch.log` (`WATCH_LOG_REL`, `src/autonomous/watch-detach.ts:10`). Per-agent log files are a separate entry.
- Event-log rotation/retention (called out as this entry's *concern* in the `agent-events.ts` header comment, but deferred — see open question 5; follow-up seeded in ideas.md at implementation time).
- Backfilling run ids onto historical rows; pre-existing rows group under a "(no run id)" bucket.
- Token/cost display on `/agents` (metrics page owns token reporting).

## Design

### Unit 1 — Run id: mint + thread (`src/autonomous/queue-drain.ts`, `src/autonomous/watch.ts`, `src/core/agent-runner/registry.ts`)

- Mint at drain start where `startedAt` is already minted (`queue-drain.ts:117`): `runId = \`${startedAt}.${process.pid}\`` — sortable, collision-free, human-legible. `watch` mints one runId **per cycle** (each cycle is one `runDrain` invocation).
- Transport: the drain's `spawnGate` wrapper (built in `queue-drain.ts`, calling `spawnGate` from `src/autonomous/drain-io.ts:193`) merges `NOLDOR_RUN_ID: runId` into the env it passes down. `spawnAgent` (`registry.ts:93`) resolves `opts.env?.NOLDOR_RUN_ID ?? process.env.NOLDOR_RUN_ID` and stamps `runId` on every event row it writes. Because the gate child inherits the env, **nested** spawns inside the child (CR lanes at `src/cr/lanes/verify-dispatch.ts:74` and `src/cr/lanes/subagent-dispatch.ts:82`, prep, etc.) pick the same runId up from `process.env` with zero changes at those call sites. Note: this does not violate the PR #33 "directives ride the prompt" rule — runId is passive telemetry correlation, not a behavioral directive; the agent never reads it.
- Escalations: add optional `runId?: string` to `EscalationRow` (`src/autonomous/escalations.ts:16`); `mapCycle`'s `row()` helper (`escalations.ts:82`) takes it from a new input field, and the `queue-drain.ts` / `watch.ts` shells pass the run's id into `mapCycle`'s input. Salvage rows (`src/autonomous/salvage.ts:89,209`) read `process.env.NOLDOR_RUN_ID` via the same registry-level resolution — they call `appendAgentEvent` directly, so those two call sites add the field explicitly.
- `drain-reliability.ts`: delete the "rows carry no run id" blind spot (line 35), add per-run grouping to `history` (`runs: Record<runId, {shipped-ish counts, escalations}>` is optional scope — minimum bar is removing the blind spot and keying `samples` rows with `runId`).

### Unit 2 — Event vocabulary: `spawned` / `exited` rows + spawnId (`src/core/agent-events.ts`, `src/core/agent-runner/registry.ts`)

- Extend `AgentEvent`: `event?: 'spawned' | 'exited' | 'phase'` (absent ⇒ `'exited'`, which makes every historical row parse correctly), `runId?: string`, `spawnId?: string`, `pid?: number`, `phase?: string`. `exitCode` / `durationMs` / `timedOut` become optional (only meaningful on `exited` rows); the doc comment states the per-event field contract.
- `spawnAgent` mints `spawnId = crypto.randomUUID()` per call. In the existing `onSpawn` guard (`registry.ts:131`, where `child.pid` is known) it appends a `spawned` row: `{event:'spawned', ts, runner, role, site, runId, spawnId, pid}`. The `'close'` handler's existing append (`registry.ts:172`) gains `{event:'exited', runId, spawnId}`. Spawned↔exited pairing is by `spawnId` — pid alone is unsafe (reuse).
- `slug` on both rows when the caller passes it: add optional `slug` to `SpawnAgentOpts` (`src/core/agent-runner/types.ts`) and have the drain's `spawnGate` wrapper pass the candidate slug (it already receives per-slug env from `envFor` at `src/autonomous/drain-loop.ts:168` — the wrapper closes over the slug via the same plumbing, or reads `NOLDOR_DRAIN_SLUG`; the K=1 path passes the slug explicitly since `NOLDOR_DRAIN_SLUG` is K>1-only).
- Reader updates: `drain-reliability.ts` durations filter to `event === 'exited' || event === undefined` rows (a `spawned` row has no `durationMs` and must not drag the mean to 0 — `durations` at line 12 currently maps blindly).

### Unit 3 — Phase events from the heartbeat tap (`src/autonomous/queue-drain.ts`, `src/autonomous/watch.ts`)

- No `runDrain` change. The shells already wrap `deps.writeState` (`queue-drain.ts:174` → `projectDrainState`). Wrap once more with a **phase-diff tap**: keep a `Map<slug, phase>` of the last-seen `inFlight` phases (plus `merging`); on each snapshot, for every slug whose phase changed (including appearing as `building` and disappearing after `merging` → treat disappearance-after-merge as `merged`), append `{event:'phase', ts, runId, slug, phase, runner:'-', role:'drain', site:'drain.heartbeat'}` via `appendAgentEvent` (fail-open, per contract).
- Coarse vocabulary v1: `building`, `awaiting-merge`, `merging`, `merged`. CR-lane visibility does **not** need its own phase rows — CR lanes are real spawns and produce `spawned`/`exited` rows with `site: 'cr.verify-dispatch' | 'cr.subagent-dispatch'`, which the dashboard renders as the "lane" column. (The entry body says "gate stage, CR lane, merge"; gate stage = `building`, CR lane = derived from spawn-row `site`, merge = `merging`/`merged`.)

### Unit 4 — Data loader + JSON endpoint (`src/dashboard/data.ts`, `src/dashboard/server.ts`, `src/dashboard/api/`)

- `loadAgentActivity(cwd)` in `data.ts`: parse `.noldor/agent-events.jsonl` (line-tolerant, skip corrupt lines — same posture as `readJsonl` in `src/metrics/facts.ts:177`), `.noldor/drain-state.json` (retry counts, `startedAt`), and `readInboxRows(cwd)` (reused verbatim from `src/autonomous/escalations.ts` — no logic duplication). Derives:
  - **live**: `spawned` rows with no matching `exited` `spawnId`, filtered by pid-liveness (`process.kill(pid, 0)` in try/catch); each with kind (role), slug, lane (site), phase (latest `phase` row for its slug), runtime (`now - ts`), retry count (`drain-state.retries[slug]`).
  - **runs**: rows grouped by `runId` (missing → `"(no run id)"`), newest first; per run: spawned→exited bars (ts + durationMs), outcome color key (exit 0 / non-zero / timedOut / salvaged kind), totals (shipped/skipped from the run's final phase rows + escalation rows sharing the runId).
- `GET /api/agents` returns that structure as JSON. Route registered next to the existing `/api/roadmap/*` block (`server.ts:169`). Read-only — no CSRF/atomic concerns (the `src/dashboard/api/atomic.ts` machinery is for mutations only).

### Unit 5 — `/agents` page + poll + log tail (`src/dashboard/server.ts`, `src/dashboard/views.ts`, `src/dashboard/layout.ts`, `src/dashboard/static/`)

- Route `if (pathname === '/agents')` → `handleAgents` following the `handleWorktrees` pattern (`server.ts:754`): `loadAgentActivity` → `renderAgents` → `RouteResult`. Nav entry `{ href: '/agents', label: 'Agents' }` in `NAV_LINKS` (`layout.ts:1`), placed next to Worktrees.
- `renderAgents(activity)` in `views.ts`: three sections — **Live board** (table: kind, slug, lane, phase, runtime, retries, log link — sticky-header/zebra style shared with other tables), **Run timeline** (per-run group: horizontal bars scaled to run duration, color-coded outcomes, totals line), **Escalation inbox** (table of `InboxRow`s: slug, reason, ts, evidence, suggestedAction — mirrors `inbox-cli` columns).
- Poll: a small static module (`src/dashboard/static/agents.ts`, compiled to `static/dist/agents.js` like `drag.ts` — note the explicit-fmt gotcha on `dist/`) fetches `/api/agents` every ~2s and re-renders the live board + inbox counts in place. Full page render stays server-side for no-JS first paint; the poller only patches. SSE noted as follow-up in the FD.
- Log tail: `GET /agents/log` renders the last ~200 lines of `.noldor/watch.log` (path from `WATCH_LOG_REL`) in a `<pre>`; live-board rows link there. Absent file → friendly empty state ("no watch log — drain running attached?").

### Tests

- `src/core/agent-runner/__tests__/`: spawned+exited pair share `spawnId`; runId picked up from `opts.env` and from `process.env`; back-compat — row without `event` treated as exited by readers.
- `src/autonomous/__tests__/`: phase-diff tap emits building → awaiting-merge → merged sequence from synthetic snapshots, dedupes unchanged phases; `mapCycle` rows carry runId.
- `src/metrics/__tests__/`: drain-reliability mean-duration ignores `spawned`/`phase` rows.
- `src/dashboard/__tests__/dashboard-agents.test.ts`: loader pairs/filters correctly (dead pid excluded from live), `/agents` renders 3 sections, `/api/agents` returns JSON, `/agents/log` empty state.

## Acceptance criteria

- Run `noldor autonomous run --concurrency 2 --max-features 2` against a stub source: `/agents` shows 2 live implementer rows with distinct lanes while building; after the run, the timeline shows 2 shipped outcomes grouped under **one** runId.
- `.noldor/agent-events.jsonl` contains a `spawned` and an `exited` row (shared `spawnId`, same `runId`) for **every** agent of the run, including CR-lane spawns (`site: cr.*`) launched inside the gate child.
- `phase` rows record building → awaiting-merge → merging → merged transitions per slug, stamped with the runId.
- New escalation rows carry `runId`; `noldor autonomous inbox` output is unchanged; the same rows render in the `/agents` inbox panel.
- `metrics` drain-reliability no longer lists the run-id blind spot; mean duration unchanged by the new non-exited rows.
- Pre-existing event rows (no `event`/`runId` fields) still parse; timeline shows them under "(no run id)".
- All event/phase writes remain fail-open: an unwritable `.noldor/` never fails a spawn or the drain loop.

## Risks / trade-offs

- **Event-log schema drift**: making `exitCode`/`durationMs`/`timedOut` optional weakens the type for existing writers; mitigated by the `event`-absent-⇒-exited convention plus reader-side filters, and by keeping salvage/registry writers explicit.
- **pid reuse**: liveness by `process.kill(pid, 0)` can false-positive on a recycled pid; mitigated by pairing on `spawnId` first (only unpaired spawns are candidates) and a staleness ceiling (spawned > timeoutMs ago ⇒ shown as stale, not live).
- **Env transport**: runId rides env, while PR #33 mandates prompt-riding for *directives*. Telemetry ≠ directive, but the distinction must be documented in `registry.ts` so a future refactor doesn't "fix" it onto the prompt.
- **Log growth**: phase rows add ~4 lines per slug per run; rotation is deferred (non-goal) — acceptable at current volume, follow-up seeded.
- **watch.log tail is shared**, not per-agent — rows at K=2 interleave; v1 accepts this (labelled as such in the UI).

## User Story

As an operator running unattended drains, I want a live `/agents` dashboard page showing currently-running agents, per-run timelines keyed by run id, and the escalation inbox, so that I can see what the autonomous pipeline is doing right now — and what it needs from me — without tailing JSONL files or running CLI commands.

## Usage

**UI**

1. `pnpm dashboard` → open `http://localhost:4321/agents` (nav: **Agents**).
2. **Live board**: one row per running agent — kind, slug, lane (spawn site), phase, runtime, retry count; click the log link for a `.noldor/watch.log` tail view (`/agents/log`).
3. **Run timeline**: one group per drain run (newest first) — spawned→exited bars, outcomes color-coded, shipped/skipped/escalated totals.
4. **Escalation inbox**: same rows as `noldor autonomous inbox` — slug, reason, evidence, suggested action.
5. The page self-refreshes every ~2s (client poll of `/api/agents`); no reload needed.

**Agent API**

- `GET /api/agents` — JSON `{ live, runs, inbox }` for programmatic introspection.
- `.noldor/agent-events.jsonl` rows now carry `event` (`spawned`/`exited`/`phase`), `runId`, `spawnId`, `pid` — grep/jq per-run with `jq 'select(.runId=="<id>")'`.

**Keyboard shortcut**

- _none_ — browser surface.

## Open questions (resolved)

1. *How does the runId reach agents spawned **inside** the gate child process (CR lanes, prep), which the drain loop never touches directly?* -> **(D1)** Env inheritance: drain injects `NOLDOR_RUN_ID` into the gate child's env; `spawnAgent` resolves `opts.env ?? process.env`, so every nested registry spawn stamps the same id with zero call-site changes. Prompt-riding (PR #33) is for directives; a passive correlation id in env is the cheapest correct transport.
2. *How are spawned and exited rows paired, given pids get recycled?* -> **(D2)** Registry mints a `spawnId` (`crypto.randomUUID()`) per `spawnAgent` call, stamped on both rows; pid is carried only for liveness checks. UUID pairing is immune to pid reuse and needs no cross-process coordination.
3. *What does the live board's "log-tail view" link to when agents have no per-agent log files (stdio inherit)?* -> **(D3)** v1 links to a tail of the shared `.noldor/watch.log` (`/agents/log`), labelled as shared; per-agent log capture is a separate entry. Capturing per-agent stdout would change the spawn contract (`stdio: 'inherit'` is load-bearing for attached runs) — too invasive for this M.
4. *Poll mechanism: full-page meta refresh or client fetch?* -> **(D4)** Client fetch of a new `GET /api/agents` JSON endpoint every ~2s, patching the DOM — meta refresh resets scroll and re-renders markdown-heavy chrome every 2s. The `static/drag.ts → dist` pipeline already exists for client modules.
5. *The `agent-events.ts` header says rotation/retention is this entry's concern — include it?* -> **(D5)** Defer; update that comment to point at a follow-up entry. Volume is ~tens of lines per run; rotation adds file-swap complexity to a fail-open writer and is orthogonal to every goal here.
6. *How do historical rows (no runId, no event field) render?* -> **(D6)** `event` absent ⇒ `exited`; runId absent ⇒ grouped under a "(no run id)" bucket at the bottom of the timeline. Cheap, honest, and avoids any backfill migration.
7. *Does `watch` mint one runId per process or per cycle?* -> **(D7)** Per cycle — each cycle is one `runDrain` with its own outcome totals, and "run timeline" groups are only meaningful at that granularity; a week-long watch process as one run would make the timeline useless.
