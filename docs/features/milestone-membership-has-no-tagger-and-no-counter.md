---
area: tooling
category: Tooling
deps: []
entry-id: Q-0255
links:
  code: []
  tests: []
  spec: >-
    docs/design/specs/2026-09-25-milestone-membership-has-no-tagger-and-no-counter-design.md
name: Milestone Membership Has No Tagger and No Counter
packages:
  - tooling
phase: in-progress
since: 2026-09-22T00:00:00.000Z
noldor-tier: specs-only
---

## Summary

Milestone membership rots by omission at both ends of the chain, so an active milestone cannot answer how far through it is. **Entry side:** `validate:triage` catches a *typo'd* milestone slug well — an injected bad slug produced 11 `unknown-milestone-ref` errors, and `lefthook/noldor.yml` runs the check on every roadmap/backlog commit — but nothing notices an entry carrying **no** `milestone:` at all. In a consumer mid-milestone, 50 of 54 roadmap entries had none, so `milestones show <active>` listed 4 queued items. The only related command, `features attach-milestone`, is a *verdict* (entry vs parent FD) rather than a tagger, so the fix today is hand-editing N blocks. **Feature side:** `Features (n/n done)` is structurally always `0/0`, because nothing writes a milestone onto a feature MD — `milestones show` renders the section and the schema supports it, but no command sets the field and `/noldor-milestone` only manages the milestone *files*. Candidates: a `milestones assign <slug> <entry…>` for the entry side; have the gate stamp the milestone onto the FD at attach time for the feature side (`attach-milestone` already computes the verdict, so it knows the value) and let `phase-flip-done` move the counter; and surface an unassigned-entry count from `milestones show` or the sdd-report so the gap is visible without a bespoke script. Deletion test: `milestones show <active>` reports a non-zero feature count and names how many queued entries carry no milestone. (found 2026-09-22)

## Diagram

<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or
     two beside it for readers that do not render mermaid. No shape worth drawing?
     Replace this comment with: noldor:cut <reason> -->

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: milestone-membership-has-no-tagger-and-no-counter -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/2026-09-25-milestone-membership-has-no-tagger-and-no-counter-design.md`](../../docs/design/specs/2026-09-25-milestone-membership-has-no-tagger-and-no-counter-design.md)

<!-- /generated: resources -->
