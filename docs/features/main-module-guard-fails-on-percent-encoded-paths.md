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

35 module entrypoints gate their CLI body by comparing `import.meta.url` against a hand-built string of `file://` concatenated with `process.argv[1]`. That comparison is false whenever the repository path needs percent-encoding — one space in a directory name is enough — so the module exits 0 having run nothing, with no diagnostic. For the hook and validator entrypoints among them, that is a silently disabled gate: the framework reports success precisely when it checked nothing. `src/cli/index.ts` and `src/hooks/noldor-pre-push.ts` already use the correct `pathToFileURL(process.argv[1] ?? '').href` form; sweep every remaining site to it.

- Confirmed call sites — all 35, measured by grepping `src/` for the literal comparison on 2026-08-14. **`src/hooks/` (6, the material cluster — these are the gates):** `noldor-pre-commit.ts`, `noldor-validate-trailer.ts`, `noldor-inject-trailers.ts`, `noldor-enforce-review-receipt.ts`, `noldor-pre-edit-guard.ts`, `agent-rules-guard.ts`. **`src/worktrees/` (6):** `create-worktree.ts`, `down-worktree.ts`, `up-worktree.ts`, `launch-worktrees.ts`, `worktree-conflicts.ts`, `worktree-status.ts`. **`src/core/` (6):** `validate-noldor-scope.ts`, `validate-noldor.ts`, `validate-skill-catalog.ts`, `changelog.ts`, `rename-plan-only-tier.ts`, `pr-flow-cli.ts`. **`src/rules/` (3):** `cli-list.ts`, `cli-resolve.ts`, `cli-validate.ts`. **`src/features/` (3):** `fill-links-code-gaps.ts`, `migrate-changelog-unreleased.ts`, `migrate-fd-commits-to-prs.ts`. **`src/checks/` (2):** `check-template-sync.ts`, `check-shared-files.ts`. **`src/cr/` (2):** `orchestrate.ts`, `codex.ts`. **`src/design/` (2):** `context-cli.ts`, `log-cli.ts`. **Singles:** `src/triage/validate-triage.ts`, `src/cli/validate-script-catalog.ts`, `src/milestones/validate-milestones.ts`, `src/prep/print-format.ts`, `src/release/index.ts`.
- Two shape variants, one defect: `src/core/rename-plan-only-tier.ts:109` interpolates a destructured `argv[1]` and `src/milestones/validate-milestones.ts:61` assigns to a `const isMain` rather than branching inline. Both are the same template bug — do not read them as a second class.
- The regression test wants a fixture checkout whose path contains a space, asserting each swept entrypoint still executes its body — a unit test on the comparison helper alone would not have caught the class, since every site re-derives it inline.
- The work is mechanical — one-line replacement per site plus the shared fixture — so the sweep breadth is scope, not complexity. Do not over-prep it on the file count alone.

(found by the code-stage CR on Q-0124, 2026-08-13; scope re-measured 2026-08-14)

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
