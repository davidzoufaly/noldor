---
area: tooling
category: Tooling
deps: []
entry-id: Q-0296
links:
  code: []
  spec: docs/design/specs/2026-09-24-architecture-design-phase-design.md
  tests:
    - src/design/__tests__/arch-check.test.ts
    - src/design/__tests__/arch-pen.test.ts
name: pen.dev Architecture Design Phase
packages:
  - package.json
phase: in-progress
noldor-tier: full
---
## Summary

<!-- TODO 1-3 sentences. What the feature is. -->

## Diagram

<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or
     two beside it for readers that do not render mermaid. No shape worth drawing?
     Replace this comment with: noldor:cut <reason> -->

## User Story

As an operator designing a new milestone, feature or package, I want an as-built architecture canvas I can copy, redraw and approve beside the spec — written back when the code ships and checked against the real imports — so that architecture decisions start from a current picture and the picture stays true.

## Usage

**UI**

1. Bootstrap once: create `docs/design/architecture/baseline.pen` in VS Code (pen.dev extension) and have the agent draw the four views — `context`, `containers`, `modules`, `flows` — from `docs/architecture/` and the code. Name each module box by its path (`src/cr`), each group `group: <Name>`, and each arrow `<from> -> <to>`.
2. Design a feature or package: in a `specs-only-*` / `full-*` session, `/noldor-spec` step 1.6 asks whether the change is architectural. On `required` it copies the baseline to `docs/design/architecture/<date>-<key>.pen` with pages `BASE:<view>: as-built`. Draw variants as `<view>: <name>` pages, mark each winner `FINAL:<view>: <name>`, and approve at step 7.5.
3. Design a milestone: `/noldor-milestone draft` (or `edit`) offers to sketch a target into `docs/design/architecture/milestones/<slug>.pen`, linked from the milestone's `## Architecture target` section.
4. After dragging boxes, ask the agent to fix the arrows — it runs `design arch-route` and pastes the snippet. Save first if you drew new arrows.
5. At ship, gate Step 4 writes the approved change into the baseline and runs the check.

**Agent/Programmatic API**

- `pnpm noldor checks arch-baseline` — holds the baseline's `modules` view to the code. `missing-module`, `unknown-module`, `duplicate-module`, `phantom-edge`, `dangling-edge` and `unreadable` exit 1; `undrawn-edge` is advisory; no baseline reports `absent` and exits 0. Release preflight runs it as the `arch-baseline` row (`RELEASE_SKIP_ARCH_BASELINE=1` overrides).
- `pnpm noldor design arch-route --pen <path> [--view <view>]` — prints a pencil `execute` snippet that redraws every named arrow from its boxes' live bounds.
- `pnpm noldor design arch-progress --milestone <slug>` — lists a milestone target's `to-build`, `to-remove` and `done` items against the baseline; exit 0, or 1 when a file cannot be read.
- `pnpm noldor design verdict --pen <arch .pen> --approve --surface <view>… (--spec <spec> | --milestone <slug>) --editor-page <name>…` — records the approval under `.noldor/design-approval/architecture/`; `--check`, `--reconfirm` and `--waive` work as for UI.
- `readArchPen(bytes)` (`src/design/arch-pen.ts`) — the pure reader behind all of the above.
- `moduleImportPairs(cwd)` (`src/indirection/module-pairs.ts`) — module-to-module import pairs from dependency-cruiser.

## PRs

<!-- @prs-since-last-release: architecture-design-phase -->

## Changelog
