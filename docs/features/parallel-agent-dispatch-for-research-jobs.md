---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/research/types.ts
    - src/research/prompt.ts
    - src/research/staging.ts
    - src/research/fanout.ts
    - src/core/concurrency.ts
    - src/core/git-porcelain.ts
    - src/core/agent-runner/types.ts
    - src/cli/manifest.ts
    - .claude/skills/noldor-research/SKILL.md
    - docs/noldor/research-fanout.md
  tests:
    - src/core/__tests__/concurrency.test.ts
    - src/core/__tests__/git-porcelain.test.ts
    - src/core/agent-runner/__tests__/doctor-runners.test.ts
    - src/core/agent-runner/__tests__/registry.test.ts
    - src/core/agent-runner/__tests__/types.test.ts
    - src/research/__tests__/fanout.test.ts
    - src/research/__tests__/prompt.test.ts
    - src/research/__tests__/staging.test.ts
    - src/research/__tests__/types.test.ts
    - src/testing/__tests__/stub-runner.test.ts
  spec: >-
    docs/design/specs/archive/2026-07-01-parallel-agent-dispatch-for-research-jobs-design.md
name: Parallel-Agent Dispatch for Research Jobs
packages:
  - scripts
phase: done
noldor-tier: full
introduced: 0.5.0
---

## Summary

Noldor can fan out parallel _build_ agents (the K-concurrent drain) but has no first-class primitive for fanning out parallel _read/research_ agents — codebase research, multi-subsystem investigation, cross-file audits, "understand X before we spec it." Today an operator (or a gate/spec/plan flow) investigates these sequentially in one context: wastes wall-clock and pollutes the driving session's context. Inspired by `superpowers:dispatching-parallel-agents` — dispatch one context-isolated subagent per independent problem domain, each with focused scope + self-contained context (never inherits session history) + a required structured return, then synthesize and integrate.

**What to build (for brainstorm/spec):**

- A reusable dispatch primitive — a `noldor-dispatch-parallel` skill and/or `noldor research fanout` CLI — that takes N independent task specs, spawns one focused agent each (isolated context), enforces a structured return per agent, and synthesizes the results.
- Plug-in points: gate spec-stage ("research the codebase before writing the spec"), plan-stage investigation, `/noldor-garden` deep-dives, standalone operator research.
- Reuse existing parallel infra where it fits (drain concurrency cap, lane logging, agent-events) **without** coupling to the merge-coordinator — read agents don't write, so no worktree/merge serialization needed.
- MVP fallback (size S): a skill-only version that just codifies the pattern for the driving agent (focused scope, structured return, synthesis) — vendoring superpowers' approach adapted to Noldor. The CLI fanout primitive is the part that compounds; the spec stage decides skill-only vs CLI vs both.

**Open questions:** skill vs CLI vs both; synthesis model (one synth agent vs operator-reviewed findings table); concurrency cap + cost guardrails; relationship to harness-native Workflow/Agent tools vs a Noldor-owned wrapper; whether read-agents surface in the drain's agent-events log.

## User Story

As a driving agent or operator facing several independent read-only questions (codebase research, multi-subsystem investigation, pre-spec understanding), I want to dispatch one context-isolated researcher agent per question in parallel and get back structured findings plus a synthesized index, so that wall-clock shrinks and my own context window stays clean for design work.

## Usage

**CLI — quick questions**

```bash
pnpm noldor research fanout --task "How does the CR overwrite-guard decide archive vs skip?" --task "Where are drain eligibility rules enforced?"
```

**CLI — full task specs (+ synthesis)**

```bash
pnpm noldor research fanout --tasks tasks.json --synthesize --max 4 --timeout 900000
# → .noldor/research/2026-07-01-142233/{INDEX.md,SYNTHESIS.md,<id>.findings.md,manifest.json}
```

`tasks.json`: `{ "tasks": [{ "id": "cr-guard", "question": "…", "scope": ["src/cr/"], "context": "…", "expects": "…" }] }`

Exit code 0 means every agent ran and parsed — not that questions were answered; read the INDEX status column.

**Skill (driving agent)**

1. Invoke `noldor-research` when facing ≥ 2 independent read-only questions.
2. Decompose into independent task specs (self-contained context, one question each) and write the tasks file.
3. Run the fanout, read `INDEX.md` (+ `SYNTHESIS.md` / selected findings), synthesize into the spec/plan/audit being written.

**Keyboard shortcut**

_none — CLI/framework feature, no UI surface._

**Agent API**

_none — operates through the `pnpm noldor` CLI; agents invoke it via Bash._

## PRs

<!-- @prs-since-last-release: parallel-agent-dispatch-for-research-jobs -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/archive/2026-07-01-parallel-agent-dispatch-for-research-jobs-design.md`](../../docs/design/specs/archive/2026-07-01-parallel-agent-dispatch-for-research-jobs-design.md)
- **Code:**
  - [`src/research/types.ts`](../../src/research/types.ts)
  - [`src/research/prompt.ts`](../../src/research/prompt.ts)
  - [`src/research/staging.ts`](../../src/research/staging.ts)
  - [`src/research/fanout.ts`](../../src/research/fanout.ts)
  - [`src/core/concurrency.ts`](../../src/core/concurrency.ts)
  - [`src/core/git-porcelain.ts`](../../src/core/git-porcelain.ts)
  - [`src/core/agent-runner/types.ts`](../../src/core/agent-runner/types.ts)
  - [`src/cli/manifest.ts`](../../src/cli/manifest.ts)
  - [`.claude/skills/noldor-research/SKILL.md`](../../.claude/skills/noldor-research/SKILL.md)
  - [`docs/noldor/research-fanout.md`](../../docs/noldor/research-fanout.md)
- **Tests:**
  - [`src/core/__tests__/concurrency.test.ts`](../../src/core/__tests__/concurrency.test.ts)
  - [`src/core/__tests__/git-porcelain.test.ts`](../../src/core/__tests__/git-porcelain.test.ts)
  - [`src/core/agent-runner/__tests__/doctor-runners.test.ts`](../../src/core/agent-runner/__tests__/doctor-runners.test.ts)
  - [`src/core/agent-runner/__tests__/registry.test.ts`](../../src/core/agent-runner/__tests__/registry.test.ts)
  - [`src/core/agent-runner/__tests__/types.test.ts`](../../src/core/agent-runner/__tests__/types.test.ts)
  - [`src/research/__tests__/fanout.test.ts`](../../src/research/__tests__/fanout.test.ts)
  - [`src/research/__tests__/prompt.test.ts`](../../src/research/__tests__/prompt.test.ts)
  - [`src/research/__tests__/staging.test.ts`](../../src/research/__tests__/staging.test.ts)
  - [`src/research/__tests__/types.test.ts`](../../src/research/__tests__/types.test.ts)
  - [`src/testing/__tests__/stub-runner.test.ts`](../../src/testing/__tests__/stub-runner.test.ts)

<!-- /generated: resources -->
