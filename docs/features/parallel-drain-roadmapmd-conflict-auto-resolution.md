---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/autonomous/salvage.ts
    - src/autonomous/drain-io.ts
    - src/utils/write-blocks.ts
  docs: []
  tests:
    - src/autonomous/__tests__/resolve-roadmap-conflict.test.ts
    - src/autonomous/__tests__/merge-coordinator.test.ts
  spec: >-
    docs/superpowers/specs/archive/2026-06-14-parallel-drain-roadmapmd-conflict-auto-resolution-design.md
name: Parallel-Drain `roadmap.md` Conflict Auto-Resolution
packages:
  - scripts
phase: done
noldor-tier: specs-only
introduced: 0.4.0
---
## Summary

Under `--concurrency >1`, every fast-track child removes its own block from the shared `docs/roadmap.md`; the serialized merge coordinator rebases each PR onto the prior merge, but git cannot auto-merge *adjacent* block removals → the PR goes `DIRTY`, the coordinator skips it, and the worktree + open PR are orphaned. Hit live during a 23-entry drain: ~5 of the K=3 PRs went DIRTY, forcing a fall back to `--concurrency 1` (sequential is conflict-free by construction — each merges before the next branch is cut). Block-removal is deterministic, so the coordinator should re-apply "remove `<slug>`'s block" against the freshly-rebased base (parse + drop the block, not a textual 3-way merge) rather than letting git's line-merge fail. Without this, `--concurrency >1` is effectively unusable for roadmap-source drains.

## User Story

As an operator draining a large roadmap queue with `--concurrency >1`, I want adjacent
`docs/roadmap.md` block-removal conflicts resolved automatically by re-applying the
deterministic block removal against the freshly-rebased base, so that parallel fast-track
PRs all merge instead of going `DIRTY` and orphaning their worktrees — without me falling
back to `--concurrency 1`.

## Usage

**CLI** — no new flags; behaviour is automatic under the existing parallel path:

1. Run as today: `pnpm noldor autonomous queue-drain --concurrency 3` from a clean `main`.
2. When two children remove adjacent roadmap blocks and a PR would go `DIRTY`, the
   serialized coordinator now rebases the branch, re-applies `removeBlock(<base>, <slug>)`
   to `docs/roadmap.md`, force-pushes, and re-merges — transparently.
3. A conflict on any non-roadmap path (e.g. two features editing the same `.ts`) still
   leaves the PR open with `merge-conflict — PR left open for human resolution`; resolve
   by hand as today.
4. Auto-resolution surfaces as a `kind: 'resolved'` agent-event (visible via the metrics /
   agent-events surface) so the operator can audit which merges were machine-rebased.

**Agent API** (internal): `resolveRoadmapConflict(run, slug, branch)` →
`'resolved' | 'unresolvable'`, invoked by `mergePr` on a `merge-conflict` verdict.

## PRs

<!-- @prs-since-last-release: parallel-drain-roadmapmd-conflict-auto-resolution -->

## Changelog

### Initial Release (v0.4.0)

#### Summary

K>1 drain now auto-resolves adjacent `roadmap.md` block conflicts (#106).

#### PRs

- #106: auto-resolve adjacent roadmap.md block conflicts in K>1 drain ([link](https://github.com/davidzoufaly/noldor/pull/106))

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-06-14-parallel-drain-roadmapmd-conflict-auto-resolution-design.md`](../../docs/superpowers/specs/archive/2026-06-14-parallel-drain-roadmapmd-conflict-auto-resolution-design.md)
- **Code:**
  - [`src/autonomous/salvage.ts`](../../src/autonomous/salvage.ts)
  - [`src/autonomous/drain-io.ts`](../../src/autonomous/drain-io.ts)
  - [`src/utils/write-blocks.ts`](../../src/utils/write-blocks.ts)
- **Tests:**
  - [`src/autonomous/__tests__/resolve-roadmap-conflict.test.ts`](../../src/autonomous/__tests__/resolve-roadmap-conflict.test.ts)
  - [`src/autonomous/__tests__/merge-coordinator.test.ts`](../../src/autonomous/__tests__/merge-coordinator.test.ts)

<!-- /generated: resources -->
