---
area: tooling
category: Agents
deps: []
entry-id: Q-0252
links:
  code: []
  tests: []
name: Scaffold One Agent-Rules File, Not Two
packages:
  - scripts
phase: in-progress
since: 2026-09-22
noldor-tier: specs-only
---

## Summary

Claude now reads `AGENTS.md`, which is the same file codex and opencode already read, so the framework no longer needs to scaffold a Claude-specific `CLAUDE.md` alongside it. Collapse the two onto one file: `noldor init` should write `AGENTS.md` and not create `CLAUDE.md` in a fresh consumer, and an existing consumer should get a migration path rather than a silently duplicated rule set — this repo itself runs the split today (`AGENTS.md` for codex/opencode, `.claude/` for Claude Code), and charuy carries the same duplication, so both need propagating. Adoption-weighted per the vision's standing tie-breaker: one agent-rules file is one less thing a new consumer has to understand, and a duplicated one is a drift source the moment the two copies disagree. Open questions for the spec: what happens to `.claude/skills/**`, which has no AGENTS.md equivalent and stays Claude-primary; and whether the migration rewrites an existing `CLAUDE.md` or leaves it and stops regenerating it. Deletion test: `noldor init` in a clean repo produces `AGENTS.md` and no `CLAUDE.md`, and a consumer that had both ends with one. (found 2026-09-22)

## Diagram

<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or
     two beside it for readers that do not render mermaid. No shape worth drawing?
     Replace this comment with: noldor:cut <reason> -->

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: scaffold-one-agent-rules-file-not-two -->

## Changelog
