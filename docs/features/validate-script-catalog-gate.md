---
area: tooling
category: Tooling
deps: []
entry-id: Q-0042
links:
  code: []
  tests: []
name: Validate Script-Catalog Gate
packages:
  - scripts
phase: in-progress
since: 2026-07-13
noldor-tier: specs-only
---

## Summary

Deep-audit finding (batch `.noldor/research/2026-07-13-184850`): gated docs stay true, ungated docs rot — `validate skill-catalog` keeps the skill catalog perfectly 1:1, while `docs/noldor/script-catalog.md` (self-declared canonical) is missing ~20 live subcommands and its promised `validate:script-catalog` gate was never implemented (the page falsely claims a backlog entry exists). Ship the `validate:script-catalog` pre-commit gate mirroring the skill-catalog one, do the one-time catch-up of the missing subcommands, fix the template twin, and resolve the detector-count contradiction (script-catalog says 19, garden-and-drift says 20, code has more).

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: validate-script-catalog-gate -->

## Changelog
