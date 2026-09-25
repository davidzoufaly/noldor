---
name: Scripts Reorganization By Feature/Area
phase: done
area: tooling
category: Tooling
packages:
  - scripts
deps: []
links:
  code: []
  tests:
    - src/triage/__tests__/triage-list-untriaged.test.ts
  spec: lost-pre-extraction
introduced: 0.3.0
noldor-tier: full
---

## Summary

Reorganized `scripts/` from a flat ~50-file directory into per-feature subdirectories: `release/`, `sync/`, `docs/`, `checks/`, `garden/`, `triage/`, `features/`, `worktrees/`, `graphify/`, `utils/`, `samples/` plus the existing `dashboard/`. Tests moved alongside source (`<group>/__tests__/`). The orchestrator `scripts/release.ts` became `src/release/index.ts`. All `package.json` script paths and FD MD `links.code` references updated. Lefthook config unchanged because it routes through `package.json` scripts.

Each group landed in its own commit in dependency order (utils → features → consumers → release last) so any rollback is granular. No new functionality; no public API change beyond file paths.

Unblocks broadening `src/garden/sdd-report.ts:detectCodeOrphans` to walk `scripts/` (separate follow-up — now meaningful per-script FD ownership exists).

## User Story

As a developer or agent adding a new tooling script, I want a natural home in the structure so that I don't have to invent another prefix-named flat sibling. As an FD MD author, I want `links.code` to point at coherent subdirs so that ownership is obvious without enumerating ~50 sibling files.

## Usage

The reorganization is structural — no end-user surface. Internal tools and pnpm scripts continue to work unchanged. New scripts go into the matching subdir; new tests go into `<group>/__tests__/` alongside the source.

<!-- generated: resources -->

## Resources

- **Spec:** _lost-pre-extraction_
- **Tests:**
  - [`src/triage/__tests__/triage-list-untriaged.test.ts`](../../src/triage/__tests__/triage-list-untriaged.test.ts)

<!-- /generated: resources -->

## Changelog
