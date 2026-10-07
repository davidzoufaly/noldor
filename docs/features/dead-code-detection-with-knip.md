---
area: tooling
category: Tooling
deps: []
entry-id: Q-0342
links:
  code: []
  tests: []
  spec: docs/design/specs/2026-10-07-dead-code-detection-with-knip-design.md
name: Dead-Code Detection with knip
packages:
  - scripts
phase: in-progress
since: 2026-10-07T00:00:00.000Z
noldor-tier: specs-only
---

## Summary

Nothing in the framework finds dead code (unused files, unused exports, unused and unlisted dependencies). `noldor clones` finds code that exists twice, not code that should not exist; the `/noldor-refactor` report's "Dead Code" section is filled in by hand; the dashboard already looks for an "Unused Exports" count (`src/dashboard/data.ts:2125`) that nothing produces. This feature covers noldor itself: add knip as a devDependency, run it in pre-push or CI, and ratchet it like `clones` (a recorded baseline; the count may not rise). It ships nothing to consumers — the consumer-facing opt-in check is a separate roadmap entry, to follow once this one has proved itself.

## Diagram

<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or
     two beside it for readers that do not render mermaid. No shape worth drawing?
     Replace this comment with: noldor:cut <reason> -->

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: dead-code-detection-with-knip -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/2026-10-07-dead-code-detection-with-knip-design.md`](../../docs/design/specs/2026-10-07-dead-code-detection-with-knip-design.md)

<!-- /generated: resources -->
