---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/research/
    - src/parallel/
    - src/cli/manifest.ts
    - src/autonomous/
    - docs/noldor/
  tests: []
  spec: docs/superpowers/specs/2026-07-01-parallel-agent-dispatch-for-research-jobs-design.md
name: Parallel-Agent Dispatch for Research Jobs
packages:
  - scripts
phase: in-progress
noldor-tier: full
---

## Summary

Noldor can fan out parallel _build_ agents (the K-concurrent drain) but has no first-class primitive for fanning out parallel _read/research_ agents — codebase research, multi-subsystem investigation, cross-file audits, "understand X before we spec it." Today an operator (or a gate/spec/plan flow) investigates these sequentially in one context: wastes wall-clock and pollutes the driving session's context. Inspired by `superpowers:dispatching-parallel-agents` — dispatch one context-isolated subagent per independent problem domain, each with focused scope + self-contained context (never inherits session history) + a required structured return, then synthesize and integrate.

**What to build (for brainstorm/spec):**

- A reusable dispatch primitive — a `noldor-dispatch-parallel` skill and/or `noldor research fanout` CLI — that takes N independent task specs, spawns one focused agent each (isolated context), enforces a structured return per agent, and synthesizes the results.
- Plug-in points: gate spec-stage ("research the codebase before writing the spec"), plan-stage investigation, `/garden` deep-dives, standalone operator research.
- Reuse existing parallel infra where it fits (drain concurrency cap, lane logging, agent-events) **without** coupling to the merge-coordinator — read agents don't write, so no worktree/merge serialization needed.
- MVP fallback (size S): a skill-only version that just codifies the pattern for the driving agent (focused scope, structured return, synthesis) — vendoring superpowers' approach adapted to Noldor. The CLI fanout primitive is the part that compounds; the spec stage decides skill-only vs CLI vs both.

**Open questions:** skill vs CLI vs both; synthesis model (one synth agent vs operator-reviewed findings table); concurrency cap + cost guardrails; relationship to harness-native Workflow/Agent tools vs a Noldor-owned wrapper; whether read-agents surface in the drain's agent-events log.

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: parallel-agent-dispatch-for-research-jobs -->

## Changelog
