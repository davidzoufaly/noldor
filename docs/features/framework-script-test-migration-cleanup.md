---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/core/doc-roots.ts
    - src/migrations/chain.ts
    - src/garden/sdd-report.ts
    - src/triage/triage-list-untriaged.ts
    - src/core/release-markers.ts
    - package.json
  docs: []
  tests:
    - src/invariants/__tests__/boundaries.test.ts
    - src/invariants/__tests__/rule-conflicts.test.ts
    - src/validate/__tests__/noldor-config.test.ts
  spec: >-
    docs/superpowers/specs/2026-07-03-framework-script-test-migration-cleanup-design.md
name: Framework Script + Test Migration Cleanup
packages:
  - scripts
phase: done
noldor-tier: specs-only
introduced: 0.5.0
---
## Summary

Audit `scripts/` and the framework's test corpus to identify scripts/tests that were only needed during migration (FD frontmatter shape changes, gate path additions, garden detector rollouts) and can now be deleted. Conversely, identify gaps where shipped framework features lack test coverage. The 2026-07 audit's cruft inventory is the shopping list: dead `cr-retry.ts`, `src/graphify-out/junk.ts` litter, empty `src/index.ts` as package main, duplicate semver impls (`src/migrations/semver.ts` vs npm `semver` in release), stale `packages/noldor/` + `scripts/release/` path comments (`src/core/consumer-config.ts:7`, `src/core/release-markers.ts:9`), `ideas.md` at repo root while `src/core/doc-roots.ts:28` expects `docs/ideas.md`. One-pass sweep — possibly a `/noldor-garden` detector that flags scripts referenced only in migration-era commits and not in any current pipeline.

## User Story

As a framework maintainer, I want migration-era scripts, dead code, duplicate implementations, and stale path references swept out in one pass — and the only zero-test directories given a coverage floor — so that the codebase agents navigate reflects only the live framework, not the scaffolding used to build it.

## Usage

**One-pass sweep (implementer):**

1. `/noldor-gate` on this FD (specs-only tier), then execute units U1–U8 in order; U1–U7 are deletions/edits, U8 adds tests.
2. Verify: `pnpm test && pnpm typecheck && pnpm test:contract`.
3. Grep gates from Acceptance criteria (`cr-retry`, `compareSemver`, `packages/noldor/`, `scripts/release/`) must all come back empty.

**Operator-visible surface:** none — no CLI, config, or doc-page changes beyond the gate SKILL.md historical-note edit and `package.json` entry-point removal. `pnpm noldor triage` and `pnpm garden:detect` behave identically (same root `ideas.md` file, now resolved via `loadDocRoots()`).

## PRs

<!-- @prs-since-last-release: framework-script-test-migration-cleanup -->

## Changelog
