---
name: Architecture Invariants
phase: done
area: tooling
category: Tooling
packages:
  - tooling
deps: []
links:
  spec: docs/superpowers/specs/archive/2026-04-29-architecture-invariants-design.md
  code:
    - scripts/checks/check-invariants.ts
    - scripts/garden/garden-detect.ts
    - scripts/invariants/boundaries.ts
    - scripts/invariants/index.ts
    - scripts/invariants/keyboard-binding.ts
    - scripts/invariants/public-api-tsdoc.ts
    - scripts/invariants/rule-conflicts.ts
    - scripts/invariants/types.ts
  tests:
    - src/checks/__tests__/check-invariants.test.ts
    - src/checks/__tests__/invariants-boundaries.test.ts
    - src/checks/__tests__/invariants-keyboard-binding.test.ts
    - src/checks/__tests__/invariants-public-api-tsdoc.test.ts
    - src/checks/__tests__/invariants-rule-conflicts.test.ts
    - src/garden/__tests__/garden-detect.test.ts
introduced: 0.1.0
updated: 0.3.0
noldor-tier: full
---

## Summary

Four commit-blocking architecture invariants enforced at pre-commit, with advisory mirror in `/garden`:

- **boundaries** — forbidden cross-package imports (`engine → web/viewport`, `viewport → web`, `format → other internal packages/apps`) via `dependency-cruiser`.
- **public-api-tsdoc** — every symbol re-exported from `packages/*/src/index.ts` must carry TSDoc (or `@internal`).
- **rule-conflicts** — paired docs must agree on canonical phrasings; extends seed list in `scripts/garden/garden-invariants.ts`.
- **keyboard-binding** — every UI feature MD (`area: web`, active phase) must be referenced in `docs/features/keyboard-shortcuts.md`, or carry `<!-- keyboard: not-applicable -->` opt-out.

Plugin pattern under `scripts/invariants/`. Pre-commit runner `scripts/checks/check-invariants.ts` runs all plugins in parallel; exit 1 on any violation. Garden runner reuses the same plugins as advisory `invariantViolations` findings.

## User Story

- As an agent committing changes, I want forbidden cross-package imports, missing public-API TSDoc, doc rule contradictions, and unbound UI features rejected at commit time, so framework drift is caught before review instead of at audit time.
- As a maintainer running `/garden`, I want the same checks surfaced as advisory findings, so bypassed (or pre-existing) violations stay visible and can be batch-reviewed.

## Usage

Invariants run automatically on every commit via the pre-commit hook (`pnpm check:invariants`). To run on demand:

```bash
pnpm check:invariants     # blocking — exits 1 on any violation
pnpm garden:detect        # advisory — emits invariantViolations as JSON
```

Adding a new invariant:

1. Create `scripts/invariants/<name>.ts` exporting an `Invariant` plugin (see `scripts/invariants/types.ts`).
2. Add a unit test under `scripts/__tests__/invariants-<name>.test.ts` carrying `// @tests: architecture-invariants`.
3. Register the plugin in `scripts/invariants/index.ts`.

Opting out of `keyboard-binding` for a passive UI feature: add `<!-- keyboard: not-applicable -->` to the feature MD body.

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-04-29-architecture-invariants-design.md`](../../docs/superpowers/specs/archive/2026-04-29-architecture-invariants-design.md)
- **Code:**
  - [`scripts/checks/check-invariants.ts`](../../scripts/checks/check-invariants.ts)
  - [`scripts/garden/garden-detect.ts`](../../scripts/garden/garden-detect.ts)
  - [`scripts/invariants/boundaries.ts`](../../scripts/invariants/boundaries.ts)
  - [`scripts/invariants/index.ts`](../../scripts/invariants/index.ts)
  - [`scripts/invariants/keyboard-binding.ts`](../../scripts/invariants/keyboard-binding.ts)
  - [`scripts/invariants/public-api-tsdoc.ts`](../../scripts/invariants/public-api-tsdoc.ts)
  - [`scripts/invariants/rule-conflicts.ts`](../../scripts/invariants/rule-conflicts.ts)
  - [`scripts/invariants/types.ts`](../../scripts/invariants/types.ts)
- **Tests:**
  - [`src/checks/__tests__/check-invariants.test.ts`](../../src/checks/__tests__/check-invariants.test.ts)
  - [`src/checks/__tests__/invariants-boundaries.test.ts`](../../src/checks/__tests__/invariants-boundaries.test.ts)
  - [`src/checks/__tests__/invariants-keyboard-binding.test.ts`](../../src/checks/__tests__/invariants-keyboard-binding.test.ts)
  - [`src/checks/__tests__/invariants-public-api-tsdoc.test.ts`](../../src/checks/__tests__/invariants-public-api-tsdoc.test.ts)
  - [`src/checks/__tests__/invariants-rule-conflicts.test.ts`](../../src/checks/__tests__/invariants-rule-conflicts.test.ts)
  - [`src/garden/__tests__/garden-detect.test.ts`](../../src/garden/__tests__/garden-detect.test.ts)

<!-- /generated: resources -->

## Changelog

### 0.3.0

#### Summary

_TBD — release-note copy._
