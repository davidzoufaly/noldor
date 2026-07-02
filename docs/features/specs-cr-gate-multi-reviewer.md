---
area: tooling
category: Tooling
deps:
  - codex-cr-plan-review-mode
  - fix-multiterminal-dev-flow-bug
links:
  code:
    - src/cr/orchestrate.ts
    - src/cr/aggregate.ts
    - src/cr/aggregate-cli.ts
    - src/cr/escalate.ts
    - src/cr/escalate-cli.ts
    - src/cr/findings-schema.ts
    - src/cr/lane-types.ts
    - src/cr/filename.ts
    - src/cr/atomic-write.ts
    - src/cr/read-fd-summary.ts
    - src/cr/config.ts
    - src/cr/prompt-stdin.ts
    - src/cr/orchestrate-args.ts
    - src/cr/lanes/manual.ts
    - src/cr/lanes/codex.ts
    - src/cr/lanes/subagent.ts
    - src/cr/lanes/subagent-dispatch.ts
    - src/cr/standalone-prompt.md
    - src/cr/lanes/escalate-prompt.md
    - src/validate/noldor-config.ts
    - src/garden/detectors/override-audit.ts
    - .claude/skills/gate/SKILL.md
    - .noldor/config.json
  tests:
    - src/cr/__tests__/findings-schema.test.ts
    - src/cr/__tests__/filename.test.ts
    - src/cr/__tests__/atomic-write.test.ts
    - src/cr/__tests__/read-fd-summary.test.ts
    - src/cr/__tests__/config.test.ts
    - src/cr/__tests__/prompt-stdin.test.ts
    - src/cr/__tests__/aggregate.test.ts
    - src/cr/__tests__/aggregate.cli.test.ts
    - src/cr/__tests__/orchestrate.test.ts
    - src/cr/__tests__/orchestrate.integration.test.ts
    - src/cr/__tests__/delta.test.ts
    - src/cr/__tests__/overwrite-guard.test.ts
    - src/cr/__tests__/escalate.test.ts
    - src/cr/__tests__/lanes/manual.test.ts
    - src/cr/__tests__/lanes/codex.test.ts
    - src/cr/__tests__/lanes/subagent.test.ts
    - src/garden/detectors/__tests__/override-audit.test.ts
  spec: lost-pre-extraction
name: Specs/Plan CR Gate — Multi-Reviewer + Multiterminal Bug Fix
packages:
  - scripts
phase: done
noldor-tier: full
introduced: 0.6.0
---

## Summary

Layer a CR gate at the spec/plan stage (before code) with parallel reviewers: manual operator pass; codex via `pnpm cr:codex --plan` (lands with [[codex-cr-plan-review-mode]]); Claude-in-same-terminal via a subagent + `superpowers:requesting-code-review` skill against `{{spec-or-plan-path}}`; Claude-standalone via a spawned separate terminal running `claude` with max-thinking and prompt `review: {{path-to-spec-or-plan}}`. Reuses the existing multiterminal-development flow (which has a known bug — tracked separately as [[fix-multiterminal-dev-flow-bug]] and required before this can ship). Outcomes feed back into the spec/plan before promotion to code. Closes the early-feedback gap at `/gate` Step 2.5.

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: specs-cr-gate-multi-reviewer -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** _lost-pre-extraction_
- **Code:**
  - [`src/cr/orchestrate.ts`](../../src/cr/orchestrate.ts)
  - [`src/cr/aggregate.ts`](../../src/cr/aggregate.ts)
  - [`src/cr/aggregate-cli.ts`](../../src/cr/aggregate-cli.ts)
  - [`src/cr/escalate.ts`](../../src/cr/escalate.ts)
  - [`src/cr/escalate-cli.ts`](../../src/cr/escalate-cli.ts)
  - [`src/cr/findings-schema.ts`](../../src/cr/findings-schema.ts)
  - [`src/cr/lane-types.ts`](../../src/cr/lane-types.ts)
  - [`src/cr/filename.ts`](../../src/cr/filename.ts)
  - [`src/cr/atomic-write.ts`](../../src/cr/atomic-write.ts)
  - [`src/cr/read-fd-summary.ts`](../../src/cr/read-fd-summary.ts)
  - [`src/cr/config.ts`](../../src/cr/config.ts)
  - [`src/cr/prompt-stdin.ts`](../../src/cr/prompt-stdin.ts)
  - [`src/cr/orchestrate-args.ts`](../../src/cr/orchestrate-args.ts)
  - [`src/cr/lanes/manual.ts`](../../src/cr/lanes/manual.ts)
  - [`src/cr/lanes/codex.ts`](../../src/cr/lanes/codex.ts)
  - [`src/cr/lanes/subagent.ts`](../../src/cr/lanes/subagent.ts)
  - [`src/cr/lanes/subagent-dispatch.ts`](../../src/cr/lanes/subagent-dispatch.ts)
  - [`src/cr/standalone-prompt.md`](../../src/cr/standalone-prompt.md)
  - [`src/cr/lanes/escalate-prompt.md`](../../src/cr/lanes/escalate-prompt.md)
  - [`src/validate/noldor-config.ts`](../../src/validate/noldor-config.ts)
  - [`src/garden/detectors/override-audit.ts`](../../src/garden/detectors/override-audit.ts)
  - [`.claude/skills/gate/SKILL.md`](../../.claude/skills/gate/SKILL.md)
  - [`.noldor/config.json`](../../.noldor/config.json)
- **Tests:**
  - [`src/cr/__tests__/findings-schema.test.ts`](../../src/cr/__tests__/findings-schema.test.ts)
  - [`src/cr/__tests__/filename.test.ts`](../../src/cr/__tests__/filename.test.ts)
  - [`src/cr/__tests__/atomic-write.test.ts`](../../src/cr/__tests__/atomic-write.test.ts)
  - [`src/cr/__tests__/read-fd-summary.test.ts`](../../src/cr/__tests__/read-fd-summary.test.ts)
  - [`src/cr/__tests__/config.test.ts`](../../src/cr/__tests__/config.test.ts)
  - [`src/cr/__tests__/prompt-stdin.test.ts`](../../src/cr/__tests__/prompt-stdin.test.ts)
  - [`src/cr/__tests__/aggregate.test.ts`](../../src/cr/__tests__/aggregate.test.ts)
  - [`src/cr/__tests__/aggregate.cli.test.ts`](../../src/cr/__tests__/aggregate.cli.test.ts)
  - [`src/cr/__tests__/orchestrate.test.ts`](../../src/cr/__tests__/orchestrate.test.ts)
  - [`src/cr/__tests__/orchestrate.integration.test.ts`](../../src/cr/__tests__/orchestrate.integration.test.ts)
  - [`src/cr/__tests__/delta.test.ts`](../../src/cr/__tests__/delta.test.ts)
  - [`src/cr/__tests__/overwrite-guard.test.ts`](../../src/cr/__tests__/overwrite-guard.test.ts)
  - [`src/cr/__tests__/escalate.test.ts`](../../src/cr/__tests__/escalate.test.ts)
  - [`src/cr/__tests__/lanes/manual.test.ts`](../../src/cr/__tests__/lanes/manual.test.ts)
  - [`src/cr/__tests__/lanes/codex.test.ts`](../../src/cr/__tests__/lanes/codex.test.ts)
  - [`src/cr/__tests__/lanes/subagent.test.ts`](../../src/cr/__tests__/lanes/subagent.test.ts)
  - [`src/garden/detectors/__tests__/override-audit.test.ts`](../../src/garden/detectors/__tests__/override-audit.test.ts)

<!-- /generated: resources -->
