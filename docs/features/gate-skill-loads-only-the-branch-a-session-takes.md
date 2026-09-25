---
area: tooling
category: Tooling
deps: []
entry-id: Q-0320
links:
  code: []
  plan:
    - >-
      docs/design/plans/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-part1.md
    - >-
      docs/design/plans/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-part2.md
    - >-
      docs/design/plans/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-part3.md
    - >-
      docs/design/plans/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-part4.md
  spec: >-
    docs/design/specs/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-design.md
  tests:
    - src/checks/__tests__/gate-skill-drain-contract.test.ts
    - src/checks/__tests__/skill-size.test.ts
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

As an agent running `/noldor-gate` (interactive, or as a headless drain child), I want the skill to load only the steps my session's path runs, so that I start with under half of today's 19k-token load and the rules for my path are the ones in front of me.

## Usage

**Agent/Programmatic API**

- `/noldor-gate` loads the router, `.claude/skills/noldor-gate/SKILL.md`. Its load table lists the branch files each path reads. At each fork, a `**Read now:**` line names the file to read in full before acting: `micro-chore.md`, `fast-track.md`, `attach.md`, `artifact-review.md`, `blockers.md`, `code-review.md`, `fd-close.md`, `design-writeback.md` or `autonomous.md`.
- A drain child (`/noldor-gate --drain <slug>`, `--drain <slug> --finish`, or `--resume <slug>` under `NOLDOR_DRAIN=1`) goes from the entry check straight to `docs/noldor/drain-mode.md`, which is the whole drain contract for every runner.
- `pnpm noldor skill-size check` exits 0 when every `.md` under `.claude/skills/` is within its baseline, 1 naming each file that grew or has no entry, and 3 when the baseline is missing, unreadable or from another algorithm version. It runs at pre-push in this repo only.
- `pnpm noldor skill-size baseline` re-records `.noldor/skill-size-baseline.json`. Commit it in the same push as the growth; on the micro-chore lane, inside its one commit.
- `pnpm noldor checks skill-portability` also refuses a read-now link to a missing file (`missing-branch-file`) and a skill `.md` no read-now chain reaches (`unreachable-branch-file`).

## PRs

<!-- @prs-since-last-release: gate-skill-loads-only-the-branch-a-session-takes -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-design.md`](../../docs/design/specs/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-design.md)
- **Plan:**
  - [`docs/design/plans/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-part1.md`](../../docs/design/plans/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-part1.md)
  - [`docs/design/plans/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-part2.md`](../../docs/design/plans/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-part2.md)
  - [`docs/design/plans/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-part3.md`](../../docs/design/plans/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-part3.md)
  - [`docs/design/plans/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-part4.md`](../../docs/design/plans/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-part4.md)
- **Tests:**
  - [`src/checks/__tests__/gate-skill-drain-contract.test.ts`](../../src/checks/__tests__/gate-skill-drain-contract.test.ts)
  - [`src/checks/__tests__/skill-size.test.ts`](../../src/checks/__tests__/skill-size.test.ts)

<!-- /generated: resources -->
