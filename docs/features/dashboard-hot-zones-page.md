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
    - scripts/dashboard/data.ts
    - scripts/dashboard/views.ts
    - scripts/dashboard/server.ts
    - scripts/dashboard/layout.ts
  tests:
    - src/dashboard/__tests__/dashboard-data.test.ts
    - src/dashboard/__tests__/dashboard-server.test.ts
    - src/dashboard/__tests__/dashboard-views.test.ts
  spec: docs/superpowers/specs/archive/2026-05-04-dashboard-hot-zones-page-design.md
introduced: 0.3.0
noldor-tier: full
---
## Summary

Top-N most-changed files in the last D days surfaced on the project tracking dashboard at `/hot-zones`. Single git call (`git log --since=Nd --no-merges --name-only`), in-process aggregation, lockfile + generated paths excluded, feature MDs cross-referenced via `links.code`. Where churn lives, bugs follow — points refactor and review attention at the right files.

## User Story

As a maintainer (human or agent), I want a sortable list of the files that changed most in the recent past, so I can decide where to focus refactoring, test coverage, or review.

## Usage

**UI**

1. Run `pnpm dashboard`.
2. Open `http://localhost:4321/hot-zones`.
3. Pick a window (7 / 30 / 90 days) and a row limit (1–100); click **Filter**.
4. Click any file path to open it on GitHub. Click any feature slug to drill into the feature MD page.

**Agent API**

- Endpoint: `GET /hot-zones?days=<7|30|90>&limit=<1..100>` — returns a rendered HTML table. JSON variant deferred (see backlog).

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-05-04-dashboard-hot-zones-page-design.md`](../../docs/superpowers/specs/archive/2026-05-04-dashboard-hot-zones-page-design.md)
- **Code:**
  - [`scripts/dashboard/data.ts`](../../scripts/dashboard/data.ts)
  - [`scripts/dashboard/views.ts`](../../scripts/dashboard/views.ts)
  - [`scripts/dashboard/server.ts`](../../scripts/dashboard/server.ts)
  - [`scripts/dashboard/layout.ts`](../../scripts/dashboard/layout.ts)
- **Tests:**
  - [`scripts/dashboard/__tests__/dashboard-data.test.ts`](../../scripts/dashboard/__tests__/dashboard-data.test.ts)
  - [`scripts/dashboard/__tests__/dashboard-server.test.ts`](../../scripts/dashboard/__tests__/dashboard-server.test.ts)
  - [`scripts/dashboard/__tests__/dashboard-views.test.ts`](../../scripts/dashboard/__tests__/dashboard-views.test.ts)

<!-- /generated: resources -->

## Changelog
