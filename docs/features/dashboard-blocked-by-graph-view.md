---
area: tooling
category: Tooling
deps: []
entry-id: Q-0018
links:
  code: []
  tests:
    - src/dashboard/__tests__/blocked-by.test.ts
  spec: >-
    docs/design/specs/archive/2026-07-13-dashboard-blocked-by-graph-view-design.md
name: Dashboard Blocked-By Graph View
packages:
  - scripts
phase: done
since: 2026-07-05T00:00:00.000Z
noldor-tier: specs-only
introduced: 1.0.0
---

## Summary

Surface the roadmap+backlog `blocked-by` graph as a visual dependency view on the tracking dashboard (nodes = entries, edges = blocked-by; highlight cycles flagged by the `circular-blocked-by` garden detector). Split out of the shipped `first-class-blocked-by-field` entry — the data model, validation, and cycle detector landed; the dashboard visualization was deferred as its own larger piece.

## User Story

As an operator triaging the queue, I want the roadmap+backlog blocked-by graph rendered visually on the dashboard with cycles highlighted, so that I can read dependency structure and spot deadlocks at a glance instead of cross-scanning bullet lists in two files.

## Usage

**UI**

1. Open the tracking dashboard (`pnpm noldor dashboard server`).
2. Click **Blocked-by** in the nav (after Backlog).
3. Read the graph: arrows point blocked → blocker; red nodes are cycle members; muted dashed nodes live in the backlog; dotted arrows mark dangling refs. Cycle chains are also listed as text under the graph.

**Agent/Programmatic API**

- `GET /blocked-by?format=json` → `{ nodes, edges, cycles, unlinked }` (`loadBlockedByGraph()` in `src/dashboard/data.ts`).
- `buildBlockedByGraph(roadmapRaw, backlogRaw)` (`src/garden/detectors/circular-blocked-by.ts`) — shared graph construction consumed by both the page and the `circular-blocked-by` garden detector.

## PRs

<!-- @prs-since-last-release: dashboard-blocked-by-graph-view -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/archive/2026-07-13-dashboard-blocked-by-graph-view-design.md`](../../docs/design/specs/archive/2026-07-13-dashboard-blocked-by-graph-view-design.md)
- **Tests:**
  - [`src/dashboard/__tests__/blocked-by.test.ts`](../../src/dashboard/__tests__/blocked-by.test.ts)

<!-- /generated: resources -->
