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

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: de-superpowers-vendor-spec-plan-and-worktree-flows -->

## Changelog
