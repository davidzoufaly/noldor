---
area: tooling
category: Tooling
deps: []
entry-id: Q-0030
links:
  code: []
  tests: []
name: Skill-vs-Code Drift Detector
packages:
  - scripts
phase: in-progress
since: 2026-07-11
noldor-tier: specs-only
---

## Summary

Skills reference CLI commands, `package.json` scripts, and `src/` paths that rot after reorgs (release-sweep needed a full path audit, PR #124; the gate skill body carried the same class of drift). Add a garden detector that scans `.claude/skills/**/SKILL.md` + `templates/.claude/skills/**` for `pnpm <script>` invocations not in `package.json` scripts, `noldor <sub>` commands not in the CLI manifest, and repo-relative paths that don't exist. Carried out of the drained release-sweep-skill-path-audit roadmap entry.

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: skill-vs-code-drift-detector -->

## Changelog
