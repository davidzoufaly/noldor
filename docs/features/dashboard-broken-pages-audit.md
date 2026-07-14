---
area: tooling
category: Tooling
deps: []
entry-id: Q-0027
links:
  code: []
  tests:
    - src/core/agent-runner/__tests__/registry-logsink.test.ts
    - src/dashboard/__tests__/route-sweep.test.ts
  spec: docs/design/specs/2026-07-11-dashboard-broken-pages-audit-design.md
name: Dashboard Broken-Pages Audit
packages:
  - scripts
phase: done
since: 2026-07-11T00:00:00.000Z
noldor-tier: specs-only
---
## Summary

Many dashboard pages are currently broken, and the live drain-observation view is missing from the main menu (and not working when reached directly). Audit every dashboard route, fix the broken pages, and surface live drain observation as a first-class main-menu item.

## User Story

As an operator running an autonomous drain, I want the dashboard's `/agents` page to show the live drain state (queue progress, in-flight slugs, retries, parked entries) and a self-updating log tail for every drain mode, so that I can observe and diagnose a drain from the browser without attaching a terminal or reloading pages.

## Usage

**UI**

1. Start the dashboard (`pnpm dashboard`) and open the **Agents & Drain** nav item (`/agents`).
2. The **Drain** section shows the status line (running/dead pid, phase, shipped count), the in-flight table with retries, parked entries, and a live log pane — all self-refreshing every ~2s.
3. Deep-link `/agents/log` for the full-page auto-tailing watch log.
4. Works for attached (`pnpm noldor autonomous run`, foreground `watch`) and detached (`watch --detach`) drains alike; before any drain has run, the pane reads "no watch log yet — appears once a drain starts".

**Agent/Programmatic API**

- `GET /api/agents` — JSON payload now carries `drain: { state, parked, logTail }` beside `live`/`runs`/`inbox`.
- `spawnAgent(prompt, { logSink: <path> })` — tee child stdout+stderr to an append-only file; terminal output unchanged, `result.stdout` stays `''`.
- `GET_ROUTES` (exported from `src/dashboard/server.ts`) — the routing table the route-sweep regression test iterates: `npx vitest run src/dashboard/__tests__/route-sweep.test.ts`.

## PRs

<!-- @prs-since-last-release: dashboard-broken-pages-audit -->

## Changelog

<!-- generated: resources -->

## Resources

- **Tests:**
  - [`src/core/agent-runner/__tests__/registry-logsink.test.ts`](../../src/core/agent-runner/__tests__/registry-logsink.test.ts)
  - [`src/dashboard/__tests__/route-sweep.test.ts`](../../src/dashboard/__tests__/route-sweep.test.ts)

<!-- /generated: resources -->
