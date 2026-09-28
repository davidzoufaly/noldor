---
area: tooling
category: Tooling
deps: []
entry-id: Q-0221
links:
  code:
    - src/invariants/entrypoint-guard-choke-point.ts
    - src/invariants/source-scan.ts
  tests:
    - src/invariants/__tests__/entrypoint-guard-choke-point.test.ts
  spec: >-
    docs/design/specs/archive/2026-09-28-entrypoint-guard-choke-point-enforcement-design.md
name: Entrypoint-Guard Choke-Point Enforcement
packages:
  - scripts
phase: done
since: 2026-09-08T00:00:00.000Z
noldor-tier: specs-only
---

## Summary

Q-0126 swept all 42 direct-invocation guards under `src/` behind `isEntrypoint` in `src/core/cli-entry.ts`, but shipped **no enforcement**: nothing mechanical stops a new entrypoint from hand-rolling the comparison again, and when that comparison is wrong the module runs nothing and exits 0, so the failure is invisible. The class is known to regrow — over the three weeks Q-0126 sat filed, two sites migrated away from the broken template and two new ones arrived carrying it.

## Diagram

Every CLI module asks one helper whether it was run directly. The invariant keeps it that way: any other code that reads argv slot 1 fails `checks invariants`.

```mermaid
flowchart LR
  mods["CLI modules under src/"] -->|isEntrypoint / invokedDirectly / runIfDirect| helper["src/core/cli-entry.ts<br/>(only reader of argv[1])"]
  inv["entrypoint-guard-choke-point<br/>invariant"] -->|maskNonCode, then scan| mods
  inv -->|hand-written argv[1] read| red["checks invariants exits non-zero<br/>file:line"]
```

## User Story

As an agent or maintainer adding a CLI module under `src/`, I want `pnpm noldor checks invariants` to refuse any hand-written read of `process.argv[1]`, so that a direct-invocation guard that silently never fires cannot ship.

## Usage

**Agent/Programmatic API**

- Guard a new CLI module with one of the helpers in `src/core/cli-entry.ts`: `if (isEntrypoint(import.meta.url)) { … }` (path-exact), `if (invokedDirectly('<stem>')) { … }`, or `runIfDirect('<stem>', '<label>', main)` when the tail is the standard run-and-exit body.
- `pnpm noldor checks invariants` runs the `entrypoint-guard-choke-point` invariant. It reports every read of argv slot 1 in a non-test `.ts` file under `src/` other than `src/core/cli-entry.ts` as `<file>:<line>`, naming the three helpers. The forms it catches are `[1]`, `?.[1]`, `.at(1)`, `.slice(1…)` and array destructuring that binds slot 1. A file it cannot lex cleanly is reported as `could not lex` rather than passed.
- `maskNonCode(text)` in `src/invariants/source-scan.ts` is reusable by other text-scan invariants. It returns the source with comments, strings, regex literals and template text blanked, template holes kept as code, and a `clean` flag.

## PRs

<!-- @prs-since-last-release: entrypoint-guard-choke-point-enforcement -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/archive/2026-09-28-entrypoint-guard-choke-point-enforcement-design.md`](../../docs/design/specs/archive/2026-09-28-entrypoint-guard-choke-point-enforcement-design.md)
- **Code:**
  - [`src/invariants/entrypoint-guard-choke-point.ts`](../../src/invariants/entrypoint-guard-choke-point.ts)
  - [`src/invariants/source-scan.ts`](../../src/invariants/source-scan.ts)
- **Tests:**
  - [`src/invariants/__tests__/entrypoint-guard-choke-point.test.ts`](../../src/invariants/__tests__/entrypoint-guard-choke-point.test.ts)

<!-- /generated: resources -->
