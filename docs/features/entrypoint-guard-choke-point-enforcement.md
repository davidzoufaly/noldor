---
area: tooling
category: Tooling
deps: []
entry-id: Q-0221
links:
  code: []
  tests: []
  spec: >-
    docs/design/specs/2026-09-28-entrypoint-guard-choke-point-enforcement-design.md
name: Entrypoint-Guard Choke-Point Enforcement
packages:
  - scripts
phase: in-progress
since: 2026-09-08T00:00:00.000Z
noldor-tier: specs-only
---

## Summary

Q-0126 swept all 42 direct-invocation guards under `src/` behind `isEntrypoint` in `src/core/cli-entry.ts`, but shipped **no enforcement**: nothing mechanical stops a new entrypoint from hand-rolling the comparison again, and when that comparison is wrong the module runs nothing and exits 0, so the failure is invisible. The class is known to regrow — over the three weeks Q-0126 sat filed, two sites migrated away from the broken template and two new ones arrived carrying it.

## Diagram

<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or
     two beside it for readers that do not render mermaid. No shape worth drawing?
     Replace this comment with: noldor:cut <reason> -->

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: entrypoint-guard-choke-point-enforcement -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/2026-09-28-entrypoint-guard-choke-point-enforcement-design.md`](../../docs/design/specs/2026-09-28-entrypoint-guard-choke-point-enforcement-design.md)

<!-- /generated: resources -->
