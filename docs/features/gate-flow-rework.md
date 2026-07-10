---
area: tooling
category: Tooling
deps: []
links:
  code:
    - .claude/skills/noldor-gate/SKILL.md
    - docs/noldor/complexity-gating.md
    - docs/noldor/lifecycle.md
    - src/core/next-priority.ts
  tests:
    - src/core/__tests__/next-priority.test.ts
name: Gate Flow Rework
packages:
  - scripts
phase: done
noldor-tier: specs-only
introduced: 0.5.0
---

## Summary

Three-part rework of `/noldor-gate` flow combining tightly coupled changes to the gate-step ordering. (1) Step 0 priority pickup checks in-progress FDs first (FDs with `phase: in-progress` in frontmatter); if none, surface a structured suggestion set: 3 top-of-roadmap entries + 2 small×high-impact entries (XS/S size, high/critical impact) + 1 milestone-aligned high-impact entry (matches `docs/milestones/<active>.md` gate criteria) + an explicit "other" / free-form option. Today Step 0 surfaces only the single top-of-roadmap entry, which biases against quick wins and milestone alignment. (2) Every non-`micro-chore` path requires explicit confirmation after the path picker (today `AskUserQuestion` selection is implicit OK — operator sees no "are you sure?" beat before the heavy scaffolding starts; `full-new` in particular kicks off `/noldor-promote` + worktree + spec brainstorm in sequence and is expensive to abort). (3) Move worktree creation BEFORE FD scaffold (today `/noldor-promote` or `/noldor-new-feature` runs first inside `/noldor-gate` Step 2, then the worktree — an aborted gate leaves an orphaned FD on main with no worktree to host follow-up work). Bundled into one FD because all three changes touch the same gate-step ordering and a single PR is cheaper than three independent reviews.

## User Story

As an operator (human or agent) driving `/noldor-gate`:

- I want to see in-progress FDs before being shown new roadmap entries, so that I close existing loops before starting new ones.
- I want priority suggestions structured as `3 top + 2 quick wins + 1 milestone-aligned + other`, so that the surface isn't biased toward only the top-of-roadmap entry.
- I want explicit confirmation before `/noldor-gate` commits to a heavy scaffolding path, so that I can cancel before `/noldor-promote`, worktree, and brainstorm fire.
- I want the worktree to exist before the FD is scaffolded, so that an aborted gate leaves no orphaned FD on main.

## Usage

`/noldor-gate` (interactive):

1. **Priority pickup (Step 0)** — gate runs `pnpm next-priority --suggestions --json` and surfaces a two-stage `AskUserQuestion`:
   - Stage 1 picks a bucket: `In-progress` / `Top priority` / `Quick win` / `Milestone-aligned` / `Other / Cancel` (max 4 options shown; lowest-priority non-empty bucket folds into Other when count exceeds 4).
   - Stage 2 (when the chosen bucket has multiple entries) picks the specific entry.
2. **Path picker (Step 1)** — operator picks one of `micro-chore | fast-track | specs-only-new | specs-only-attach | full-new | full-attach`.
3. **Scaffold (Step 2)** — for `specs-only-new` / `full-new`: worktree created _first_, session marker written, then `/noldor-promote` runs inside the worktree. Attach paths and `fast-track` already follow worktree-first ordering.

Programmatic entry: `pnpm next-priority --suggestions --json` returns the structured suggestion set without invoking `/noldor-gate`. Exit code 2 when no in-progress FDs and no roadmap entries.

## PRs

<!-- @prs-since-last-release: gate-flow-rework -->

## Changelog

### Initial Release (v0.5.0)

#### Summary

The /noldor-gate flow was reworked with an overhaul of Step 0, Step 1.5, and Step 2.

#### PRs

- #6: /noldor-gate flow rework — Step 0/1.5/2 overhaul ([link](https://github.com/davidzoufaly/charuy/pull/6))

<!-- generated: resources -->

## Resources

- **Code:**
  - [`.claude/skills/noldor-gate/SKILL.md`](../../.claude/skills/noldor-gate/SKILL.md)
  - [`docs/noldor/complexity-gating.md`](../../docs/noldor/complexity-gating.md)
  - [`docs/noldor/lifecycle.md`](../../docs/noldor/lifecycle.md)
  - [`src/core/next-priority.ts`](../../src/core/next-priority.ts)
- **Tests:**
  - [`src/core/__tests__/next-priority.test.ts`](../../src/core/__tests__/next-priority.test.ts)

<!-- /generated: resources -->
