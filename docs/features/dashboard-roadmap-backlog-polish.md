---
area: tooling
category: Tooling
deps: []
links:
  code:
    - scripts/dashboard/data.ts
    - scripts/dashboard/layout.ts
    - scripts/dashboard/server.ts
    - scripts/dashboard/static/drag.ts
    - scripts/dashboard/views.ts
    - scripts/lib/area-category.ts
  tests:
    - src/dashboard/__tests__/dashboard-data.test.ts
    - src/dashboard/__tests__/dashboard-views.test.ts
    - src/dashboard/__tests__/edge-scroll.test.ts
    - src/lib/__tests__/area-category.test.ts
name: Dashboard Roadmap/Backlog View Polish
packages:
  - scripts
phase: done
noldor-tier: specs-only
introduced: 0.5.1
---
## Summary

Bundle of five polish items on the dashboard `/roadmap` and `/backlog` surfaces — surfacing size + impact columns, surfacing category on backlog, auto-scrolling during drag-and-drop, truncating long descriptions with click-to-expand, and unifying filter apply-on-change vs apply-button behavior.

## User Story

As a maintainer browsing the project tracking dashboard, I want consistent and scannable `/roadmap` and `/backlog` table views — with cost + value signals visible at a glance, predictable filter behavior, and readable descriptions — so that I can pick priorities without scrolling forever or fighting the UI.

## Usage

Five sub-items, each shippable independently:

1. **Size + impact columns on `/roadmap` and `/backlog` tables.** Surface the `- size:` and `- impact:` fields from schema-C blocks as per-row badges or columns on both dashboard surfaces. Today the fields ship in the source markdown but the dashboard renders only name + area + type.
2. **Category column on `/backlog` table.** Add a category column to the backlog table so demote/promote decisions don't require opening the source block. Mirrors the existing category on `/features`.
3. **Auto-scroll during drag-and-drop.** When dragging items past the viewport edge in `/roadmap` (or `/backlog`), auto-scroll the page so the drop target stays reachable without manual scrolling.
4. **6-line description truncation with click-to-expand.** Truncate long description bodies in `/roadmap` and `/backlog` tables to ~6 lines with a "show more" affordance; full body shows on click. Today long descriptions blow up row height.
5. **Filter consistency — apply-on-change vs apply-button.** Audit existing filter controls on dashboard surfaces; pick one behavior (apply-on-change recommended for snappy nav) and apply it uniformly. Today some filters apply immediately, some require an explicit apply.

### Pass-2 polish refinements

Five follow-on fixes that landed after the initial pass shipped:

1. **Module-script load fix.** `/static/drag.js` is now loaded with `type="module"` — the previous classic-script tag threw `Unexpected token 'export'` and silently broke all client-side wiring (drag, buttons, description toggles).
2. **No drag-and-drop on `/backlog`.** `docs/backlog.md` is a priority-less parking lot, so drag-to-reorder UI was conceptually noise. The backlog table now exposes only the Promote button as its mutation surface; the drag column, row `draggable` attribute, and `/api/backlog/move` endpoint are gone.
3. **Easier drag-to-top.** Drop-before zone on the first row in `/roadmap` is now the full row height (was 50/50 cursor split). The previous ~20-px usable target overlapped both the sticky `thead` and the 80-px auto-scroll-up edge zone.
4. **Filter dropdown width parity.** All `<select>` controls under `form.filters` share a `min-width: 9rem` baseline so `/roadmap` and `/backlog` filter rows align visually regardless of option-text length.
5. **"Show more" placement + overflow gating.** The toggle button now sits below the description body (was above). A `ResizeObserver`-backed sweep adds `.has-overflow` to cells whose clamped span actually overflows; the button is hidden by default and only revealed on overflowing or already-expanded cells.

## PRs

<!-- @prs-since-last-release: dashboard-roadmap-backlog-polish -->

## Changelog

### Initial Release (v0.5.1)

#### Summary

Polish pass to filter widths—made widths consistent across roadmap, backlog, and features (#9)—plus pass-2 polish fixes (#5).

#### PRs

- #9: consistent filter widths across roadmap, backlog, features ([link](https://github.com/davidzoufaly/charuy/pull/9))
- #5: pass-2 polish fixes ([link](https://github.com/davidzoufaly/charuy/pull/5))

### 0.5.0 (in-progress)

#### Summary

This release unifies filter widths across the roadmap, backlog, and features views (#9) and lands pass-2 polish fixes (#5), while refactoring filter behavior to apply-on-change for all dashboard dropdowns. Descriptions now truncate to 6 lines with click-to-expand, the viewport auto-scrolls during drag-and-drop, /backlog gains a derived category column plus filter, and both /roadmap and /backlog pick up size and impact columns.

#### PRs

- #9: consistent filter widths across roadmap, backlog, features ([link](https://github.com/davidzoufaly/charuy/pull/9))
- #5: pass-2 polish fixes ([link](https://github.com/davidzoufaly/charuy/pull/5))

<!-- generated: resources -->

## Resources

- **Code:**
  - [`scripts/dashboard/data.ts`](../../scripts/dashboard/data.ts)
  - [`scripts/dashboard/layout.ts`](../../scripts/dashboard/layout.ts)
  - [`scripts/dashboard/server.ts`](../../scripts/dashboard/server.ts)
  - [`scripts/dashboard/static/drag.ts`](../../scripts/dashboard/static/drag.ts)
  - [`scripts/dashboard/views.ts`](../../scripts/dashboard/views.ts)
  - [`scripts/lib/area-category.ts`](../../scripts/lib/area-category.ts)
- **Tests:**
  - [`scripts/dashboard/__tests__/dashboard-data.test.ts`](../../scripts/dashboard/__tests__/dashboard-data.test.ts)
  - [`scripts/dashboard/__tests__/dashboard-views.test.ts`](../../scripts/dashboard/__tests__/dashboard-views.test.ts)
  - [`scripts/dashboard/__tests__/edge-scroll.test.ts`](../../scripts/dashboard/__tests__/edge-scroll.test.ts)
  - [`scripts/lib/__tests__/area-category.test.ts`](../../scripts/lib/__tests__/area-category.test.ts)

<!-- /generated: resources -->
