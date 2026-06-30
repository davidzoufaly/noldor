---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/features/feature-schema.ts
    - src/features/validate-features.ts
    - src/garden/detectors/milestone-shipped-incomplete.ts
    - src/garden/garden-detect.ts
    - src/garden/garden-detect-runner.ts
    - src/dashboard/server.ts
    - src/dashboard/layout.ts
    - src/dashboard/data.ts
    - src/dashboard/views.ts
  docs:
    - docs/noldor/milestones.md
  tests:
    - src/garden/detectors/__tests__/milestone-shipped-incomplete.test.ts
    - src/features/__tests__/feature-milestone.test.ts
    - src/dashboard/__tests__/milestones-view.test.ts
  spec: >-
    docs/superpowers/specs/2026-06-14-framework-milestones-support-poc-mvp-100-design.md
name: Framework Milestones Support (POC / MVP / 1.0.0)
packages:
  - scripts
phase: done
noldor-tier: specs-only
---
## Summary

Add a milestones layer to Noldor — tracking which features belong to which milestone (POC / MVP / 1.0.0 today; arbitrary names if `decouple-milestones-from-semver` lands first). Surfaces in `/triage` (proposed milestone per bullet), in FD frontmatter (`milestone: <name>`), in `/garden` (flag features whose milestone has shipped but phase is not done), and in dashboard pages. Pairs with `vision.md`'s current-milestone field.

- Optional, not mandatory — apps can grow organically without a milestone plan; the framework should not force the abstraction. When milestones are declared, the rest of the wiring activates; otherwise the field stays absent and detectors stay silent.
- Surface milestones on the dashboard web UI.
- Document where milestones live (the `/milestone` skill + `docs/milestones/<slug>.md`) — answers the recurring "where are milestones documented?".

## User Story

As an operator running a milestone-planned Noldor project, I want each feature to optionally declare which milestone it belongs to and to see that membership surfaced in triage, garden, and the dashboard, so that I can tell at a glance whether a milestone is truly shipped or still has open features — without the framework forcing milestones on projects that grow organically.

## Usage

**Declare membership** — add `milestone: mvp` to an FD's frontmatter (or let `/promote` copy it from a triaged roadmap block). The slug must match a `docs/milestones/<slug>.md` file.

**Triage** — `/triage` proposes `- milestone: <active-slug>` per roadmap bullet when an active milestone is set; override or drop per row. `/promote` lifts the line into the FD.

**Garden** — `pnpm garden:detect` flags any feature whose milestone is `status: shipped` but `phase != done`.

**Dashboard** — open `/milestones` (nav: **Milestones**) for milestones grouped by status with member-feature roll-ups; the `/features` list shows a milestone chip per feature. Empty-state shown when no milestones exist.

**Manage milestones** — unchanged: `/milestone draft|activate|edit|list` (see `docs/noldor/milestones.md`).

**Keyboard shortcut** — _none._
**Agent API** — _none; operates through FD frontmatter, `pnpm` scripts, and the dashboard HTTP routes._

## PRs

<!-- @prs-since-last-release: framework-milestones-support-poc-mvp-100 -->

## Changelog
