---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/utils/parse-blocks.ts
    - src/dashboard/data.ts
    - src/triage/validate-triage.ts
  tests:
    - src/utils/__tests__/parse-blocks.test.ts
    - src/triage/__tests__/validate-triage.test.ts
name: Roadmap Priority Ordering
packages:
  - scripts
phase: done
noldor-tier: specs-only
introduced: 0.5.0
---

## Summary

Add a framework-level priority for roadmap and backlog items: file-order = priority. Before the 2026-05-13 restructure (`replace-roadmap-buckets-with-flat-priority-order`) this FD shipped against per-section scopes (`## Now` / `## Next` / `## Later`) on the roadmap; that section split was later retired in favor of a single whole-file flat list. The current contract is: priority is whole-file (no sub-buckets), and cross-file moves between roadmap ↔ backlog are first-class and bidirectional (a backlog item promotes onto the roadmap, a roadmap item demotes back to the parking lot). The move preserves the body and re-derives priority from the new location.

## User Story

As the maintainer (or an agent) triaging work, I want the priority of a roadmap or backlog entry to be defined by its position in the markdown file, so that reordering happens through a single cut-and-paste edit and there is no `priority:` field to keep in sync across rebases or branches.

## Usage

**Markdown edits**

- Reorder within a section: move the entry's `### <Name>` (backlog or roadmap H3) or `#### <Name>` (roadmap H4 under an H3 category) block up or down in the source file. Higher in the file = higher priority.
- Promote a backlog entry onto the roadmap: cut the block from `docs/backlog.md`, paste it at the chosen position in `docs/roadmap.md` (the flat priority list; file order = priority). Drop the `phase` bullet if present — roadmap blocks carry no `phase` field. (Before the 2026-05-13 restructure this step required choosing a `## Now` / `## Next` / `## Later` section; that split is gone.)
- Demote a roadmap entry: cut the block, paste into `docs/backlog.md`. Keep the rest of the body untouched.

**Validator**

- `pnpm validate:triage` — default mode. Roadmap requires `size` + `impact` (errors when missing). Backlog keeps them as advisories until backfill completes.
- `pnpm validate:triage --strict` — promotes the remaining backlog `size`/`impact` advisories to errors. Flip the pre-commit hook to `--strict` once `docs/backlog.md` is fully backfilled.

**Pre-commit hook**

- Runs automatically on any commit touching `docs/roadmap.md` or `docs/backlog.md`. Default mode; roadmap missing-`size`/`impact` blocks, backlog missing-`size`/`impact` warns. Duplicate-name + other missing-required-field issues block on both.

## PRs

<!-- @prs-since-last-release: roadmap-priority-ordering -->

## Changelog

### Initial Release (v0.5.0)

#### Summary

This release tightens the schema discipline across the roadmap and backlog pipeline: roadmap entries now require size + impact while backlog stays advisory, and a new validate:triage CLI (defaulting to advisory mode) enforces this. The dashboard was refactored to delegate to the shared parseRoadmap, which now handles H3-category + H4-entry nesting, while parseBacklog assigns priority and reads size/impact bullets. To support this, priority, level, category, size, and impact fields were added to BacklogEntry.

<!-- generated: resources -->

## Resources

- **Code:**
  - [`src/utils/parse-blocks.ts`](../../src/utils/parse-blocks.ts)
  - [`src/dashboard/data.ts`](../../src/dashboard/data.ts)
  - [`src/triage/validate-triage.ts`](../../src/triage/validate-triage.ts)
- **Tests:**
  - [`src/utils/__tests__/parse-blocks.test.ts`](../../src/utils/__tests__/parse-blocks.test.ts)
  - [`src/triage/__tests__/validate-triage.test.ts`](../../src/triage/__tests__/validate-triage.test.ts)

<!-- /generated: resources -->
