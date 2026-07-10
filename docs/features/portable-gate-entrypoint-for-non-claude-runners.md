---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/autonomous/drain-io.ts
    - src/autonomous/drain-source.ts
    - src/autonomous/gate-prompt.ts
    - src/core/agent-runner/capabilities.ts
    - src/core/agent-runner/types.ts
  docs:
    - docs/noldor/drain-mode.md
  tests:
    - src/autonomous/__tests__/drain-source.test.ts
    - src/autonomous/__tests__/gate-prompt.test.ts
    - src/core/agent-runner/__tests__/runners.test.ts
  spec: >-
    docs/superpowers/specs/2026-07-03-portable-gate-entrypoint-for-non-claude-runners-design.md
name: Portable Gate Entrypoint for Non-Claude Runners
packages:
  - scripts
phase: done
noldor-tier: specs-only
introduced: 0.5.0
---
## Summary

The autonomous drain's spawn layer is agent-agnostic (the registry resolves bin + argv for `claude` / `codex` / `opencode`), but the *prompt* it spawns is `/noldor-gate --drain <slug>` — a Claude Code slash-command (`src/autonomous/drain-source.ts:98`). On `codex` (prompt via stdin, no slash-command system) the string is treated as literal text → no gate runs. On `opencode` it only works if a `/noldor-gate` command is vendored into `.opencode/command/` (not present). So the multi-runner promise stops short of the autonomous drain: only claude can actually drive the gate headlessly. PR #119's portable CLIs (`features phase-flip-done`, `phase-revert`, `roadmap remove-block`) cover the gate's *manual steps* but not the drain entrypoint itself. Options: (a) a portable `noldor gate --drain <slug>` CLI entrypoint the drain spawns instead of a slash-command, with the agent CLI wrapping it; or (b) per-runtime vendoring of a `/noldor-gate` command alongside the existing skill. Strategic per the 2026-07 audit: harness-neutrality is the defensible layer.

## User Story

As an operator whose `.noldor/config.json` maps the `implementer` role to codex or opencode, I want `noldor autonomous run` to spawn gate children with a prompt those runners can actually execute, so that the autonomous drain works on my configured runner instead of silently degrading to a literal-text prompt that ships nothing.

## Usage

```bash
# Configure a non-claude implementer (consumer repo)
# .noldor/config.json → "agents": { "roles": { "implementer": { "runner": "codex" } } }

# Drain exactly as today — prompt shape now follows the resolved runner:
pnpm noldor autonomous run --source roadmap        # codex child gets prose drain directive
pnpm noldor autonomous run --source plans          # prose resume directive (feat/<slug>)
pnpm noldor autonomous run --source roadmap --dry-run   # unchanged; prompts not spawned

# Claude consumers: zero change — children still get `/noldor-gate --drain <slug>`.

# Canonical prose referent (what a non-claude child is told to read):
docs/noldor/drain-mode.md
```

Agent API: none new — `DrainSource.gatePrompt(slug)` keeps its signature; `buildDrainGatePrompt` / `buildResumeGatePrompt` exported from `src/autonomous/gate-prompt.ts` for tests and future entry points.

## PRs

<!-- @prs-since-last-release: portable-gate-entrypoint-for-non-claude-runners -->

## Changelog

### Initial Release (v0.5.0)

#### Summary

This release adds the `promptDispatch` runner capability (#151).

#### PRs

- #151: add promptDispatch runner capability ([link](https://github.com/davidzoufaly/noldor/pull/151))

