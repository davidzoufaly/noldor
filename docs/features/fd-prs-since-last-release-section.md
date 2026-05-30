---
area: tooling
category: Tooling
deps: []
links:
  code:
    - scripts/features/migrate-fd-commits-to-prs.ts
    - scripts/release/fd-prs-since-tag.ts
    - scripts/release/release-noise-types.ts
  spec: >-
    docs/superpowers/specs/archive/2026-05-22-fd-prs-since-last-release-section-design.md
  tests:
    - src/features/__tests__/migrate-fd-commits-to-prs.test.ts
    - src/release/__tests__/fd-prs-since-tag.test.ts
    - src/release/__tests__/release-noise-types.test.ts
name: FD PRs Since Last Release Section
packages:
  - scripts
phase: done
noldor-tier: full
introduced: 0.6.0
---
## Summary

Replaces the dead `## Commits` block in the feature MD scaffold with a live `## PRs` section. A new `<!-- @prs-since-last-release: <slug> -->` marker is expanded at dashboard render time into a bullet list of PRs that touched the FD since the last semver tag — hidden when zero PRs are in flight.

## User Story

As a feature author (human or agent) tracking an in-progress FD, I want the dashboard to surface PRs that have landed against the FD since the last release tag, so that I can audit work-in-flight without walking `git log` or waiting for the next release commit.

## Usage

**UI**

1. Open the dashboard view for any FD page (e.g. `/features/<slug>`).
2. The `## PRs` section renders a bullet list of PRs whose commits touch the FD's slug in the range `<lastTag>..HEAD`.
3. When the range contains zero PRs touching the slug, the entire `## PRs` block (heading + marker) is hidden from the rendered page — no "no PRs" copy.

**Keyboard shortcut**

_none for v1_ — surface is read-only render output, no input chord.

**Agent API**

_none for v1_ — the marker is a doc-side convention expanded by the dashboard's markdown renderer; there is no `window.charuy.*` method to query the PR list programmatically. If a future caller needs the list, expose `prsSinceLastTag` via the dashboard HTTP API rather than scraping the rendered MD.

## PRs

<!-- @prs-since-last-release: fd-prs-since-last-release-section -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-05-22-fd-prs-since-last-release-section-design.md`](../../docs/superpowers/specs/archive/2026-05-22-fd-prs-since-last-release-section-design.md)
- **Code:**
  - [`scripts/features/migrate-fd-commits-to-prs.ts`](../../scripts/features/migrate-fd-commits-to-prs.ts)
  - [`scripts/release/fd-prs-since-tag.ts`](../../scripts/release/fd-prs-since-tag.ts)
  - [`scripts/release/release-noise-types.ts`](../../scripts/release/release-noise-types.ts)
- **Tests:**
  - [`scripts/features/__tests__/migrate-fd-commits-to-prs.test.ts`](../../scripts/features/__tests__/migrate-fd-commits-to-prs.test.ts)
  - [`scripts/release/__tests__/fd-prs-since-tag.test.ts`](../../scripts/release/__tests__/fd-prs-since-tag.test.ts)
  - [`scripts/release/__tests__/release-noise-types.test.ts`](../../scripts/release/__tests__/release-noise-types.test.ts)

<!-- /generated: resources -->
