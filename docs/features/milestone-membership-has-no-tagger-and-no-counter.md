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

Milestone membership rots by omission at both ends of the chain, so an active milestone cannot answer how far through it is. **Entry side:** `validate:triage` catches a *typo'd* milestone slug well — an injected bad slug produced 11 `unknown-milestone-ref` errors, and `lefthook/noldor.yml` runs the check on every roadmap/backlog commit — but nothing notices an entry carrying **no** `milestone:` at all. In a consumer mid-milestone, 50 of 54 roadmap entries had none, so `milestones show <active>` listed 4 queued items. The only related command, `features attach-milestone`, is a *verdict* (entry vs parent FD) rather than a tagger, so the fix today is hand-editing N blocks. **Feature side:** `Features (n/n done)` is structurally always `0/0`, because nothing writes a milestone onto a feature MD — `milestones show` renders the section and the schema supports it, but no command sets the field and `/noldor-milestone` only manages the milestone *files*. Candidates: a `milestones assign <slug> <entry…>` for the entry side; have the gate stamp the milestone onto the FD at attach time for the feature side (`attach-milestone` already computes the verdict, so it knows the value) and let `phase-flip-done` move the counter; and surface an unassigned-entry count from `milestones show` or the sdd-report so the gap is visible without a bespoke script. Deletion test: `milestones show <active>` reports a non-zero feature count and names how many queued entries carry no milestone. (found 2026-09-22)

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
