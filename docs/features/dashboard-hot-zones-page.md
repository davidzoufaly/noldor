---
name: Dashboard Hot Zones Page
phase: done
area: tooling
category: Tooling
packages:
  - scripts
deps: []
links:
  code:
    - src/dashboard/data.ts
    - src/dashboard/views.ts
    - src/dashboard/server.ts
    - src/dashboard/layout.ts
  tests:
    - src/dashboard/__tests__/dashboard-data.test.ts
    - src/dashboard/__tests__/dashboard-doc-surfaces.test.ts
    - src/dashboard/__tests__/dashboard-ensure.test.ts
    - src/dashboard/__tests__/dashboard-graph-health.test.ts
    - src/dashboard/__tests__/dashboard-layout-body-styles.test.ts
    - src/dashboard/__tests__/dashboard-layout-style-polish.test.ts
    - src/dashboard/__tests__/dashboard-mermaid.test.ts
    - src/dashboard/__tests__/dashboard-release-notes.test.ts
    - src/dashboard/__tests__/dashboard-render-markdown.test.ts
    - src/dashboard/__tests__/dashboard-server.test.ts
    - src/dashboard/__tests__/dashboard-skills.test.ts
    - src/dashboard/__tests__/dashboard-test-pyramid.test.ts
    - src/dashboard/__tests__/dashboard-views.test.ts
    - src/dashboard/__tests__/dashboard-worktrees.test.ts
    - src/dashboard/__tests__/metrics-view.test.ts
    - src/dashboard/__tests__/milestones-view.test.ts
    - src/dashboard/__tests__/server-cli.test.ts
  spec: lost-pre-extraction
introduced: 0.3.0
noldor-tier: full
---

## Summary

> **Merged (Q-0036):** the hot-zones page no longer has its own route — it is now a subsection of the WIP-age page at `/wip-age`. The renderer (`renderHotZones`), loader (`loadHotZones`), filters, and `?format=json` affordance are unchanged; only the route and nav entry were consolidated.

Top-N most-changed files in the last D days surfaced on the project tracking dashboard at `/wip-age` (formerly a standalone `/hot-zones` page). Single git call (`git log --since=Nd --no-merges --name-only`), in-process aggregation, lockfile + generated paths excluded, feature MDs cross-referenced via `links.code`. Where churn lives, bugs follow — points refactor and review attention at the right files.

## User Story

As a maintainer (human or agent), I want a sortable list of the files that changed most in the recent past, so I can decide where to focus refactoring, test coverage, or review.

## Usage

**UI**

1. Run `pnpm dashboard`.
2. Open `http://localhost:4321/hot-zones`.
3. Pick a window (7 / 30 / 90 days) and a row limit (1–100); click **Filter**.
4. Click any file path to open it on GitHub. Click any feature slug to drill into the feature MD page.

**Agent API**

- Endpoint: `GET /hot-zones?days=<7|30|90>&limit=<1..100>` — returns a rendered HTML table. Append `&format=json` to get the bare `HotZoneRow[]` array as `application/json`, skipping HTML parsing for agent workflows.

<!-- generated: resources -->

## Resources

- **Spec:** _lost-pre-extraction_
- **Code:**
  - [`src/dashboard/data.ts`](../../src/dashboard/data.ts)
  - [`src/dashboard/views.ts`](../../src/dashboard/views.ts)
  - [`src/dashboard/server.ts`](../../src/dashboard/server.ts)
  - [`src/dashboard/layout.ts`](../../src/dashboard/layout.ts)
- **Tests:**
  - [`src/dashboard/__tests__/dashboard-data.test.ts`](../../src/dashboard/__tests__/dashboard-data.test.ts)
  - [`src/dashboard/__tests__/dashboard-doc-surfaces.test.ts`](../../src/dashboard/__tests__/dashboard-doc-surfaces.test.ts)
  - [`src/dashboard/__tests__/dashboard-ensure.test.ts`](../../src/dashboard/__tests__/dashboard-ensure.test.ts)
  - [`src/dashboard/__tests__/dashboard-graph-health.test.ts`](../../src/dashboard/__tests__/dashboard-graph-health.test.ts)
  - [`src/dashboard/__tests__/dashboard-layout-body-styles.test.ts`](../../src/dashboard/__tests__/dashboard-layout-body-styles.test.ts)
  - [`src/dashboard/__tests__/dashboard-layout-style-polish.test.ts`](../../src/dashboard/__tests__/dashboard-layout-style-polish.test.ts)
  - [`src/dashboard/__tests__/dashboard-mermaid.test.ts`](../../src/dashboard/__tests__/dashboard-mermaid.test.ts)
  - [`src/dashboard/__tests__/dashboard-release-notes.test.ts`](../../src/dashboard/__tests__/dashboard-release-notes.test.ts)
  - [`src/dashboard/__tests__/dashboard-render-markdown.test.ts`](../../src/dashboard/__tests__/dashboard-render-markdown.test.ts)
  - [`src/dashboard/__tests__/dashboard-server.test.ts`](../../src/dashboard/__tests__/dashboard-server.test.ts)
  - [`src/dashboard/__tests__/dashboard-skills.test.ts`](../../src/dashboard/__tests__/dashboard-skills.test.ts)
  - [`src/dashboard/__tests__/dashboard-test-pyramid.test.ts`](../../src/dashboard/__tests__/dashboard-test-pyramid.test.ts)
  - [`src/dashboard/__tests__/dashboard-views.test.ts`](../../src/dashboard/__tests__/dashboard-views.test.ts)
  - [`src/dashboard/__tests__/dashboard-worktrees.test.ts`](../../src/dashboard/__tests__/dashboard-worktrees.test.ts)
  - [`src/dashboard/__tests__/metrics-view.test.ts`](../../src/dashboard/__tests__/metrics-view.test.ts)
  - [`src/dashboard/__tests__/milestones-view.test.ts`](../../src/dashboard/__tests__/milestones-view.test.ts)
  - [`src/dashboard/__tests__/server-cli.test.ts`](../../src/dashboard/__tests__/server-cli.test.ts)

<!-- /generated: resources -->

## Changelog
