---
area: tooling
category: Tooling
deps: []
entry-id: Q-0320
links:
  code: []
  spec: >-
    docs/design/specs/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-design.md
  tests: []
name: Gate Skill Loads Only the Branch a Session Takes
packages:
  - scripts
phase: in-progress
since: 2026-09-25T00:00:00.000Z
noldor-tier: full
---

## Summary

`.claude/skills/noldor-gate/SKILL.md` is 13,637 words (~19k tokens, 597 lines) and loads whole into every gate session, interactive or drain. By section: Step 4 end-of-flow 4,290 words, the Step 2.5 CR gate 3,236, drain and finish mode about 1,500, roadmap retirement 519, attach phase-revert 446. About a third is branches a given session never takes (drain, finish, resume, micro-chore, attach, the UI and architecture write-backs), and much of the rest is incident history an agent does not need to run a step. A rule that applies on only some paths sits deep in the file, where a long context holds it least reliably, and every drain child pays the full load. Wanted: `SKILL.md` becomes a router of roughly 3k words holding the steps every path runs, with a hard "read `<branch>.md` now" line at each fork; each branch moves to its own file in the skill folder (drain and finish can point at `docs/noldor/drain-mode.md`, the single-canonical-page answer Q-0191 weighs); incident history moves to `docs/noldor/gotchas.md` and the runbooks, each rule keeping a one-line why. `checks template-sync`, `skill-code-drift` and `checks skill-portability` must cover the branch files. Then hold the win: a skill-size ratchet in the style of `clones` / `indirection` records each `SKILL.md`'s word count and refuses a push that grows one past its baseline. Deletion test: a `specs-only-new` session reads the router plus its own branch files, under half of today's load; every rule in today's skill lives in exactly one file; and a push that adds 200 words to any `SKILL.md` is refused until the baseline is re-recorded. (found 2026-09-25 shipping Q-0233)

## Diagram

<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or
     two beside it for readers that do not render mermaid. No shape worth drawing?
     Replace this comment with: noldor:cut <reason> -->

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: gate-skill-loads-only-the-branch-a-session-takes -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-design.md`](../../docs/design/specs/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-design.md)

<!-- /generated: resources -->
