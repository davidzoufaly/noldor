---
area: tooling
category: Agents
deps: []
links:
  code: []
  tests:
    - src/core/__tests__/agent-events.test.ts
    - src/core/agent-runner/__tests__/doctor-runners.test.ts
    - src/core/agent-runner/__tests__/no-stray-spawns.test.ts
    - src/core/agent-runner/__tests__/registry.test.ts
    - src/core/agent-runner/__tests__/runners.test.ts
    - src/core/agent-runner/__tests__/types.test.ts
    - src/templates/__tests__/agent-filter.test.ts
  spec: docs/superpowers/specs/2026-06-11-make-noldor-agent-agnostic-design.md
name: Make Noldor Agent-Agnostic
packages:
  - scripts
phase: in-progress
noldor-tier: full
---
## Summary

Noldor today assumes Claude Code as the operating agent (skill names, hook patterns, transcript layout). Lift the assumptions so Codex, Gemini, or other agents can drive the same framework with equivalent gates. Concrete asks: (1) abstract skill invocation (`Skill` tool vs `activate_skill` vs raw markdown read), (2) abstract hook triggers (the `lefthook` pre-commit chain works for all, but the auto-gate behavior is Claude-only), (3) document the agent-equivalence matrix in `docs/noldor/`. Trigger: when a second agent adopts Noldor in earnest (today's automated-cr-pipeline already runs Codex as a reviewer; controller is still Claude).

## User Story

As a Noldor consumer (human operator or autonomous agent), I want every framework agent spawn to resolve through a role-based runner registry covering Claude Code, Codex, and opencode, so that I can pick or mix runtimes per role — including local models via opencode — without touching framework code, and without the framework silently re-welding itself to one vendor.

## Usage

**Config** (`.noldor/config.json`, opt-in — absent block keeps today's behavior):

```jsonc
"agents": {
  "default": "claude",
  "roles": {
    "reviewer": { "runner": "codex" },
    "polish":   { "runner": "opencode", "model": "ollama/llama3.2" }
  },
  "versionFloors": { "opencode": "0.6.0" },
  "targets": ["claude", "codex", "opencode"]
}
```

**CLI**

- `noldor init --agents claude,codex,opencode` — write per-driver shim sets (`.claude/`, `.opencode/command/` + `opencode.json`, `AGENTS.md`).
- `noldor doctor` — template drift + presence/version-floor check for every configured runner.

**Agent API**

- `spawnAgent(prompt, { role, runner?, cwd, env, timeoutMs, stdio, schemaPath, needsWrite, site })` from `src/core/agent-runner/registry.ts` — resolves `opts.runner ?? resolveRunner(role, config)`, builds per-runner argv, enforces capability fit, emits one `.noldor/agent-events.jsonl` line per spawn.
- Inspect spawns: `tail .noldor/agent-events.jsonl` — `runner` / `role` / `site` / `exitCode` per line.

## PRs

<!-- @prs-since-last-release: make-noldor-agent-agnostic -->

## Changelog
