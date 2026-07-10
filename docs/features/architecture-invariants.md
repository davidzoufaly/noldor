---
name: Architecture Invariants
phase: done
area: tooling
category: Tooling
packages:
  - tooling
deps: []
links:
  spec: lost-pre-extraction
  code:
    - src/checks/check-invariants.ts
    - src/garden/garden-detect.ts
    - src/invariants/boundaries.ts
    - src/invariants/index.ts
    - src/invariants/public-api-tsdoc.ts
    - src/invariants/rule-conflicts.ts
    - src/invariants/types.ts
  tests:
    - src/checks/__tests__/check-invariants.test.ts
    - src/checks/__tests__/invariants-boundaries.test.ts
    - src/checks/__tests__/invariants-public-api-tsdoc.test.ts
    - src/checks/__tests__/invariants-rule-conflicts.test.ts
    - src/garden/__tests__/garden-detect.test.ts
introduced: 0.1.0
updated: 0.3.0
noldor-tier: full
---

## Summary

Three commit-blocking architecture invariants enforced at pre-commit, with advisory mirror in `/noldor-garden`:

- **boundaries** — forbidden imports per `consumer.boundaries` rules in `.noldor/config.json` (dependency-cruiser forbidden-rule shape, including the `{from: {}, to: {circular: true}}` no-cycle backstop).
- **public-api-tsdoc** — every symbol re-exported from `packages/*/src/index.ts` must carry TSDoc (or `@internal`).
- **rule-conflicts** — paired docs must agree on canonical phrasings; extends seed list in `src/invariants/rule-pairs.ts`.

Plugin pattern under `src/invariants/`. Pre-commit runner `src/checks/check-invariants.ts` runs all plugins in parallel; exit 1 on any violation. Garden runner reuses the same plugins as advisory `invariantViolations` findings.

## User Story

- As an agent committing changes, I want forbidden cross-package imports, missing public-API TSDoc, doc rule contradictions, and unbound UI features rejected at commit time, so framework drift is caught before review instead of at audit time.
- As a maintainer running `/noldor-garden`, I want the same checks surfaced as advisory findings, so bypassed (or pre-existing) violations stay visible and can be batch-reviewed.

## Usage

Invariants run automatically on every commit via the pre-commit hook (`pnpm check:invariants`). To run on demand:

```bash
pnpm check:invariants     # blocking — exits 1 on any violation
pnpm garden:detect        # advisory — emits invariantViolations as JSON
```

Adding a new invariant:

1. Create `src/invariants/<name>.ts` exporting an `Invariant` plugin (see `src/invariants/types.ts`).
2. Add a unit test under `scripts/__tests__/invariants-<name>.test.ts` carrying `// @tests: architecture-invariants`.
3. Register the plugin in `src/invariants/index.ts`.

<!-- generated: resources -->

## Resources

- **Spec:** _lost-pre-extraction_
- **Code:**
  - [`src/checks/check-invariants.ts`](../../src/checks/check-invariants.ts)
  - [`src/garden/garden-detect.ts`](../../src/garden/garden-detect.ts)
  - [`src/invariants/boundaries.ts`](../../src/invariants/boundaries.ts)
  - [`src/invariants/index.ts`](../../src/invariants/index.ts)
  - [`src/invariants/public-api-tsdoc.ts`](../../src/invariants/public-api-tsdoc.ts)
  - [`src/invariants/rule-conflicts.ts`](../../src/invariants/rule-conflicts.ts)
  - [`src/invariants/types.ts`](../../src/invariants/types.ts)
- **Tests:**
  - [`src/checks/__tests__/check-invariants.test.ts`](../../src/checks/__tests__/check-invariants.test.ts)
  - [`src/checks/__tests__/invariants-boundaries.test.ts`](../../src/checks/__tests__/invariants-boundaries.test.ts)
  - [`src/checks/__tests__/invariants-public-api-tsdoc.test.ts`](../../src/checks/__tests__/invariants-public-api-tsdoc.test.ts)
  - [`src/checks/__tests__/invariants-rule-conflicts.test.ts`](../../src/checks/__tests__/invariants-rule-conflicts.test.ts)
  - [`src/garden/__tests__/garden-detect.test.ts`](../../src/garden/__tests__/garden-detect.test.ts)

<!-- /generated: resources -->

## Changelog

- keyboard-binding invariant retired (Charuy-only UI concern; registry is rule-conflicts + public-api-tsdoc + boundaries) — see self-boundaries-declaration-and-cycle-break.

### 0.3.0

#### Summary

_TBD — release-note copy._
