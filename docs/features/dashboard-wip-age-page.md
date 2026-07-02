---
name: Dashboard WIP Age Page
phase: done
area: tooling
category: Tooling
packages:
  - scripts
deps: []
links:
  code:
    - src/dashboard/data.ts
    - src/dashboard/layout.ts
    - src/dashboard/server.ts
    - src/dashboard/views.ts
  tests:
    - src/dashboard/__tests__/dashboard-data.test.ts
    - src/dashboard/__tests__/dashboard-server.test.ts
    - src/dashboard/__tests__/dashboard-views.test.ts
introduced: 0.3.0
noldor-tier: specs-only
---

## Summary

For each `phase: in-progress` feature, compute days since the feature MD was first committed via `git log --diff-filter=A --format=%ct -- docs/features/<slug>.md`. Bucket each row as `fresh` (<7d), `aging` (7-13d), or `stale` (≥14d). Catches stalled work — `phase: in-progress` in FD frontmatter is the canonical signal (the roadmap carries no in-progress tracker; the `## Now / ## Next / ## Later` section split was retired 2026-05-13 in favor of a flat priority list).

## User Story

As the founder reviewing what's actually moving, I want to see every in-progress feature ranked by how long it's been open, so that stalled work surfaces before it gets buried under fresher commitments and so I can decide whether to push it, demote it back to backlog, or accept it's a longer slog.

## Usage

- Open the dashboard (`pnpm dashboard`) and click **WIP age** in the top nav, or visit `/wip-age` directly.
- The header counter strip shows total in-progress count plus per-bucket totals (fresh / aging / stale).
- The table lists each feature once, sorted by age desc, with name (linked to its feature MD page), area, age in days, and a colored bucket badge. Stale rows (≥14d) get a tinted background.
- Age comes from `git log --diff-filter=A --format=%ct -- docs/features/<slug>.md` — the timestamp of the first commit that introduced the feature MD. Features whose MD is uncommitted are skipped (no creation timestamp yet).
- Thresholds live in `WIP_AGE_THRESHOLDS` (`src/dashboard/data.ts`); change once if the cadence shifts.

<!-- generated: resources -->

## Resources

- **Code:**
  - [`src/dashboard/data.ts`](../../src/dashboard/data.ts)
  - [`src/dashboard/layout.ts`](../../src/dashboard/layout.ts)
  - [`src/dashboard/server.ts`](../../src/dashboard/server.ts)
  - [`src/dashboard/views.ts`](../../src/dashboard/views.ts)
- **Tests:**
  - [`src/dashboard/__tests__/dashboard-data.test.ts`](../../src/dashboard/__tests__/dashboard-data.test.ts)
  - [`src/dashboard/__tests__/dashboard-server.test.ts`](../../src/dashboard/__tests__/dashboard-server.test.ts)
  - [`src/dashboard/__tests__/dashboard-views.test.ts`](../../src/dashboard/__tests__/dashboard-views.test.ts)

<!-- /generated: resources -->

## Changelog
