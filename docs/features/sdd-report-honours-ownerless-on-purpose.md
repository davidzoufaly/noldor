---
area: tooling
category: Tooling
deps: []
entry-id: Q-0336
links:
  code:
    - src/garden/sdd-report.ts
  tests:
    - src/core/__tests__/consumer-config.test.ts
    - src/garden/__tests__/sdd-report.test.ts
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

ADR 0009 says a shared helper may have no owner, but the SDD report still counts it as a gap. Detector 9 ("Code files not referenced by any feature") counts every ownerless file, and detector 19 ("Done features without code") counts FDs that #636 emptied on purpose because their code lives in shared files (the five dashboard page FDs, `scripts-reorganization-by-feature-area`, `self-boundaries-declaration-and-cycle-break`). Honest rows and real gaps sit in one list, so the counts stop meaning anything. This feature adds a `consumer.ownerless` config block that both detectors read, each entry with a reason, plus a check that flags an entry once it stops being true. Of the 20 file rows on 2026-09-29, 10 shared helpers are declared and 10 are real gaps (PR #666 gave five of those an owner, so five rows remain); all 7 FD rows are declared. Surfaced 2026-09-26, PR #640.

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
- **Code:**
  - [`src/garden/sdd-report.ts`](../../src/garden/sdd-report.ts)
- **Tests:**
  - [`src/core/__tests__/consumer-config.test.ts`](../../src/core/__tests__/consumer-config.test.ts)
  - [`src/garden/__tests__/sdd-report.test.ts`](../../src/garden/__tests__/sdd-report.test.ts)

<!-- /generated: resources -->
