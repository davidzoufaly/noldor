---
area: tooling
category: Tooling
deps: []
entry-id: Q-0336
links:
  code: []
  tests: []
  spec: >-
    docs/design/specs/2026-09-29-sdd-report-honours-ownerless-on-purpose-design.md
name: SDD Report Honours Ownerless On Purpose
packages:
  - scripts
phase: in-progress
since: 2026-09-29T00:00:00.000Z
noldor-tier: specs-only
---

## Summary

ADR 0009 says a shared helper may have no owner, but the SDD report still counts it as a gap. Detector 9 ("Code files not referenced by any feature") counts every ownerless file, and detector 19 ("Done features without code") counts FDs that #636 emptied on purpose because their code lives in shared files (the five dashboard page FDs, `scripts-reorganization-by-feature-area`, `self-boundaries-declaration-and-cycle-break`). After #640 that leaves 17 + 7 rows that are honest, not gaps, so the counts stop meaning anything. Needs a way to say "ownerless on purpose" — a config list, or an FD sentinel stronger than `['n/a']` — that both detectors read. Surfaced 2026-09-26, PR #640.

## Diagram

<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or
     two beside it for readers that do not render mermaid. No shape worth drawing?
     Replace this comment with: noldor:cut <reason> -->

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: sdd-report-honours-ownerless-on-purpose -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/2026-09-29-sdd-report-honours-ownerless-on-purpose-design.md`](../../docs/design/specs/2026-09-29-sdd-report-honours-ownerless-on-purpose-design.md)

<!-- /generated: resources -->
