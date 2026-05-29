---
area: tooling
category: Tooling
deps:
  - codex-cr-plan-review-mode
  - fix-multiterminal-dev-flow-bug
links:
  code:
    - scripts/cr/orchestrate.ts
    - scripts/cr/aggregate.ts
    - scripts/cr/aggregate-cli.ts
    - scripts/cr/escalate.ts
    - scripts/cr/escalate-cli.ts
    - scripts/cr/findings-schema.ts
    - scripts/cr/lane-types.ts
    - scripts/cr/filename.ts
    - scripts/cr/atomic-write.ts
    - scripts/cr/read-fd-summary.ts
    - scripts/cr/config.ts
    - scripts/cr/prompt-stdin.ts
    - scripts/cr/orchestrate-args.ts
    - scripts/cr/lanes/manual.ts
    - scripts/cr/lanes/codex.ts
    - scripts/cr/lanes/subagent.ts
    - scripts/cr/lanes/subagent-dispatch.ts
    - scripts/cr/lanes/standalone.ts
    - scripts/cr/lanes/standalone-prompt.md
    - scripts/cr/lanes/escalate-prompt.md
    - scripts/validate/noldor-config.ts
    - scripts/garden/detectors/override-audit.ts
    - .claude/skills/gate/SKILL.md
    - .noldor/config.json
  tests:
    - scripts/cr/__tests__/findings-schema.test.ts
    - scripts/cr/__tests__/filename.test.ts
    - scripts/cr/__tests__/atomic-write.test.ts
    - scripts/cr/__tests__/read-fd-summary.test.ts
    - scripts/cr/__tests__/config.test.ts
    - scripts/cr/__tests__/prompt-stdin.test.ts
    - scripts/cr/__tests__/aggregate.test.ts
    - scripts/cr/__tests__/aggregate.cli.test.ts
    - scripts/cr/__tests__/orchestrate.test.ts
    - scripts/cr/__tests__/orchestrate.integration.test.ts
    - scripts/cr/__tests__/delta.test.ts
    - scripts/cr/__tests__/overwrite-guard.test.ts
    - scripts/cr/__tests__/in-progress-guard.test.ts
    - scripts/cr/__tests__/escalate.test.ts
    - scripts/cr/__tests__/lanes/manual.test.ts
    - scripts/cr/__tests__/lanes/codex.test.ts
    - scripts/cr/__tests__/lanes/subagent.test.ts
    - scripts/cr/__tests__/lanes/standalone.test.ts
    - scripts/garden/detectors/__tests__/override-audit.test.ts
  spec: >-
    docs/superpowers/specs/archive/2026-05-23-specs-cr-gate-multi-reviewer-design.md
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

- **Spec:** [`docs/superpowers/specs/archive/2026-05-23-specs-cr-gate-multi-reviewer-design.md`](../../docs/superpowers/specs/archive/2026-05-23-specs-cr-gate-multi-reviewer-design.md)
- **Code:**
  - [`scripts/cr/orchestrate.ts`](../../scripts/cr/orchestrate.ts)
  - [`scripts/cr/aggregate.ts`](../../scripts/cr/aggregate.ts)
  - [`scripts/cr/aggregate-cli.ts`](../../scripts/cr/aggregate-cli.ts)
  - [`scripts/cr/escalate.ts`](../../scripts/cr/escalate.ts)
  - [`scripts/cr/escalate-cli.ts`](../../scripts/cr/escalate-cli.ts)
  - [`scripts/cr/findings-schema.ts`](../../scripts/cr/findings-schema.ts)
  - [`scripts/cr/lane-types.ts`](../../scripts/cr/lane-types.ts)
  - [`scripts/cr/filename.ts`](../../scripts/cr/filename.ts)
  - [`scripts/cr/atomic-write.ts`](../../scripts/cr/atomic-write.ts)
  - [`scripts/cr/read-fd-summary.ts`](../../scripts/cr/read-fd-summary.ts)
  - [`scripts/cr/config.ts`](../../scripts/cr/config.ts)
  - [`scripts/cr/prompt-stdin.ts`](../../scripts/cr/prompt-stdin.ts)
  - [`scripts/cr/orchestrate-args.ts`](../../scripts/cr/orchestrate-args.ts)
  - [`scripts/cr/lanes/manual.ts`](../../scripts/cr/lanes/manual.ts)
  - [`scripts/cr/lanes/codex.ts`](../../scripts/cr/lanes/codex.ts)
  - [`scripts/cr/lanes/subagent.ts`](../../scripts/cr/lanes/subagent.ts)
  - [`scripts/cr/lanes/subagent-dispatch.ts`](../../scripts/cr/lanes/subagent-dispatch.ts)
  - [`scripts/cr/lanes/standalone.ts`](../../scripts/cr/lanes/standalone.ts)
  - [`scripts/cr/lanes/standalone-prompt.md`](../../scripts/cr/lanes/standalone-prompt.md)
  - [`scripts/cr/lanes/escalate-prompt.md`](../../scripts/cr/lanes/escalate-prompt.md)
  - [`scripts/validate/noldor-config.ts`](../../scripts/validate/noldor-config.ts)
  - [`scripts/garden/detectors/override-audit.ts`](../../scripts/garden/detectors/override-audit.ts)
  - [`.claude/skills/gate/SKILL.md`](../../.claude/skills/gate/SKILL.md)
  - [`.noldor/config.json`](../../.noldor/config.json)
- **Tests:**
  - [`scripts/cr/__tests__/findings-schema.test.ts`](../../scripts/cr/__tests__/findings-schema.test.ts)
  - [`scripts/cr/__tests__/filename.test.ts`](../../scripts/cr/__tests__/filename.test.ts)
  - [`scripts/cr/__tests__/atomic-write.test.ts`](../../scripts/cr/__tests__/atomic-write.test.ts)
  - [`scripts/cr/__tests__/read-fd-summary.test.ts`](../../scripts/cr/__tests__/read-fd-summary.test.ts)
  - [`scripts/cr/__tests__/config.test.ts`](../../scripts/cr/__tests__/config.test.ts)
  - [`scripts/cr/__tests__/prompt-stdin.test.ts`](../../scripts/cr/__tests__/prompt-stdin.test.ts)
  - [`scripts/cr/__tests__/aggregate.test.ts`](../../scripts/cr/__tests__/aggregate.test.ts)
  - [`scripts/cr/__tests__/aggregate.cli.test.ts`](../../scripts/cr/__tests__/aggregate.cli.test.ts)
  - [`scripts/cr/__tests__/orchestrate.test.ts`](../../scripts/cr/__tests__/orchestrate.test.ts)
  - [`scripts/cr/__tests__/orchestrate.integration.test.ts`](../../scripts/cr/__tests__/orchestrate.integration.test.ts)
  - [`scripts/cr/__tests__/delta.test.ts`](../../scripts/cr/__tests__/delta.test.ts)
  - [`scripts/cr/__tests__/overwrite-guard.test.ts`](../../scripts/cr/__tests__/overwrite-guard.test.ts)
  - [`scripts/cr/__tests__/in-progress-guard.test.ts`](../../scripts/cr/__tests__/in-progress-guard.test.ts)
  - [`scripts/cr/__tests__/escalate.test.ts`](../../scripts/cr/__tests__/escalate.test.ts)
  - [`scripts/cr/__tests__/lanes/manual.test.ts`](../../scripts/cr/__tests__/lanes/manual.test.ts)
  - [`scripts/cr/__tests__/lanes/codex.test.ts`](../../scripts/cr/__tests__/lanes/codex.test.ts)
  - [`scripts/cr/__tests__/lanes/subagent.test.ts`](../../scripts/cr/__tests__/lanes/subagent.test.ts)
  - [`scripts/cr/__tests__/lanes/standalone.test.ts`](../../scripts/cr/__tests__/lanes/standalone.test.ts)
  - [`scripts/garden/detectors/__tests__/override-audit.test.ts`](../../scripts/garden/detectors/__tests__/override-audit.test.ts)

<!-- /generated: resources -->
