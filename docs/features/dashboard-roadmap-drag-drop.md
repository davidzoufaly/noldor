---
area: tooling
category: Tooling
deps: []
links:
  code:
    - scripts/dashboard/api/atomic.ts
    - scripts/dashboard/api/blocks.ts
    - scripts/dashboard/data.ts
    - scripts/dashboard/layout.ts
    - scripts/dashboard/server.ts
    - scripts/dashboard/static/drag.ts
    - scripts/dashboard/views.ts
    - scripts/features/migrate-features.ts
    - scripts/garden/garden-detect.ts
    - scripts/utils/parse-blocks.ts
    - scripts/utils/slugify.ts
    - scripts/utils/write-blocks.ts
  spec: >-
    docs/superpowers/specs/archive/2026-05-14-dashboard-roadmap-drag-drop-design.md
  tests:
    - src/dashboard/__tests__/api-blocks.test.ts
    - src/dashboard/__tests__/dashboard-data.test.ts
    - src/dashboard/__tests__/dashboard-layout-body-styles.test.ts
    - src/dashboard/__tests__/dashboard-server.test.ts
name: Dashboard Roadmap & Backlog Drag-and-Drop
packages:
  - scripts
phase: done
noldor-tier: full
introduced: 0.5.0
---
## Summary

Drag-and-drop UI on the dashboard's `/roadmap` and `/backlog` pages, plus per-row "Promote ↑" / "Demote ↓" buttons for cross-section moves. Sits on top of the shipped Path 1 schema (file-order = priority); does NOT introduce an explicit `- priority: <int>` bullet — the explicit-field path was considered and dropped in brainstorming. Dashboard server gains its first write surface: POST endpoints that rewrite `docs/roadmap.md` / `docs/backlog.md` with per-file atomic tmp+rename writes, protected by ETag / If-Match concurrency. Drag is enabled only when the table renders in source-file order (no filters, no non-priority sort); filtered/sorted views show dimmed handles with a tooltip pointing at the activation rule. Trigger: hand-editing priorities in markdown is the friction point most worth automating now.

## User Story

As a project operator triaging the roadmap (human or agent inspecting the dashboard), I want to drag entries to reorder priority within `/roadmap` and `/backlog` and click per-row Promote ↑ / Demote ↓ buttons to move blocks across sections, so that I can shuffle priorities and shift items between roadmap and backlog without hand-editing markdown files.

## Usage

**UI**

1. Open the dashboard `/roadmap` page in source-file order (no filters, sort = `Priority` or default). A drag-handle column (`⋮⋮`) appears at the left of each row.
2. Drag a row by its handle to a new position; on drop the row reorders optimistically and the change is POSTed to `docs/roadmap.md` in the background.
3. Click the **Demote ↓** button at the right of any roadmap row to move that entry to the top of `docs/backlog.md`. The page reloads on success.
4. Open `/backlog` and click **Promote ↑** on any row to move that entry to the top of `docs/roadmap.md`.
5. Drag handles render dimmed when filters or non-priority sort are active — clear filters and switch sort back to `Priority` to re-enable drag. Cross-section buttons (Promote / Demote) work in any view.
6. On stale-view conflict (412) or write failure, the page auto-reloads to resync.

**Keyboard shortcut**

- _none for v1_ — drag is mouse-only; cross-section moves are button-driven.

**Agent API**

- _none for v1_ — agents continue to read priority via the existing dashboard parsed-data layer (`Roadmap` / `BacklogEntry` schemas). The new HTTP write endpoints (`POST /api/{roadmap,backlog}/move`, `/api/roadmap/{promote-from-backlog,demote-to-backlog}/:slug`) are callable today but no `window.charuy.*` wrapper is exposed; an agent-facing wrapper is a future enhancement.

## PRs

<!-- @prs-since-last-release: dashboard-roadmap-drag-drop -->

## Changelog

### Initial Release (v0.5.0)

#### Summary

This release ships drag-and-drop reordering for the dashboard roadmap and backlog: a new `drag.js` client served via a `/static/<file>` route, a drag-handle column with promote/demote buttons, POST endpoints for roadmap/backlog moves, and ETag plumbing wired through the dashboard layers with a drag etag refresh. Each roadmap/backlog entry now emits a stable slug, backed by a new pure write-blocks module and `slugify` relocated into `scripts/utils/`. Final polish flips phase to done with roadmap/backlog smoke shuffles, plus review fixes covering the destination-rename test, `destDepth=4` test, FD copy, spec regex, trailing-newline correctness, error-context docs, empty-slug test, deduped warnings, and `blockIndex` naming.

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-05-14-dashboard-roadmap-drag-drop-design.md`](../../docs/superpowers/specs/archive/2026-05-14-dashboard-roadmap-drag-drop-design.md)
- **Code:**
  - [`scripts/dashboard/api/atomic.ts`](../../scripts/dashboard/api/atomic.ts)
  - [`scripts/dashboard/api/blocks.ts`](../../scripts/dashboard/api/blocks.ts)
  - [`scripts/dashboard/data.ts`](../../scripts/dashboard/data.ts)
  - [`scripts/dashboard/layout.ts`](../../scripts/dashboard/layout.ts)
  - [`scripts/dashboard/server.ts`](../../scripts/dashboard/server.ts)
  - [`scripts/dashboard/static/drag.ts`](../../scripts/dashboard/static/drag.ts)
  - [`scripts/dashboard/views.ts`](../../scripts/dashboard/views.ts)
  - [`scripts/features/migrate-features.ts`](../../scripts/features/migrate-features.ts)
  - [`scripts/garden/garden-detect.ts`](../../scripts/garden/garden-detect.ts)
  - [`scripts/utils/parse-blocks.ts`](../../scripts/utils/parse-blocks.ts)
  - [`scripts/utils/slugify.ts`](../../scripts/utils/slugify.ts)
  - [`scripts/utils/write-blocks.ts`](../../scripts/utils/write-blocks.ts)
- **Tests:**
  - [`scripts/dashboard/__tests__/api-blocks.test.ts`](../../scripts/dashboard/__tests__/api-blocks.test.ts)
  - [`scripts/dashboard/__tests__/dashboard-data.test.ts`](../../scripts/dashboard/__tests__/dashboard-data.test.ts)
  - [`scripts/dashboard/__tests__/dashboard-layout-body-styles.test.ts`](../../scripts/dashboard/__tests__/dashboard-layout-body-styles.test.ts)
  - [`scripts/dashboard/__tests__/dashboard-server.test.ts`](../../scripts/dashboard/__tests__/dashboard-server.test.ts)

<!-- /generated: resources -->
