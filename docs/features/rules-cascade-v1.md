---
area: tooling
category: Tooling
deps: []
links:
  spec: lost-pre-extraction
  code:
    - src/rules/cli-cores.ts
    - src/rules/cli-list.ts
    - src/rules/cli-resolve.ts
    - src/rules/cli-validate.ts
    - src/rules/index-cache.ts
    - src/rules/load.ts
    - src/rules/resolve.ts
    - src/rules/types.ts
    - src/core/rules/stage.ts
    - src/hooks/agent-rules-guard.ts
  tests:
    - src/rules/__tests__/cli.test.ts
    - src/rules/__tests__/index-cache.test.ts
    - src/rules/__tests__/load.test.ts
    - src/rules/__tests__/resolve.test.ts
    - src/rules/__tests__/types.test.ts
    - src/core/rules/__tests__/stage.test.ts
    - src/hooks/__tests__/agent-rules-guard.test.ts
name: Rules Cascade v1
packages:
  - tooling
phase: done
noldor-tier: full
introduced: 0.2.0
---

## Summary

Retroactive FD for the Rules Cascade v1 substrate (PR #2, 2026-06-01) — the layered agent-rules system: rule MDs are loaded (`src/rules/load.ts`), resolved through the cascade with overrides (`src/rules/resolve.ts`), cached (`src/rules/index-cache.ts`), staged into agent-facing outputs (`src/core/rules/stage.ts`), and guarded against unreviewed edits by the `agent-rules-guard` hook. Four thin CLI wrappers (`cli-cores`, `cli-list`, `cli-resolve`, `cli-validate`) expose the cascade. Shipped before FD-trailer dogfooding began, so no `Noldor-FD:` history exists; this FD backfills ownership so the code stops floating unreferenced (2026-07-03 tag judgment pass).

## User Story

As a Noldor operator, I want repo rules expressed as layered, resolvable rule documents with CLI access and an edit guard, so that agents inherit consistent constraints without hand-copying rule text between contexts.

## Usage

- `pnpm noldor rules list` — enumerate loaded rules
- `pnpm noldor rules resolve` — print the cascade-resolved rule set
- `pnpm noldor rules cores` / `rules validate` — core-rule extraction and validation
- The `agent-rules-guard` hook blocks unreviewed edits to rule files.

## Design Notes

- **Spec:** _lost-pre-extraction_ — PR #2 predates the extraction and the spec discipline; no design artifact survives.
- Cascade semantics live in `src/rules/resolve.ts`; `index-cache.ts` memoizes the rule index keyed by file mtimes.

## Changelog

### 0.2.0

- Rules Cascade v1 substrate: load/resolve/cache/stage pipeline, 4 CLI wrappers, agent-rules-guard hook (PR #2).
