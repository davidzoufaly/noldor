---
area: tooling
category: Agents
deps: []
links:
  code: []
  tests: []
  spec: >-
    docs/superpowers/specs/2026-06-11-make-noldor-agent-agnostic-design.md
name: Make Noldor Agent-Agnostic
packages:
  - scripts
phase: in-progress
noldor-tier: full
---

## Summary

Noldor today assumes Claude Code as the operating agent (skill names, hook patterns, transcript layout). Lift the assumptions so Codex, Gemini, or other agents can drive the same framework with equivalent gates. Concrete asks: (1) abstract skill invocation (`Skill` tool vs `activate_skill` vs raw markdown read), (2) abstract hook triggers (the `lefthook` pre-commit chain works for all, but the auto-gate behavior is Claude-only), (3) document the agent-equivalence matrix in `docs/noldor/`. Trigger: when a second agent adopts Noldor in earnest (today's automated-cr-pipeline already runs Codex as a reviewer; controller is still Claude).

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: make-noldor-agent-agnostic -->

## Changelog
