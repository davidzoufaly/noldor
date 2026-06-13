---
area: tooling
category: Tooling
deps: []
links:
  code: []
  docs: []
  tests: []
  spec: >-
    docs/superpowers/specs/2026-06-13-per-task-dev-environment-bootstrap-design.md
  plan: docs/superpowers/plans/2026-06-13-per-task-dev-environment-bootstrap.md
name: Per-Task Dev Environment Bootstrap
packages:
  - scripts
phase: in-progress
noldor-tier: full
---
## Summary

Extend the worktree workflow with full per-task environment scaffolding: open IDE on the worktree folder/file, spawn a new terminal per task (already done), boot an internal web server scoped to the task's port, and start a local Charuy app instance per task. Today only the terminal spawn is automated; IDE focus and per-task app instances are manual. Goal: a single command takes an operator from "branch checked out" to "fully usable dev surface" without manual port-juggling. Pairs with the worktree port-per-tree convention from `docs/noldor/worktree-discipline.md`.

## User Story

As a solo operator running features in parallel worktrees, I want one command to
open my IDE on the task's worktree, spawn its agent terminal, and boot every dev
server scoped to that tree's port, so that I go from "branch checked out" to a
fully usable dev surface without manual port-juggling or app-boot steps.

## Usage

**CLI**

1. From the main workspace: `pnpm noldor worktrees up <slug>`
   - Creates `.worktrees/<slug>` on `feat/<slug>` if absent (reuses
     `worktrees create`), stamps a base port into `.env.local`.
   - Opens the IDE via `consumer.dev.editor.command` (e.g. `code {path}`).
   - Spawns one iTerm2 window running the configured agent — resolved from
     `agents.default` via the agent-runner registry, `claude` by default
     (reuses the launch path, now runner-resolved instead of hardcoded).
   - Boots each `consumer.dev.surfaces` entry on `basePort + portOffset`,
     probes `healthPath` until HTTP 200, leaves it running.
   - Prints a surface table (name → `http://127.0.0.1:<port><healthPath>` → ready?).
2. Skip any step: `--no-create`, `--no-editor`, `--no-terminal`, `--no-servers`.
   Override branch with `--branch <name>`.
3. Tear down when done: `pnpm noldor worktrees down <slug>` (SIGKILLs the booted
   servers). Add `--remove` to also delete the worktree + branch.

**Config** (`.noldor/config.json`, `consumer.dev`)

```json
"dev": {
  "editor": { "command": "code {path}" },
  "surfaces": {
    "web":  { "command": "pnpm dev --port {port}",         "healthPath": "/",        "portOffset": 0 },
    "api":  { "command": "pnpm api:serve --port {port}",   "healthPath": "/health",  "portOffset": 100 }
  }
}
```

**Keyboard shortcut** — _none (CLI tool)._

**Agent API** — `createWorktree`, `openEditor`, `bootDevSurfaces`, `launchTree`,
`deriveSurfacePort`, `loadDevSurfaces` are importable for programmatic drain/launch flows.

## PRs

<!-- @prs-since-last-release: per-task-dev-environment-bootstrap -->

## Changelog
