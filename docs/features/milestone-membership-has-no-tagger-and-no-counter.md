---
area: tooling
category: Tooling
deps: []
entry-id: Q-0255
links:
  code: []
  tests:
    - src/milestones/__tests__/assign.test.ts
    - src/milestones/__tests__/show.test.ts
    - src/utils/__tests__/write-blocks.test.ts
  spec: >-
    docs/design/specs/archive/2026-09-25-milestone-membership-has-no-tagger-and-no-counter-design.md
name: Milestone Membership Has No Tagger and No Counter
packages:
  - tooling
phase: done
since: 2026-09-22T00:00:00.000Z
noldor-tier: specs-only
---

## Summary

Milestone membership is declared twice: `- milestone:` on a roadmap/backlog block and `milestone:` in a feature MD's frontmatter. `/noldor-triage` and `/noldor-promote` set it when work is filed or promoted, but work filed before a milestone existed stayed untagged, and nothing showed how much of it there was. `pnpm noldor milestones assign` tags roadmap entries, backlog entries and feature MDs in one call. `milestones show` ends with how many roadmap entries, backlog entries and in-progress FDs name no milestone. A tagged FD counts toward the milestone's `Features (<done>/<total> done)`, and flipping it to `phase: done` raises the done count.

## Diagram

noldor:cut one CLI verb and one extra output line inside src/milestones — no boxes or flows beyond what the Usage lines state

## User Story

As an operator (human or agent) running a milestone, I want to tag already-filed roadmap entries, backlog entries and feature MDs with that milestone in one command, and see how much live work still names none, so that `milestones show` reports how far through the milestone I really am.

## Usage

**Keyboard shortcut**

- _none — CLI only_

**Agent/Programmatic API**

- `pnpm noldor milestones assign <milestone> <slug|Q-NNNN>... [--replace]` — tags each target (roadmap block, backlog block or feature MD) with the milestone and prints one `written` / `noop` / `conflict` / `not-found` / `ambiguous` line per target. Every target is checked before any file is written; any refusal writes nothing. A target already naming another milestone needs `--replace`; a name matching both a queue block and an FD needs its `Q-NNNN`. Unknown and `shipped` milestones are refused. Exit 0 tagged, 1 refused, 2 usage.
- `pnpm noldor milestones show <slug>` — ends with `Unassigned (no milestone): roadmap <n>, backlog <n>, in-progress features <n>`, printed at zero too.

## PRs

<!-- @prs-since-last-release: milestone-membership-has-no-tagger-and-no-counter -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/archive/2026-09-25-milestone-membership-has-no-tagger-and-no-counter-design.md`](../../docs/design/specs/archive/2026-09-25-milestone-membership-has-no-tagger-and-no-counter-design.md)
- **Tests:**
  - [`src/milestones/__tests__/assign.test.ts`](../../src/milestones/__tests__/assign.test.ts)
  - [`src/milestones/__tests__/show.test.ts`](../../src/milestones/__tests__/show.test.ts)
  - [`src/utils/__tests__/write-blocks.test.ts`](../../src/utils/__tests__/write-blocks.test.ts)

<!-- /generated: resources -->
