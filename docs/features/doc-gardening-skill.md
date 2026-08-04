---
name: Doc Gardening Skill
phase: done
area: tooling
category: Tooling
packages:
  - scripts
links:
  spec: lost-pre-extraction
  code:
    - src/docs/docs-api.ts
    - src/docs/docs-check.ts
    - src/docs/docs-transclude.ts
    - src/garden/garden-detect.ts
    - src/garden/garden-invariants.ts
    - src/sync/sync-doc-links.ts
    - src/sync/sync-fd-resources.ts
    - src/triage/triage-list-untriaged.ts
  tests:
    - src/core/__tests__/branch-added.test.ts
    - src/design/__tests__/archive-cli.test.ts
    - src/design/__tests__/archive-resolve.test.ts
    - src/docs/__tests__/docs-api.test.ts
    - src/docs/__tests__/docs-check.test.ts
    - src/docs/__tests__/docs-transclude.test.ts
    - src/garden/__tests__/garden-detect.test.ts
    - src/sync/__tests__/sync-doc-links.test.ts
    - src/sync/__tests__/sync-fd-resources.test.ts
    - src/triage/__tests__/triage-list-untriaged.test.ts
  docs: []
introduced: 0.1.0
updated: 0.5.0
noldor-tier: full
---
## Summary

A `/noldor-garden` skill that bundles the recurring doc-cleanup pass into a single operator-confirmed checklist. Runs deterministic detectors (`src/garden/garden-detect.ts`) to surface stale superpowers plans, unused backlog entries, rule contradictions, SDD gaps, and architecture invariant violations, then executes safe auto-actions (archive, drop) on confirmation.

## User Story

- As an operator, I want a single command that scans all doc drift signals and presents a confirmable checklist so I can keep the knowledge base healthy without manual inspection.
- As an agent, I want a structured JSON interface to the detectors so I can surface findings programmatically.

## Usage

```bash
/noldor-garden
```

The skill runs `pnpm garden:detect`, presents a unified checklist grouped by signal type, and executes confirmed safe actions (git mv for stale plans, removal of backlog entries). Rule contradictions, SDD gaps, and architecture invariant violations stay manual-review only.

**Agent/Programmatic API**

- `pnpm noldor design archive [--dry-run] [--slug <key>]` — archives _this_ gate session's spec + plan at done-flip time instead of deferring to the sweep. `/noldor-gate` Step 4 runs it on FD-carrying paths immediately before `features phase-flip-done`, so the `git mv` into `docs/design/{specs,plans}/archive/` rides the same commit as `phase: done`. Selection is the session's dialogue key (`slug` on `*-new`, `<parent>-<enhancement>` on `*-attach`) intersected with the branch-added set, so it can never move a foreign feature's live spec. Exits 0 with `nothing to do` on a re-run or a path that carries no artifacts; fails closed when the branch-added range is unresolvable.
- `detectStaleSpecs` / `detectStalePlans` are unchanged and now fire only on exceptions — pre-flip-era debt, skipped or manual flips, orphans, and age-outs.

<!-- generated: resources -->

## Resources

- **Spec:** _lost-pre-extraction_
- **Code:**
  - [`src/docs/docs-api.ts`](../../src/docs/docs-api.ts)
  - [`src/docs/docs-check.ts`](../../src/docs/docs-check.ts)
  - [`src/docs/docs-transclude.ts`](../../src/docs/docs-transclude.ts)
  - [`src/garden/garden-detect.ts`](../../src/garden/garden-detect.ts)
  - [`src/garden/garden-invariants.ts`](../../src/garden/garden-invariants.ts)
  - [`src/sync/sync-doc-links.ts`](../../src/sync/sync-doc-links.ts)
  - [`src/sync/sync-fd-resources.ts`](../../src/sync/sync-fd-resources.ts)
  - [`src/triage/triage-list-untriaged.ts`](../../src/triage/triage-list-untriaged.ts)
- **Tests:**
  - [`src/docs/__tests__/docs-api.test.ts`](../../src/docs/__tests__/docs-api.test.ts)
  - [`src/docs/__tests__/docs-check.test.ts`](../../src/docs/__tests__/docs-check.test.ts)
  - [`src/docs/__tests__/docs-transclude.test.ts`](../../src/docs/__tests__/docs-transclude.test.ts)
  - [`src/garden/__tests__/garden-detect.test.ts`](../../src/garden/__tests__/garden-detect.test.ts)
  - [`src/sync/__tests__/sync-doc-links.test.ts`](../../src/sync/__tests__/sync-doc-links.test.ts)
  - [`src/sync/__tests__/sync-fd-resources.test.ts`](../../src/sync/__tests__/sync-fd-resources.test.ts)
  - [`src/triage/__tests__/triage-list-untriaged.test.ts`](../../src/triage/__tests__/triage-list-untriaged.test.ts)

<!-- /generated: resources -->

## Changelog

### 0.5.0

#### Summary

Resolved a bug where `sync-fd-resources` now automatically rewrites FD `links.spec` references to their archive variant.

### 0.4.0

#### Summary

Dropped SDD detector 14 and extended the orphan walk to `scripts/`.

### 0.3.0

#### Summary

_TBD — release-note copy._
