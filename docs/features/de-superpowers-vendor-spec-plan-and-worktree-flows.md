---
area: tooling
category: Tooling
deps: []
links:
  code:
    - .claude/skills/noldor-spec/
    - .claude/skills/noldor-plan/
    - src/worktrees/
    - src/prep/draft.ts
    - src/prep/formats.ts
    - src/prep/print-format.ts
    - .claude/skills/noldor-gate/SKILL.md
    - .claude/skills/noldor-garden/SKILL.md
    - .claude/skills/noldor-draft-feature-md/SKILL.md
    - docs/noldor/complexity-gating.md
    - docs/noldor/workflow.md
    - docs/noldor/skill-catalog.md
  tests:
    - src/prep/__tests__/formats.test.ts
    - src/prep/__tests__/print-format.test.ts
    - src/worktrees/__tests__/create-worktree.test.ts
    - src/worktrees/__tests__/dev-surfaces.test.ts
    - src/worktrees/__tests__/down-worktree.test.ts
    - src/worktrees/__tests__/launch-worktrees.test.ts
    - src/worktrees/__tests__/open-editor.test.ts
    - src/worktrees/__tests__/up-worktree.test.ts
    - src/worktrees/__tests__/worktree-conflicts.test.ts
    - src/worktrees/__tests__/worktree-status.test.ts
  spec: >-
    docs/design/specs/archive/2026-06-11-de-superpowers-vendor-spec-plan-and-worktree-flows-design.md
name: 'De-Superpowers: Vendor Spec, Plan and Worktree Flows'
packages:
  - scripts
phase: done
noldor-tier: full
introduced: 0.4.0
---

## Summary

The framework's core flows depend on the third-party `superpowers` Claude Code plugin. Four load-bearing uses: `superpowers:brainstorming` produces every spec (gate SKILL.md Steps for all spec paths), `superpowers:writing-plans` produces every plan, `superpowers:using-git-worktrees` does worktree creation, and — worst — `src/prep/draft.ts:18` bakes a "REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans" blockquote **into every generated plan**, so the dependency propagates into consumer repos at plan-execution time. Everything else is path naming (`docs/design/specs|plans`). A consumer without the plugin cannot run the gate's spec/plan paths; an upstream plugin edit can silently change framework behavior. Vendor the flows.

## User Story

As a framework adopter (human or agent) without the superpowers Claude Code plugin, I want the gate's spec, plan, and worktree stages to run on noldor-owned skills and CLI commands, so that I can drive the full feature lifecycle in my repo with no third-party plugin prerequisite and no upstream-drift exposure.

## Usage

- Spec stage (gate-invoked or standalone): invoke the `noldor-spec` skill — dialogues to a design, writes `docs/design/specs/YYYY-MM-DD-<slug>-design.md` per `pnpm noldor prep format spec`.
- Plan stage: invoke the `noldor-plan` skill — writes `docs/design/plans/YYYY-MM-DD-<slug>.md` per `pnpm noldor prep format plan`.
- Worktree: `pnpm noldor worktrees create <slug>` from the main workspace (`--branch <name>` overrides the default `feat/<slug>` naming — the gate's fast-track path passes `fast/<desc>`; `--no-install` skips dependency install on restores).
- Format contract inspection (any agent, any repo with noldor installed): `pnpm noldor prep format <spec|plan>`.
- Plan execution (interactive and autonomous alike): follow the plan header — execute tasks inline, commit per task, tick checkboxes.

## PRs

<!-- @prs-since-last-release: de-superpowers-vendor-spec-plan-and-worktree-flows -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/archive/2026-06-11-de-superpowers-vendor-spec-plan-and-worktree-flows-design.md`](../../docs/design/specs/archive/2026-06-11-de-superpowers-vendor-spec-plan-and-worktree-flows-design.md)
- **Code:**
  - [`.claude/skills/noldor-spec/`](../../.claude/skills/noldor-spec/)
  - [`.claude/skills/noldor-plan/`](../../.claude/skills/noldor-plan/)
  - [`src/worktrees/`](../../src/worktrees/)
  - [`src/prep/draft.ts`](../../src/prep/draft.ts)
  - [`src/prep/formats.ts`](../../src/prep/formats.ts)
  - [`src/prep/print-format.ts`](../../src/prep/print-format.ts)
  - [`.claude/skills/noldor-gate/SKILL.md`](../../.claude/skills/noldor-gate/SKILL.md)
  - [`.claude/skills/noldor-garden/SKILL.md`](../../.claude/skills/noldor-garden/SKILL.md)
  - [`.claude/skills/noldor-draft-feature-md/SKILL.md`](../../.claude/skills/noldor-draft-feature-md/SKILL.md)
  - [`docs/noldor/complexity-gating.md`](../../docs/noldor/complexity-gating.md)
  - [`docs/noldor/workflow.md`](../../docs/noldor/workflow.md)
  - [`docs/noldor/skill-catalog.md`](../../docs/noldor/skill-catalog.md)
- **Tests:**
  - [`src/prep/__tests__/formats.test.ts`](../../src/prep/__tests__/formats.test.ts)
  - [`src/prep/__tests__/print-format.test.ts`](../../src/prep/__tests__/print-format.test.ts)
  - [`src/worktrees/__tests__/create-worktree.test.ts`](../../src/worktrees/__tests__/create-worktree.test.ts)
  - [`src/worktrees/__tests__/dev-surfaces.test.ts`](../../src/worktrees/__tests__/dev-surfaces.test.ts)
  - [`src/worktrees/__tests__/down-worktree.test.ts`](../../src/worktrees/__tests__/down-worktree.test.ts)
  - [`src/worktrees/__tests__/launch-worktrees.test.ts`](../../src/worktrees/__tests__/launch-worktrees.test.ts)
  - [`src/worktrees/__tests__/open-editor.test.ts`](../../src/worktrees/__tests__/open-editor.test.ts)
  - [`src/worktrees/__tests__/up-worktree.test.ts`](../../src/worktrees/__tests__/up-worktree.test.ts)
  - [`src/worktrees/__tests__/worktree-conflicts.test.ts`](../../src/worktrees/__tests__/worktree-conflicts.test.ts)
  - [`src/worktrees/__tests__/worktree-status.test.ts`](../../src/worktrees/__tests__/worktree-status.test.ts)

<!-- /generated: resources -->
