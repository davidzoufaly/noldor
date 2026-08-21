---
area: tooling
category: Tooling
deps: []
links:
  code:
    - .claude/skills/noldor-spec/
    - .claude/skills/noldor-plan/
    - src/design/
    - src/utils/markdown-sections.ts
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
    - src/design/__tests__/artifact-locate.test.ts
    - src/design/__tests__/cli-fields.test.ts
    - src/design/__tests__/ledger-fields.test.ts
    - src/design/__tests__/ledger.test.ts
    - src/design/__tests__/render-digest.test.ts
    - src/design/__tests__/render.test.ts
    - src/prep/__tests__/formats.test.ts
    - src/prep/__tests__/print-format.test.ts
    - src/utils/__tests__/markdown-sections.test.ts
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
phase: in-progress
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
- Design context during either dialogue (agent-agnostic, plain inline text): seed once with `pnpm noldor design log --slug <dialogue-slug> [--entry <roadmap-slug>] --support "<path:line> — already does X"`; before every question run `pnpm noldor design context --slug <dialogue-slug> --section "<H2 or H3 name>" [--kind plan] [--spec <path>] [--full]` and paste its stdout verbatim inside a fenced code block above the question; after every answer run `pnpm noldor design log --slug <dialogue-slug> [--resolve <O-id>] --decide "<what was settled>" --because "<why>" --instead-of "<what was rejected and why not>" --section "<heading>" [--open "<new thread>"]`. Dialogue slug is the feature slug on `*-new` paths, `<parent>-<enhancement>` on `*-attach`.
- Draft-first: the spec skeleton is written to its real path with every `pnpm noldor prep format spec` section present *before* question 1, so each question renders that heading's current draft above itself. `--because` and `--instead-of` take exactly one `--decide`; `--section` applies to every record the invocation mints.
- Per-heading sign-off: `pnpm noldor design log --slug <dialogue-slug> [--kind plan] [--spec <path>] --confirm-section "<heading>"` records the heading with a digest of the approved body, so the rendered checklist marks it `✓` and re-marks it `✎` once the prose changes. Re-run it to re-confirm after an edit, `--unconfirm-section` to withdraw. Confirming a heading the artifact does not carry exits non-zero; nothing else is gated on confirmation. In a plan dialogue `--kind plan` is required — the flag defaults to `spec`, so omitting it digests the wrong artifact.
- Reading the block: the heading under discussion renders in full with the decisions bound to it and their reasoning; every other entry collapses to its first sentence plus a `(+why)` / `(+alt)` / `(+N more)` marker naming what was withheld, and `--full` expands everything. `⚠` lines flag a `--section`, a stored tag, or a confirmation that matches no heading.
- Ledger inspection / reset: the running state lives at `.noldor/design/<slug>.md` (untracked, gitignored by `noldor init`). Read it freely; never hand-edit it — `design log` fails closed on a file it cannot parse, while `design context` degrades and flags `⚠ ledger section unparsed`.
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
  - [`src/design/`](../../src/design/)
  - [`src/utils/markdown-sections.ts`](../../src/utils/markdown-sections.ts)
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
  - [`src/design/__tests__/artifact-locate.test.ts`](../../src/design/__tests__/artifact-locate.test.ts)
  - [`src/design/__tests__/cli-fields.test.ts`](../../src/design/__tests__/cli-fields.test.ts)
  - [`src/design/__tests__/ledger-fields.test.ts`](../../src/design/__tests__/ledger-fields.test.ts)
  - [`src/design/__tests__/artifact-locate.test.ts`](../../src/design/__tests__/artifact-locate.test.ts)
  - [`src/design/__tests__/cli-fields.test.ts`](../../src/design/__tests__/cli-fields.test.ts)
  - [`src/design/__tests__/ledger-fields.test.ts`](../../src/design/__tests__/ledger-fields.test.ts)
  - [`src/design/__tests__/ledger.test.ts`](../../src/design/__tests__/ledger.test.ts)
  - [`src/design/__tests__/render-digest.test.ts`](../../src/design/__tests__/render-digest.test.ts)
  - [`src/utils/__tests__/markdown-sections.test.ts`](../../src/utils/__tests__/markdown-sections.test.ts)
  - [`src/design/__tests__/render-digest.test.ts`](../../src/design/__tests__/render-digest.test.ts)
  - [`src/design/__tests__/render.test.ts`](../../src/design/__tests__/render.test.ts)
  - [`src/prep/__tests__/formats.test.ts`](../../src/prep/__tests__/formats.test.ts)
  - [`src/prep/__tests__/print-format.test.ts`](../../src/prep/__tests__/print-format.test.ts)
  - [`src/utils/__tests__/markdown-sections.test.ts`](../../src/utils/__tests__/markdown-sections.test.ts)
  - [`src/worktrees/__tests__/create-worktree.test.ts`](../../src/worktrees/__tests__/create-worktree.test.ts)
  - [`src/worktrees/__tests__/dev-surfaces.test.ts`](../../src/worktrees/__tests__/dev-surfaces.test.ts)
  - [`src/worktrees/__tests__/down-worktree.test.ts`](../../src/worktrees/__tests__/down-worktree.test.ts)
  - [`src/worktrees/__tests__/launch-worktrees.test.ts`](../../src/worktrees/__tests__/launch-worktrees.test.ts)
  - [`src/worktrees/__tests__/open-editor.test.ts`](../../src/worktrees/__tests__/open-editor.test.ts)
  - [`src/worktrees/__tests__/up-worktree.test.ts`](../../src/worktrees/__tests__/up-worktree.test.ts)
  - [`src/worktrees/__tests__/worktree-conflicts.test.ts`](../../src/worktrees/__tests__/worktree-conflicts.test.ts)
  - [`src/worktrees/__tests__/worktree-status.test.ts`](../../src/worktrees/__tests__/worktree-status.test.ts)

<!-- /generated: resources -->
