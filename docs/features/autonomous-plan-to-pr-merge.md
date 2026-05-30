---
area: tooling
category: Tooling
deps:
  - specs-cr-gate-multi-reviewer
links:
  code:
    - .claude/skills/gate/SKILL.md
    - scripts/cr/orchestrate.ts
    - scripts/noldor/pr-flow-cli.ts
    - scripts/noldor/pr-flow.ts
    - scripts/noldor/session.ts
    - scripts/noldor/set-autonomous.ts
  tests:
    - src/core/__tests__/pr-flow-cli.test.ts
    - src/core/__tests__/session.test.ts
    - src/cr/__tests__/in-progress-guard.test.ts
    - src/cr/__tests__/orchestrate.test.ts
    - src/cr/__tests__/overwrite-guard.test.ts
name: Autonomous Execution from Plan Confirm → PR Merge
packages:
  - scripts
phase: done
noldor-tier: specs-only
introduced: 0.6.0
---
## Summary

After the operator confirms the `superpowers:writing-plans` output, execution proceeds autonomously through implementation, review, PR creation, and merge — no further human checkpoints between plan-confirm and PR-merged. Today the flow stops at multiple seams (post-plan, post-implementation, post-review, pre-PR, pre-merge); each stop loses momentum and forces context reload. Scope: identify every interactive prompt / `AskUserQuestion` / pause between `superpowers:writing-plans` confirm and `pr-flow.openAndAutoMerge` completion; gate them behind autonomy mode; preserve safety rails (CR gate failures, test failures, override prompts) but auto-proceed on green.

## User Story

As an agentic operator running `/gate` on a specs-only or full feature, I want to mark the session as autonomous at the plan-stage Step 2.5 continue-dialog so that all downstream prompts (commit-confirm, code-stage lane picker, address-blockers dialog, overwrite/in-progress guards, PR-approval gate) are auto-defaulted through PR-merge — leaving only the safety-rail `cr:escalate` dialog (configurable via `autonomous.onFailure`) interactive on red.

## Usage

```
/gate                                              # interactive path picker (or --resume <slug>)
# ... brainstorming/spec/plan flow per path ...
# At plan-stage Step 2.5 continue-dialog, pick `proceed-autonomous`
# → runs `pnpm noldor:set-autonomous` (sets `session.autonomous = true` in `.noldor/session.json`)
# Gate controller executes plan tasks inline, runs end-of-flow, opens PR, auto-merges, cleans up.
```

The autonomous flag persists for the rest of the session — there is no operator-facing "exit autonomous" command. The session marker is cleared by post-merge cleanup. To exit mid-session on red, configure `autonomous.onFailure: 'prompt'` (the default) — `cr:escalate` then fires its interactive dialog despite the autonomous flag.

## PRs

<!-- @prs-since-last-release: autonomous-plan-to-pr-merge -->

## Changelog

<!-- generated: resources -->

## Resources

- **Code:**
  - [`.claude/skills/gate/SKILL.md`](../../.claude/skills/gate/SKILL.md)
  - [`scripts/cr/orchestrate.ts`](../../scripts/cr/orchestrate.ts)
  - [`scripts/noldor/pr-flow-cli.ts`](../../scripts/noldor/pr-flow-cli.ts)
  - [`scripts/noldor/pr-flow.ts`](../../scripts/noldor/pr-flow.ts)
  - [`scripts/noldor/session.ts`](../../scripts/noldor/session.ts)
  - [`scripts/noldor/set-autonomous.ts`](../../scripts/noldor/set-autonomous.ts)
- **Tests:**
  - [`scripts/cr/__tests__/in-progress-guard.test.ts`](../../scripts/cr/__tests__/in-progress-guard.test.ts)
  - [`scripts/cr/__tests__/orchestrate.test.ts`](../../scripts/cr/__tests__/orchestrate.test.ts)
  - [`scripts/cr/__tests__/overwrite-guard.test.ts`](../../scripts/cr/__tests__/overwrite-guard.test.ts)
  - [`scripts/noldor/__tests__/pr-flow-cli.test.ts`](../../scripts/noldor/__tests__/pr-flow-cli.test.ts)
  - [`scripts/noldor/__tests__/session.test.ts`](../../scripts/noldor/__tests__/session.test.ts)

<!-- /generated: resources -->
