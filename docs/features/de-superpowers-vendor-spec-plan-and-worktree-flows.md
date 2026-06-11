---
area: tooling
category: Tooling
deps: []
links:
  code:
    - .claude/skills/noldor-spec/
    - .claude/skills/noldor-plan/
    - src/worktrees/
    - src/prep/draft.ts
    - .claude/skills/{gate,garden,draft-feature-md}/SKILL.md
    - docs/noldor/{complexity-gating,workflow,skill-catalog}.md
  tests: []
  spec: docs/superpowers/specs/2026-06-11-de-superpowers-vendor-spec-plan-and-worktree-flows-design.md
name: "De-Superpowers: Vendor Spec, Plan and Worktree Flows"
packages:
  - scripts
phase: in-progress
noldor-tier: full
---

## Summary

The framework's core flows depend on the third-party `superpowers` Claude Code plugin. Four load-bearing uses: `superpowers:brainstorming` produces every spec (gate SKILL.md Steps for all spec paths), `superpowers:writing-plans` produces every plan, `superpowers:using-git-worktrees` does worktree creation, and — worst — `src/prep/draft.ts:18` bakes a "REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans" blockquote **into every generated plan**, so the dependency propagates into consumer repos at plan-execution time. Everything else is path naming (`docs/superpowers/specs|plans`). A consumer without the plugin cannot run the gate's spec/plan paths; an upstream plugin edit can silently change framework behavior. Vendor the flows.

## User Story

As a framework adopter (human or agent) without the superpowers Claude Code plugin, I want the gate's spec, plan, and worktree stages to run on noldor-owned skills and CLI commands, so that I can drive the full feature lifecycle in my repo with no third-party plugin prerequisite and no upstream-drift exposure.

## Usage

- Spec stage (gate-invoked or standalone): invoke the `noldor-spec` skill — dialogues to a design, writes `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md` per `pnpm noldor prep format spec`.
- Plan stage: invoke the `noldor-plan` skill — writes `docs/superpowers/plans/YYYY-MM-DD-<slug>.md` per `pnpm noldor prep format plan`.
- Worktree: `pnpm noldor worktrees create <slug>` from the main workspace (`--no-install` to skip dependency install on restores).
- Format contract inspection (any agent, any repo with noldor installed): `pnpm noldor prep format <spec|plan>`.
- Plan execution (interactive and autonomous alike): follow the plan header — execute tasks inline, commit per task, tick checkboxes.

## PRs

<!-- @prs-since-last-release: de-superpowers-vendor-spec-plan-and-worktree-flows -->

## Changelog
