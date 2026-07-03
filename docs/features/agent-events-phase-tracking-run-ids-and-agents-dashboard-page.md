---
area: tooling
category: Tooling
deps: []
links:
  code: []
  docs: []
  tests: []
  spec: >-
    docs/superpowers/specs/2026-07-03-agent-events-phase-tracking-run-ids-and-agents-dashboard-page-design.md
name: 'Agent-Events Phase Tracking, Run IDs and `/agents` Dashboard Page'
packages:
  - scripts
phase: in-progress
noldor-tier: specs-only
---
## Summary

Delta rewrite 2026-07-02 — the original entry's data spine already shipped: `src/core/agent-events.ts` appends to `.noldor/agent-events.jsonl` (fail-open), every spawner writes exit events via the agent-runner registry, and `src/metrics/collect/drain-reliability.ts` already aggregates salvage counts + durations. Remaining delta:

- **Run IDs:** events lack a drain-run id, so per-run grouping is not derivable (noted blind spot in `drain-reliability.ts:35`); escalation rows share the gap. Mint a run id at drain start, thread it through spawn/exit events + escalations.
- **Phase events:** today only spawn/exit are recorded; add coarse phase events (gate stage, CR lane, merge) from the drain loop heartbeat.
- **Dashboard `/agents` page** (`src/dashboard/`): **Live board** — currently-running agents (spawned without exited, pid-liveness-checked): kind, slug, lane, phase, runtime, retry count; link per row to a log-tail view. **Run timeline** — per drain-run grouped history: spawned→exited bars, outcomes color-coded, shipped/skipped/escalated totals. Poll every ~2s in v1; SSE noted as follow-up.
- **Escalation inbox surface:** the CLI-only inbox (`noldor autonomous inbox`) gets a dashboard panel on the same page — escalations are the events an unattended operator most needs to see.

**Acceptance sketch:** run `noldor autonomous run --concurrency 2 --max-features 2`; `/agents` shows 2 live implementer rows with distinct lanes, then a timeline with 2 shipped outcomes grouped under one run id; events file has spawned/exited pairs for every agent incl. CR lanes.

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

## PRs

<!-- @prs-since-last-release: agent-events-phase-tracking-run-ids-and-agents-dashboard-page -->

## Changelog
