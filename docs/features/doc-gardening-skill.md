---
name: Doc Gardening Skill
phase: done
area: tooling
category: Tooling
packages:
  - scripts
links:
  spec: docs/superpowers/specs/archive/2026-04-29-doc-gardening-skill-design.md
  code:
    - scripts/docs/docs-api.ts
    - scripts/docs/docs-check.ts
    - scripts/docs/docs-transclude.ts
    - scripts/garden/garden-detect.ts
    - scripts/garden/garden-invariants.ts
    - scripts/sync/sync-doc-links.ts
    - scripts/sync/sync-fd-resources.ts
    - scripts/triage/triage-list-untriaged.ts
  tests:
    - src/garden/__tests__/garden-detect.test.ts
  docs: []
introduced: 0.1.0
updated: 0.5.0
noldor-tier: full
---
## Summary

A `/garden` skill that bundles the recurring doc-cleanup pass into a single operator-confirmed checklist. Runs deterministic detectors (`scripts/garden/garden-detect.ts`) to surface stale superpowers plans, unused backlog entries, rule contradictions, SDD gaps, and architecture invariant violations, then executes safe auto-actions (archive, drop) on confirmation.

## User Story

- As an operator, I want a single command that scans all doc drift signals and presents a confirmable checklist so I can keep the knowledge base healthy without manual inspection.
- As an agent, I want a structured JSON interface to the detectors so I can surface findings programmatically.

## Usage

```bash
/garden
```

The skill runs `pnpm garden:detect`, presents a unified checklist grouped by signal type, and executes confirmed safe actions (git mv for stale plans, removal of backlog entries). Rule contradictions, SDD gaps, and architecture invariant violations stay manual-review only.

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-04-29-doc-gardening-skill-design.md`](../../docs/superpowers/specs/archive/2026-04-29-doc-gardening-skill-design.md)
- **Code:**
  - [`scripts/docs/docs-api.ts`](../../scripts/docs/docs-api.ts)
  - [`scripts/docs/docs-check.ts`](../../scripts/docs/docs-check.ts)
  - [`scripts/docs/docs-transclude.ts`](../../scripts/docs/docs-transclude.ts)
  - [`scripts/garden/garden-detect.ts`](../../scripts/garden/garden-detect.ts)
  - [`scripts/garden/garden-invariants.ts`](../../scripts/garden/garden-invariants.ts)
  - [`scripts/sync/sync-doc-links.ts`](../../scripts/sync/sync-doc-links.ts)
  - [`scripts/sync/sync-fd-resources.ts`](../../scripts/sync/sync-fd-resources.ts)
  - [`scripts/triage/triage-list-untriaged.ts`](../../scripts/triage/triage-list-untriaged.ts)
- **Tests:**
  - [`scripts/garden/__tests__/garden-detect.test.ts`](../../scripts/garden/__tests__/garden-detect.test.ts)

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
