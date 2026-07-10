---
area: tooling
category: Tooling
deps: []
links:
  code:
    - .claude/skills/noldor-promote/SKILL.md
    - .claude/skills/noldor-triage/SKILL.md
    - docs/roadmap.md
    - src/dashboard/data.ts
    - src/triage/validate-triage.ts
    - src/utils/parse-blocks.ts
  tests:
    - src/core/__tests__/next-priority.test.ts
    - src/dashboard/__tests__/api-blocks.test.ts
    - src/dashboard/__tests__/dashboard-data.test.ts
    - src/dashboard/__tests__/dashboard-doc-surfaces.test.ts
    - src/dashboard/__tests__/dashboard-graph-health.test.ts
    - src/dashboard/__tests__/dashboard-mermaid.test.ts
    - src/dashboard/__tests__/dashboard-release-notes.test.ts
    - src/dashboard/__tests__/dashboard-render-markdown.test.ts
    - src/dashboard/__tests__/dashboard-skills.test.ts
    - src/dashboard/__tests__/dashboard-test-pyramid.test.ts
    - src/dashboard/__tests__/dashboard-views.test.ts
    - src/dashboard/__tests__/dashboard-worktrees.test.ts
    - src/dashboard/__tests__/milestones-view.test.ts
    - src/garden/__tests__/backlog-demote.test.ts
    - src/garden/__tests__/sdd-report.test.ts
    - src/triage/__tests__/validate-triage.test.ts
    - src/utils/__tests__/parse-blocks.test.ts
name: Replace Roadmap Buckets with Flat Priority Order
packages:
  - scripts
phase: done
noldor-tier: specs-only
introduced: 0.5.0
---

## Summary

Drop the `## Now / ## Next / ## Later` section split from `docs/roadmap.md` in favor of a single flat priority-ordered list. File order = priority already lives in `docs/noldor/triage.md:38`; the remaining buckets are vestigial — `## Now` is empty (the `/noldor-promote` skill suspended Now-entry creation per step 8 pending this restructure), and the Next/Later split duplicates milestone semantics that `vision.md`'s current-milestone field already carries. In-progress work is discoverable via `phase: in-progress` in FD frontmatter; milestone bucketing belongs in a future `milestone:` FD field (see `Framework Milestones Support` entry below).

## User Story

As an operator triaging work, I want a single priority-ordered list in `docs/roadmap.md` so that reordering and adding entries is a simple line move — no judgment call about which bucket they belong in. The previous `## Now / ## Next / ## Later` split duplicated milestone semantics (the active milestone in `vision.md` already carries that distinction) and the `## Now` section was empty-by-policy after FD `phase: in-progress` became the canonical in-progress tracker.

## Usage

Operators interact with the roadmap exactly as before — add entries via `/noldor-triage`, promote via `/noldor-promote`, view via the dashboard. The visible differences:

- `docs/roadmap.md` opens as a single flat list under category headings, no section split.
- `/noldor-triage` proposes a position (`top` / `after:<slug>` / `bottom`) instead of a bucket.
- The dashboard's overview "In progress" widget reads from FD `phase: in-progress` instead of `roadmap.now`.
- Validation surfaces duplicate-name errors file-wide instead of per-section.

No new agent API. Pure surface-level cleanup of an existing structure.

## PRs

<!-- @prs-since-last-release: replace-roadmap-buckets-with-flat-priority-order -->

## Changelog

### Initial Release (v0.5.0)

#### Summary

This release consolidates the dashboard roadmap around a flat, priority-ordered schema: the roadmap table was refactored to a flat priority-ordered layout with follow-up polish and an in-progress overview, the schema itself was flattened, parseRoadmap was flattened, the phase=next filter was dropped, the dashboard's direct-H3 assertion was removed, and file-wide roadmap dedup was applied.

<!-- generated: resources -->

## Resources

- **Code:**
  - [`.claude/skills/noldor-promote/SKILL.md`](../../.claude/skills/noldor-promote/SKILL.md)
  - [`.claude/skills/noldor-triage/SKILL.md`](../../.claude/skills/noldor-triage/SKILL.md)
  - [`docs/roadmap.md`](../../docs/roadmap.md)
  - [`src/dashboard/data.ts`](../../src/dashboard/data.ts)
  - [`src/triage/validate-triage.ts`](../../src/triage/validate-triage.ts)
  - [`src/utils/parse-blocks.ts`](../../src/utils/parse-blocks.ts)
- **Tests:**
  - [`src/core/__tests__/next-priority.test.ts`](../../src/core/__tests__/next-priority.test.ts)
  - [`src/dashboard/__tests__/api-blocks.test.ts`](../../src/dashboard/__tests__/api-blocks.test.ts)
  - [`src/dashboard/__tests__/dashboard-data.test.ts`](../../src/dashboard/__tests__/dashboard-data.test.ts)
  - [`src/dashboard/__tests__/dashboard-doc-surfaces.test.ts`](../../src/dashboard/__tests__/dashboard-doc-surfaces.test.ts)
  - [`src/dashboard/__tests__/dashboard-graph-health.test.ts`](../../src/dashboard/__tests__/dashboard-graph-health.test.ts)
  - [`src/dashboard/__tests__/dashboard-mermaid.test.ts`](../../src/dashboard/__tests__/dashboard-mermaid.test.ts)
  - [`src/dashboard/__tests__/dashboard-release-notes.test.ts`](../../src/dashboard/__tests__/dashboard-release-notes.test.ts)
  - [`src/dashboard/__tests__/dashboard-render-markdown.test.ts`](../../src/dashboard/__tests__/dashboard-render-markdown.test.ts)
  - [`src/dashboard/__tests__/dashboard-skills.test.ts`](../../src/dashboard/__tests__/dashboard-skills.test.ts)
  - [`src/dashboard/__tests__/dashboard-test-pyramid.test.ts`](../../src/dashboard/__tests__/dashboard-test-pyramid.test.ts)
  - [`src/dashboard/__tests__/dashboard-views.test.ts`](../../src/dashboard/__tests__/dashboard-views.test.ts)
  - [`src/dashboard/__tests__/dashboard-worktrees.test.ts`](../../src/dashboard/__tests__/dashboard-worktrees.test.ts)
  - [`src/dashboard/__tests__/milestones-view.test.ts`](../../src/dashboard/__tests__/milestones-view.test.ts)
  - [`src/garden/__tests__/backlog-demote.test.ts`](../../src/garden/__tests__/backlog-demote.test.ts)
  - [`src/garden/__tests__/sdd-report.test.ts`](../../src/garden/__tests__/sdd-report.test.ts)
  - [`src/triage/__tests__/validate-triage.test.ts`](../../src/triage/__tests__/validate-triage.test.ts)
  - [`src/utils/__tests__/parse-blocks.test.ts`](../../src/utils/__tests__/parse-blocks.test.ts)

<!-- /generated: resources -->
