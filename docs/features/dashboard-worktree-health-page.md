---
name: Dashboard Worktree Health Page
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
    - scripts/worktrees/worktree-status.ts
  tests:
    - src/dashboard/__tests__/dashboard-worktrees.test.ts
  spec: >-
    docs/superpowers/specs/archive/2026-05-04-dashboard-worktree-health-page-design.md
introduced: 0.3.0
noldor-tier: full
---
## Summary

Surface `pnpm worktree:status` output as a page — tree path, branch, port, drift, dirty, file-overlap warnings. Critical now that parallel-worktree-workflow shipped; running the script is fine, viewing it in-browser alongside the rest of project state is better.

## User Story

As a developer working in a parallel-worktree workflow, I want to view live worktree health (paths, ports, drift, dirty files, warnings) in the dashboard at `http://localhost:4321/worktrees`, so that I do not need to context-switch to a terminal to see why my parallel feature work has gone yellow.

## Usage

**UI**

1. Run `pnpm dashboard` to start the dashboard server.
2. Open `http://localhost:4321/worktrees` (or click **Worktrees** in the top nav).
3. The status table lists the main worktree and each `.worktrees/<name>` tree with path, branch (GitHub compare link), dev port, ahead/behind vs `main`, an expandable dirty file list, and last commit.
4. Click the `↗` icon next to a feature branch to jump to that feature's MD.
5. Click a `<details>` summary cell to expand the dirty file list inline.
6. Below the table, a Warnings section lists cap-exceeded, drift (≥12 commits behind), stale dirty (>1h), and pairwise file overlap between feature trees — only present when applicable.

**Keyboard shortcut**

- _none — read-only page; navigation handled by browser._

**Agent API**

- _none — page is read-only; agents needing the same data call `loadWorktreeHealth()` from `scripts/dashboard/data.ts` directly, or run `pnpm worktree:status`._

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-05-04-dashboard-worktree-health-page-design.md`](../../docs/superpowers/specs/archive/2026-05-04-dashboard-worktree-health-page-design.md)
- **Code:**
  - [`scripts/dashboard/data.ts`](../../scripts/dashboard/data.ts)
  - [`scripts/dashboard/views.ts`](../../scripts/dashboard/views.ts)
  - [`scripts/dashboard/server.ts`](../../scripts/dashboard/server.ts)
  - [`scripts/dashboard/layout.ts`](../../scripts/dashboard/layout.ts)
  - [`scripts/worktrees/worktree-status.ts`](../../scripts/worktrees/worktree-status.ts)
- **Tests:**
  - [`scripts/dashboard/__tests__/dashboard-worktrees.test.ts`](../../scripts/dashboard/__tests__/dashboard-worktrees.test.ts)

<!-- /generated: resources -->

## Changelog
