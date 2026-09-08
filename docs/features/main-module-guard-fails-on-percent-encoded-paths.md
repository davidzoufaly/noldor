---
area: tooling
category: Tooling
deps: []
entry-id: Q-0126
links:
  code:
    - src/core/cli-entry.ts
    - src/invariants/entrypoint-guard-choke-point.ts
  tests:
    - src/core/__tests__/cli-entry.test.ts
    - src/core/__tests__/entrypoint-guard-spaced-path.test.ts
    - src/invariants/__tests__/entrypoint-guard-choke-point.test.ts
name: Main-Module Guard Fails on Percent-Encoded Paths
packages:
  - scripts
phase: done
since: 2026-08-14T00:00:00.000Z
noldor-tier: specs-only
---
## Summary

42 module entrypoints decided whether to run their CLI body by comparing `import.meta.url` to a hand-built string, in four spellings. 35 of them used a `` `file://${process.argv[1]}` `` template, which is false whenever the repository path needs percent-encoding — one space in a directory name is enough — so the module was imported, ran nothing, and exited 0 with no diagnostic. The CLI router rewrites `process.argv[1]` to the dispatched module's path before importing it, so those guards were live: eight were `src/hooks/` gates and six more were validators, meaning on such a checkout the framework reported success precisely when it had checked nothing.

`isEntrypoint(moduleUrl, argv1?)` in `src/core/cli-entry.ts` is now the single choke point. It puts both sides through `pathToFileURL`, so it is immune to percent-encoding and — because `pathToFileURL` resolves against the cwd — to a relative `argv[1]` as well. It is path-exact rather than basename-matched, which the pre-existing `invokedDirectly(stem)` is not: six `index.ts` and four `codex.ts` files live under `src/`, so a stem regex cannot separate a dispatched `cli/index.ts` from an imported `release/index.ts`.

- All 42 sites moved, not only the 35 broken ones. `src/hooks/noldor-pre-push.ts` already compared correctly via `pathToFileURL`, and six sites compared **paths** rather than URLs through `fileURLToPath` (`src/core/bump-session-marker.ts`, `src/core/prefix-skills-codemod.ts`, `src/triage/score.ts`, `src/triage/mint-id-cli.ts`, `src/triage/backfill-ids-cli.ts`, `src/triage/merge-candidates-cli.ts`) and so were never exposed to the defect. They moved anyway so the choke-point invariant can have zero exemptions: seven exempt-because-they-happen-to-be-right sites are a list a reader must hold, and an invariant with seven holes is one whose eighth hole nobody notices.
- Two of the 35 were off-template rather than a second class: `src/core/rename-plan-only-tier.ts` interpolated a destructured `argv[1]`, and `src/milestones/validate-milestones.ts` assigned to a `const isMain` instead of gating inline. Three of the six `fileURLToPath` sites also carried a redundant `process.argv[1] !== undefined` prefix, which the helper's `?? ''` subsumes.
- The class regrows on its own, which is why `src/invariants/entrypoint-guard-choke-point.ts` blocks rather than advises. Over the three weeks between the defect being filed and being fixed, two sites migrated away from the broken template and two new ones arrived carrying it.

(found by the code-stage CR on Q-0124, 2026-08-13; scope re-measured 2026-09-08, when the count came to 42)

## Diagram

noldor:cut 42 leaf call sites delegating to one four-line predicate is a fan-in, not a structure; the count is the only fact a diagram would carry and it is already in the Summary.

## User Story

As an agent or operator running Noldor from a checkout whose path contains a space, I want every CLI entrypoint, hook, and validator to execute its body, so that a green gate means the gate actually ran rather than that it silently did nothing.

## Usage

No new command surface — existing behaviour becomes correct where it was silently absent.

**Agent/Programmatic API**

- `isEntrypoint(moduleUrl: string, argv1?: string): boolean` from `src/core/cli-entry.ts` — the direct-invocation guard every entrypoint under `src/` gates on. Write the tail as `if (isEntrypoint(import.meta.url)) { … }`; pass `argv1` only from tests, and pass `''` rather than `undefined` for the no-entrypoint case, since an explicit `undefined` selects the `process.argv[1]` default. Prefer it over the sibling `invokedDirectly(stem)`, which matches on basename and so cannot separate `release/index.ts` from `cli/index.ts`.
- `scanSource(relPath, text)` from `src/invariants/entrypoint-guard-choke-point.ts` — the blocking scan, exported so its two failure directions can be tabled directly.

**CLI**

1. `pnpm noldor <any routed command>` from a checkout whose path needs percent-encoding (`~/code/my repo/`) runs the dispatched module's body, instead of exiting 0 having done nothing.
2. The commit and push hooks — `noldor-pre-commit`, `noldor-validate-trailer`, `noldor-enforce-review-receipt`, `noldor-enforce-arbitration`, `noldor-pre-edit-guard` — enforce on such a checkout rather than passing vacuously.
3. `pnpm noldor checks invariants` gains an `entrypoint-guard-choke-point` row that exits non-zero when any file under `src/` compares `import.meta.url` outside `src/core/cli-entry.ts` (test trees exempt).

## PRs

<!-- @prs-since-last-release: main-module-guard-fails-on-percent-encoded-paths -->

## Changelog
