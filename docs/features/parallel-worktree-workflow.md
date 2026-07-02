---
name: Parallel Worktree Workflow
phase: done
area: tooling
category: Tooling
packages:
  - scripts
deps: []
links:
  code:
    - src/checks/check-shared-files.ts
    - src/worktrees/launch-worktrees.ts
    - src/worktrees/worktree-status.ts
  tests:
    - src/checks/__tests__/check-shared-files.test.ts
    - src/worktrees/__tests__/launch-worktrees.test.ts
    - src/worktrees/__tests__/worktree-conflicts.test.ts
    - src/worktrees/__tests__/worktree-status.test.ts
  spec: lost-pre-extraction
introduced: 0.3.0
noldor-tier: full
---

## Summary

Tooling and rules for running up to three concurrent git worktrees on independent features. Adds `pnpm worktree:status` (status table + drift / overlap / cap warnings + auto port allocation in `5174-5179`), a lefthook pre-commit gate that blocks edits to shared root files from inside `.worktrees/`, a one-line `apps/web/vite.config.ts` change to honour `PORT` from `.env.local`, and a CLAUDE.md subsection codifying the parallel-worktree workflow.

## User Story

As a solo developer running multiple features in parallel via git worktrees, I want a single command that prints status across all active worktrees and a pre-commit gate that blocks simultaneous edits to shared root files, so that I can keep up to three concurrent feature branches healthy without losing track of ports, drift, or hidden conflicts.

## Usage

**CLI**

1. From any worktree (main or `.worktrees/<name>`), run `pnpm worktree:status`.
2. Output prints a table (path, branch, port, ahead/behind main, dirty count, last commit) plus warnings: cap exceeded (>3 active feature worktrees), drift (>=12 commits behind main), stale dirty changes (>1h), cross-tree file overlap, orphan worktree (branch deleted).
3. Any feature worktree missing `PORT=` in its `.env.local` is auto-assigned the lowest free integer in `5174-5179`. Main worktree implicitly holds Vite default `5173`.
4. Inside `.worktrees/<name>`, commits touching shared root files (`CLAUDE.md`, `.claude/engineering-rules.md`, `pnpm-lock.yaml`, `package.json`, `.claude/skills/**`, `.claude/commands/**`) are blocked by lefthook pre-commit. Move the edit to the main worktree, or override with `NOLDOR_ALLOW_SHARED=1`.

**Keyboard shortcut**

_none — CLI tool, not a UI feature._

**Agent API**

_none — out-of-process tooling for human or agent-driven shell sessions._

<!-- generated: resources -->

## Resources

- **Spec:** _lost-pre-extraction_
- **Code:**
  - [`src/checks/check-shared-files.ts`](../../src/checks/check-shared-files.ts)
  - [`src/worktrees/launch-worktrees.ts`](../../src/worktrees/launch-worktrees.ts)
  - [`src/worktrees/worktree-status.ts`](../../src/worktrees/worktree-status.ts)
- **Tests:**
  - [`src/checks/__tests__/check-shared-files.test.ts`](../../src/checks/__tests__/check-shared-files.test.ts)
  - [`src/worktrees/__tests__/launch-worktrees.test.ts`](../../src/worktrees/__tests__/launch-worktrees.test.ts)
  - [`src/worktrees/__tests__/worktree-conflicts.test.ts`](../../src/worktrees/__tests__/worktree-conflicts.test.ts)
  - [`src/worktrees/__tests__/worktree-status.test.ts`](../../src/worktrees/__tests__/worktree-status.test.ts)

<!-- /generated: resources -->

## Changelog
