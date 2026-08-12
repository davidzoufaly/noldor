---
area: tooling
category: Tooling
deps: []
links:
  spec: lost-pre-extraction
  code:
    - .noldor/rules/lazy-decision-ladder.md
    - templates/.noldor/rules/lazy-decision-ladder.md
    - src/cr/lanes/subagent-dispatch.ts
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
    - src/core/rules/__tests__/stage.test.ts
    - src/cr/__tests__/lanes/subagent-dispatch.test.ts
    - src/hooks/__tests__/agent-rules-guard.test.ts
    - src/rules/__tests__/cli.test.ts
    - src/rules/__tests__/index-cache.test.ts
    - src/rules/__tests__/load.test.ts
    - src/rules/__tests__/resolve.test.ts
    - src/rules/__tests__/types.test.ts
name: Rules Cascade v1
packages:
  - tooling
phase: in-progress
noldor-tier: full
introduced: 0.2.0
---
## Summary

Retroactive FD for the Rules Cascade v1 substrate (PR #2, 2026-06-01) — the layered agent-rules system: rule MDs are loaded (`src/rules/load.ts`), resolved through the cascade with overrides (`src/rules/resolve.ts`), cached (`src/rules/index-cache.ts`), keyed to lifecycle stages (`src/core/rules/stage.ts` — the `Stage` union + `pathToStage` session-path projection), plus the `agent-rules-guard` hook (an Agent-dispatch prompt guard, currently unwired). Four thin CLI wrappers (`cli-cores`, `cli-list`, `cli-resolve`, `cli-validate`) expose the cascade. Shipped before FD-trailer dogfooding began, so no `Noldor-FD:` history exists; this FD backfills ownership so the code stops floating unreferenced (2026-07-03 tag judgment pass).

## User Story

As a Noldor operator, I want repo rules expressed as layered, resolvable rule documents with CLI access, so that agents inherit consistent constraints without hand-copying rule text between contexts.

## Usage

- `pnpm noldor rules list` — enumerate loaded rules
- `pnpm noldor rules resolve` — print the cascade-resolved rule set
- `pnpm noldor rules validate` — store integrity gate (schema violations, id/filename mismatches, parse errors)
- Pre-generation discipline: the `lazy-decision-ladder` rule (enforce bucket, `**/*.ts`, stage `code`) — understand the problem and trace the real flow first, then climb the 7-rung ladder (YAGNI → reuse → stdlib → native → installed dep → one-liner → minimal); never cut trust-boundary validation, data-loss error handling, security, accessibility, or explicitly-requested behaviour. Surfaced on demand via `pnpm noldor rules resolve --file <path> --stage code`; automatic injection into the authoring loop is deferred (Q-0069 / prose-rules-enforce-cascade-rules territory).
- Mark a deliberate, bounded corner-cut with `// noldor:cut <ceiling> — <upgrade path>` — CR reviewer prompts respect the marker for minimalism-class findings (reuse/simplification/efficiency/altitude) and flag only a wrong ceiling or a real cut left unmarked; correctness/security findings are unaffected.
- Consumers receive the rule via `pnpm noldor init` / `init --update` (first distributed rule — `templates/.noldor/rules/` twin).

## Design Notes

- **Spec:** _lost-pre-extraction_ — PR #2 predates the extraction and the spec discipline; no design artifact survives.
- Cascade semantics live in `src/rules/resolve.ts`; `index-cache.ts` memoizes the rule index keyed by file mtimes.

## Changelog

### 0.2.0

- Rules Cascade v1 substrate: load/resolve/cache pipeline with stage keying, 4 CLI wrappers, agent-rules-guard hook (PR #2).

<!-- generated: resources -->

## Resources

- **Spec:** _lost-pre-extraction_
- **Code:**
  - [`.noldor/rules/lazy-decision-ladder.md`](../../.noldor/rules/lazy-decision-ladder.md)
  - [`templates/.noldor/rules/lazy-decision-ladder.md`](../../templates/.noldor/rules/lazy-decision-ladder.md)
  - [`src/cr/lanes/subagent-dispatch.ts`](../../src/cr/lanes/subagent-dispatch.ts)
  - [`src/rules/cli-cores.ts`](../../src/rules/cli-cores.ts)
  - [`src/rules/cli-list.ts`](../../src/rules/cli-list.ts)
  - [`src/rules/cli-resolve.ts`](../../src/rules/cli-resolve.ts)
  - [`src/rules/cli-validate.ts`](../../src/rules/cli-validate.ts)
  - [`src/rules/index-cache.ts`](../../src/rules/index-cache.ts)
  - [`src/rules/load.ts`](../../src/rules/load.ts)
  - [`src/rules/resolve.ts`](../../src/rules/resolve.ts)
  - [`src/rules/types.ts`](../../src/rules/types.ts)
  - [`src/core/rules/stage.ts`](../../src/core/rules/stage.ts)
  - [`src/hooks/agent-rules-guard.ts`](../../src/hooks/agent-rules-guard.ts)
- **Tests:**
  - [`src/core/rules/__tests__/stage.test.ts`](../../src/core/rules/__tests__/stage.test.ts)
  - [`src/cr/__tests__/lanes/subagent-dispatch.test.ts`](../../src/cr/__tests__/lanes/subagent-dispatch.test.ts)
  - [`src/hooks/__tests__/agent-rules-guard.test.ts`](../../src/hooks/__tests__/agent-rules-guard.test.ts)
  - [`src/rules/__tests__/cli.test.ts`](../../src/rules/__tests__/cli.test.ts)
  - [`src/rules/__tests__/index-cache.test.ts`](../../src/rules/__tests__/index-cache.test.ts)
  - [`src/rules/__tests__/load.test.ts`](../../src/rules/__tests__/load.test.ts)
  - [`src/rules/__tests__/resolve.test.ts`](../../src/rules/__tests__/resolve.test.ts)
  - [`src/rules/__tests__/types.test.ts`](../../src/rules/__tests__/types.test.ts)

<!-- /generated: resources -->
