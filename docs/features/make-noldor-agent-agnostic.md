---
area: tooling
category: Agents
deps: []
links:
  code:
    - src/core/agent-runner/
    - src/core/agent-events.ts
    - src/templates/agent-filter.ts
    - src/cr/deep-review-spawn.ts
    - src/cr/run-codex.ts
    - src/autonomous/drain-io.ts
    - src/prep/spawn.ts
    - src/cr/lanes/subagent-dispatch.ts
    - src/release/llm-polish-summary.ts
    - src/cli/commands/init.ts
    - src/cli/commands/doctor.ts
    - src/checks/check-template-sync.ts
    - templates/.opencode/
    - templates/AGENTS.md
    - templates/opencode.json
    - docs/noldor/agent-runtimes.md
  tests:
    - src/autonomous/__tests__/drain-reconcile.test.ts
    - src/autonomous/__tests__/merge-classify.test.ts
    - src/checks/__tests__/check-template-sync.test.ts
    - src/core/__tests__/agent-events.test.ts
    - src/core/__tests__/lanes.test.ts
    - src/core/agent-runner/__tests__/doctor-runners.test.ts
    - src/core/agent-runner/__tests__/no-stray-spawns.test.ts
    - src/core/agent-runner/__tests__/opencode-events.test.ts
    - src/core/agent-runner/__tests__/registry.test.ts
    - src/core/agent-runner/__tests__/runners.test.ts
    - src/core/agent-runner/__tests__/types.test.ts
    - src/core/agent-runner/usage/__tests__/adapters.test.ts
    - src/cr/__tests__/deep-review-spawn.test.ts
    - src/cr/__tests__/lanes/subagent-dispatch.test.ts
    - src/cr/__tests__/lanes/subagent.test.ts
    - src/cr/__tests__/run-codex.test.ts
    - src/migrations/__tests__/0.7.0.test.ts
    - src/release/__tests__/llm-polish-summary.test.ts
    - src/templates/__tests__/agent-filter.test.ts
    - src/templates/__tests__/shim-inventory.test.ts
    - src/testing/__tests__/consumer-fixture.test.ts
    - src/testing/__tests__/stub-runner.test.ts
  spec: >-
    docs/superpowers/specs/archive/2026-06-11-make-noldor-agent-agnostic-design.md
name: Make Noldor Agent-Agnostic
packages:
  - scripts
phase: done
noldor-tier: full
introduced: 0.4.0
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
  "versionFloors": { "opencode": "1.17.0" },
  "targets": ["claude", "codex", "opencode"]
}
```

**CLI**

- `noldor init --agents claude,codex,opencode` — write per-driver shim sets: `.claude/skills/` (Claude skills), `.opencode/command/` (thin command shims for the CLI-verb-backed skills) + `opencode.json`, and `AGENTS.md` (codex reads the same skill set as prose).
- `noldor doctor` — template drift + presence/version-floor check for every configured runner (claude / codex / opencode).
- `noldor upgrade` — runs the `0.7.0` migration that rewrites legacy `crLanes` values (`subagent`→`reviewer`, `verify`→`verifier`).

**Agent API**

- `spawnAgent(prompt, { role, runner?, cwd, env, timeoutMs, stdio, schemaPath, needsWrite, site })` from `src/core/agent-runner/registry.ts` — resolves `opts.runner ?? resolveRunner(role, config)`, builds per-runner argv, enforces capability fit, emits one `.noldor/agent-events.jsonl` line per spawn. opencode spawns run `run --auto`; a piped (non-tee, non-inherit) spawn also passes `--format json`, and on a clean exit the registry parses the NDJSON event stream to assistant prose via `parseOpencodeEvents` (`src/core/agent-runner/opencode-events.ts`) so every consumer reads prose, not raw events.
- Inspect spawns: `tail .noldor/agent-events.jsonl` — `runner` / `role` / `site` / `exitCode` per line.

**CR lanes** — `crLanes.<kind>` uses role-ref names `reviewer` (was `subagent`) and `verifier` (was `verify`); `manual` / `codex` / `standalone` remain non-role literals. Legacy names still validate (alias preprocess in `src/core/lanes.ts`); the `0.7.0` migration canonicalizes on-disk config.

## PRs

<!-- @prs-since-last-release: make-noldor-agent-agnostic -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-06-11-make-noldor-agent-agnostic-design.md`](../../docs/superpowers/specs/archive/2026-06-11-make-noldor-agent-agnostic-design.md)
- **Code:**
  - [`src/core/agent-runner/`](../../src/core/agent-runner/)
  - [`src/core/agent-events.ts`](../../src/core/agent-events.ts)
  - [`src/templates/agent-filter.ts`](../../src/templates/agent-filter.ts)
  - [`src/cr/deep-review-spawn.ts`](../../src/cr/deep-review-spawn.ts)
  - [`src/cr/run-codex.ts`](../../src/cr/run-codex.ts)
  - [`src/autonomous/drain-io.ts`](../../src/autonomous/drain-io.ts)
  - [`src/prep/spawn.ts`](../../src/prep/spawn.ts)
  - [`src/cr/lanes/subagent-dispatch.ts`](../../src/cr/lanes/subagent-dispatch.ts)
  - [`src/release/llm-polish-summary.ts`](../../src/release/llm-polish-summary.ts)
  - [`src/cli/commands/init.ts`](../../src/cli/commands/init.ts)
  - [`src/cli/commands/doctor.ts`](../../src/cli/commands/doctor.ts)
  - [`src/checks/check-template-sync.ts`](../../src/checks/check-template-sync.ts)
  - [`templates/.opencode/`](../../templates/.opencode/)
  - [`templates/AGENTS.md`](../../templates/AGENTS.md)
  - [`templates/opencode.json`](../../templates/opencode.json)
  - [`docs/noldor/agent-runtimes.md`](../../docs/noldor/agent-runtimes.md)
- **Tests:**
  - [`src/autonomous/__tests__/drain-reconcile.test.ts`](../../src/autonomous/__tests__/drain-reconcile.test.ts)
  - [`src/autonomous/__tests__/merge-classify.test.ts`](../../src/autonomous/__tests__/merge-classify.test.ts)
  - [`src/checks/__tests__/check-template-sync.test.ts`](../../src/checks/__tests__/check-template-sync.test.ts)
  - [`src/core/__tests__/agent-events.test.ts`](../../src/core/__tests__/agent-events.test.ts)
  - [`src/core/agent-runner/__tests__/doctor-runners.test.ts`](../../src/core/agent-runner/__tests__/doctor-runners.test.ts)
  - [`src/core/agent-runner/__tests__/no-stray-spawns.test.ts`](../../src/core/agent-runner/__tests__/no-stray-spawns.test.ts)
  - [`src/core/agent-runner/__tests__/registry.test.ts`](../../src/core/agent-runner/__tests__/registry.test.ts)
  - [`src/core/agent-runner/__tests__/runners.test.ts`](../../src/core/agent-runner/__tests__/runners.test.ts)
  - [`src/core/agent-runner/__tests__/types.test.ts`](../../src/core/agent-runner/__tests__/types.test.ts)
  - [`src/core/agent-runner/usage/__tests__/adapters.test.ts`](../../src/core/agent-runner/usage/__tests__/adapters.test.ts)
  - [`src/cr/__tests__/deep-review-spawn.test.ts`](../../src/cr/__tests__/deep-review-spawn.test.ts)
  - [`src/cr/__tests__/lanes/subagent-dispatch.test.ts`](../../src/cr/__tests__/lanes/subagent-dispatch.test.ts)
  - [`src/cr/__tests__/lanes/subagent.test.ts`](../../src/cr/__tests__/lanes/subagent.test.ts)
  - [`src/cr/__tests__/run-codex.test.ts`](../../src/cr/__tests__/run-codex.test.ts)
  - [`src/release/__tests__/llm-polish-summary.test.ts`](../../src/release/__tests__/llm-polish-summary.test.ts)
  - [`src/templates/__tests__/agent-filter.test.ts`](../../src/templates/__tests__/agent-filter.test.ts)
  - [`src/testing/__tests__/consumer-fixture.test.ts`](../../src/testing/__tests__/consumer-fixture.test.ts)
  - [`src/testing/__tests__/stub-runner.test.ts`](../../src/testing/__tests__/stub-runner.test.ts)

<!-- /generated: resources -->
