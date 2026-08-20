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
    - src/cr/autofix.ts
    - src/cr/autofix-cli.ts
    - src/cr/autofix-ledger.ts
    - src/cr/finding-class.ts
    - src/cr/escalate.ts
    - src/cr/escalate-cli.ts
    - src/cr/findings-schema.ts
    - src/cr/lane-types.ts
    - src/cr/filename.ts
    - src/cr/atomic-write.ts
    - src/cr/read-fd-summary.ts
    - src/core/config.ts
    - src/core/prompt-stdin.ts
    - src/cr/orchestrate-args.ts
    - src/cr/codex.ts
    - src/cr/codex-failure.ts
    - src/cr/extract-json.ts
    - src/cr/run-codex.ts
    - src/cr/lanes/manual.ts
    - src/cr/lanes/codex.ts
    - src/cr/lanes/subagent.ts
    - src/cr/lanes/subagent-dispatch.ts
    - src/cr/standalone-prompt.md
    - src/cr/lanes/escalate-prompt.md
    - src/validate/noldor-config.ts
    - src/garden/detectors/override-audit.ts
    - .claude/skills/noldor-gate/SKILL.md
    - .noldor/config.json
  tests:
    - src/core/__tests__/config.test.ts
    - src/core/__tests__/lanes.test.ts
    - src/core/__tests__/prompt-stdin.test.ts
    - src/cr/__tests__/aggregate.test.ts
    - src/cr/__tests__/atomic-write.test.ts
    - src/cr/__tests__/autofix-cli.test.ts
    - src/cr/__tests__/autofix-ledger.test.ts
    - src/cr/__tests__/autofix.test.ts
    - src/cr/__tests__/codex-failure.test.ts
    - src/cr/__tests__/codex.test.ts
    - src/cr/__tests__/deep-review-spawn.test.ts
    - src/cr/__tests__/delta.test.ts
    - src/cr/__tests__/escalate.test.ts
    - src/cr/__tests__/filename.test.ts
    - src/cr/__tests__/finding-class.test.ts
    - src/cr/__tests__/findings-schema.test.ts
    - src/cr/__tests__/lanes/codex.test.ts
    - src/cr/__tests__/lanes/manual.test.ts
    - src/cr/__tests__/lanes/subagent-dispatch.test.ts
    - src/cr/__tests__/lanes/subagent.test.ts
    - src/cr/__tests__/lanes/verify.test.ts
    - src/cr/__tests__/orchestrate.integration.test.ts
    - src/cr/__tests__/orchestrate.test.ts
    - src/cr/__tests__/overwrite-guard.test.ts
    - src/cr/__tests__/prior-review.test.ts
    - src/cr/__tests__/read-fd-summary.test.ts
    - src/garden/detectors/__tests__/override-audit.test.ts
    - src/metrics/__tests__/cr-and-override.test.ts
    - src/validate/__tests__/noldor-config.test.ts
  spec: lost-pre-extraction
name: Specs/Plan CR Gate — Multi-Reviewer + Multiterminal Bug Fix
packages:
  - scripts
phase: done
noldor-tier: full
introduced: 0.6.0
---

## Summary

Layer a CR gate at the spec/plan stage (before code) with parallel reviewers, orchestrated by `pnpm noldor cr orchestrate --kind <spec|plan|code>`: `manual` (operator pass over the artifact); `codex` (`pnpm noldor cr codex`, opt-in per `crLanes`; unioned automatically at `--kind spec` / `--kind code` on M/L/XL sessions); `reviewer` (senior-reviewer subagent over the artifact diff — a self-contained `claude -p` prompt in [`src/cr/lanes/subagent-dispatch.ts`](../../src/cr/lanes/subagent-dispatch.ts), mandatory at `--kind spec` / `--kind plan`); `verifier` (acceptance-verification lane); and `standalone` (a spawned separate terminal running `claude` with max-thinking, reusing the multiterminal-development flow). Each lane writes `.noldor/cr/<slug>-<kind>-<lane>.json`; `cr aggregate` decides green/red and `cr escalate` / `cr autofix` handle a red. Outcomes feed back into the spec/plan before promotion to code. Closes the early-feedback gap at `/noldor-gate` Step 2.5.

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

**UI**

_none — the CR gate is CLI + skill-driven; `/noldor-gate` Step 2.5 and Step 4 invoke it._

**Keyboard shortcut**

- _none_ — not an editor surface.

**Agent/Programmatic API**

- `pnpm noldor cr orchestrate --slug <slug> --artifact <path> --kind <spec|plan|code> [--lanes <list>] [--base-sha <sha>] [--profile <name>] [--autonomous]` — run the review lanes for one artifact. Exit 0 = every sync lane clean, 1 = blockers. `reviewer` is unioned into every `spec`/`plan` lane set, so neither `--lanes` nor `crLanes.<kind>` can ship an unreviewed artifact. Sinks land at `.noldor/cr/<slug>-<kind>-<lane>.json`.
- `pnpm noldor cr aggregate --slug <slug> [--kind <kind>] [--wait-ms <n>]` — collapse the lane sinks into one verdict; `--wait-ms` polls for lanes still running.
- `pnpm noldor cr autofix plan --slug <slug> --kind <kind>` — decide whether the gate may fix this round unattended. Prints `verdict:` (`auto-fix` / `decline`), `reason:`, an authoritative `base-sha:` for the re-round, `round: n/2`, and the blockers split into `M<n>` (mechanical) and `D<n>` (design). Exit 0 = auto-fix, 10 = decline, 2 = error; the gate treats **any** non-zero as a decline. Requires `autonomous.onBlockers: "auto-fix"` in `.noldor/config.json` (default `prompt` → exit 10, `reason: knob-off`).
- `pnpm noldor cr autofix record --slug <slug> --kind <kind> --applied <n> --deferred <n> [--stopped <reason>]` — append the round you just applied. The controller applies the `M<n>` blockers between the two calls; the framework never edits an artifact itself. Bounded at 2 rounds per gate session plus a no-progress stop, tracked in `.noldor/cr/autofix/<slug>-<kind>.json`.
- `pnpm noldor cr escalate --slug <slug> --reason <cr-red|test-red> --context-file <path> [--autonomous]` — the failure dialog when auto-fix declines or is off. Exit 0 = spawned deep review or override, 1 = abort, 10 = retry implementation. `--autonomous` takes the outcome from `autonomous.onFailure`.
- `pnpm noldor cr bootstrap --slug <slug>` — stamp the bootstrap override on a gate-introducing feature branch.
- `pnpm noldor cr codex --plan|--spec <path> [--slug <slug>] [--base-sha <sha>] [--full-review]` — the `codex` lane's own CLI, which orchestrate shells out to. Prints `{ summary, findings }` to stdout and exits 0 whenever codex ran: findings travel in the JSON, so a non-zero exit means infrastructure failure rather than review output. `--slug` loads `docs/features/<slug>.md` as review context; `--base-sha` scopes the review to the artifact's diff since that sha.
- `pnpm noldor cr codex [--working | <sha> | <from>..<to>] [--paths a,b] [--rerun] [--dry-run]` — the code-review forms. The bare gate form reviews `main...HEAD` and amends `Noldor-Reviewed-Codex` on a clean pass; the others write a sidecar with no trailer.
- A codex failure names the CLI version that produced it, appends `run: codex login` when the stderr looks auth-shaped, and carries a bounded stderr tail labelled with its true byte count; a green run records no stderr. `crReview.dispatchTimeoutMs` caps this lane like the others (default 900,000 ms).
- Reviewer lanes tag each blocker `[mechanical]` / `[design]`; the tag is lifted into `Finding.class` in the sink. An untagged blocker reads as `design`, so it always routes to a human.
- Re-rounds carry prior context automatically: when the prior reviewer sink holds blockers, orchestrate attaches them to the reviewer prompt — framed `fixes-in-diff` when `--base-sha` verified a non-empty diff, `reexamine` otherwise (fullReviewOverride, explicit `--full-review`) — capped at 20 blockers; first rounds and green priors are unchanged. `--full-review` now genuinely reviews the whole artifact (equal prompt shas) while binding-rules resolution keeps the real change base.

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
  - [`src/cr/autofix.ts`](../../src/cr/autofix.ts)
  - [`src/cr/autofix-cli.ts`](../../src/cr/autofix-cli.ts)
  - [`src/cr/autofix-ledger.ts`](../../src/cr/autofix-ledger.ts)
  - [`src/cr/finding-class.ts`](../../src/cr/finding-class.ts)
  - [`src/cr/escalate.ts`](../../src/cr/escalate.ts)
  - [`src/cr/escalate-cli.ts`](../../src/cr/escalate-cli.ts)
  - [`src/cr/findings-schema.ts`](../../src/cr/findings-schema.ts)
  - [`src/cr/lane-types.ts`](../../src/cr/lane-types.ts)
  - [`src/cr/filename.ts`](../../src/cr/filename.ts)
  - [`src/cr/atomic-write.ts`](../../src/cr/atomic-write.ts)
  - [`src/cr/read-fd-summary.ts`](../../src/cr/read-fd-summary.ts)
  - [`src/core/config.ts`](../../src/core/config.ts)
  - [`src/core/prompt-stdin.ts`](../../src/core/prompt-stdin.ts)
  - [`src/cr/orchestrate-args.ts`](../../src/cr/orchestrate-args.ts)
  - [`src/cr/codex.ts`](../../src/cr/codex.ts)
  - [`src/cr/codex-failure.ts`](../../src/cr/codex-failure.ts)
  - [`src/cr/extract-json.ts`](../../src/cr/extract-json.ts)
  - [`src/cr/run-codex.ts`](../../src/cr/run-codex.ts)
  - [`src/cr/lanes/manual.ts`](../../src/cr/lanes/manual.ts)
  - [`src/cr/lanes/codex.ts`](../../src/cr/lanes/codex.ts)
  - [`src/cr/lanes/subagent.ts`](../../src/cr/lanes/subagent.ts)
  - [`src/cr/lanes/subagent-dispatch.ts`](../../src/cr/lanes/subagent-dispatch.ts)
  - [`src/cr/standalone-prompt.md`](../../src/cr/standalone-prompt.md)
  - [`src/cr/lanes/escalate-prompt.md`](../../src/cr/lanes/escalate-prompt.md)
  - [`src/validate/noldor-config.ts`](../../src/validate/noldor-config.ts)
  - [`src/garden/detectors/override-audit.ts`](../../src/garden/detectors/override-audit.ts)
  - [`.claude/skills/noldor-gate/SKILL.md`](../../.claude/skills/noldor-gate/SKILL.md)
  - [`.noldor/config.json`](../../.noldor/config.json)
- **Tests:**
  - [`src/core/__tests__/config.test.ts`](../../src/core/__tests__/config.test.ts)
  - [`src/core/__tests__/lanes.test.ts`](../../src/core/__tests__/lanes.test.ts)
  - [`src/core/__tests__/prompt-stdin.test.ts`](../../src/core/__tests__/prompt-stdin.test.ts)
  - [`src/cr/__tests__/aggregate.test.ts`](../../src/cr/__tests__/aggregate.test.ts)
  - [`src/cr/__tests__/atomic-write.test.ts`](../../src/cr/__tests__/atomic-write.test.ts)
  - [`src/cr/__tests__/autofix-cli.test.ts`](../../src/cr/__tests__/autofix-cli.test.ts)
  - [`src/cr/__tests__/autofix-ledger.test.ts`](../../src/cr/__tests__/autofix-ledger.test.ts)
  - [`src/cr/__tests__/autofix.test.ts`](../../src/cr/__tests__/autofix.test.ts)
  - [`src/cr/__tests__/codex-failure.test.ts`](../../src/cr/__tests__/codex-failure.test.ts)
  - [`src/cr/__tests__/codex.test.ts`](../../src/cr/__tests__/codex.test.ts)
  - [`src/cr/__tests__/deep-review-spawn.test.ts`](../../src/cr/__tests__/deep-review-spawn.test.ts)
  - [`src/cr/__tests__/delta.test.ts`](../../src/cr/__tests__/delta.test.ts)
  - [`src/cr/__tests__/escalate.test.ts`](../../src/cr/__tests__/escalate.test.ts)
  - [`src/cr/__tests__/filename.test.ts`](../../src/cr/__tests__/filename.test.ts)
  - [`src/cr/__tests__/finding-class.test.ts`](../../src/cr/__tests__/finding-class.test.ts)
  - [`src/cr/__tests__/findings-schema.test.ts`](../../src/cr/__tests__/findings-schema.test.ts)
  - [`src/cr/__tests__/lanes/codex.test.ts`](../../src/cr/__tests__/lanes/codex.test.ts)
  - [`src/cr/__tests__/lanes/manual.test.ts`](../../src/cr/__tests__/lanes/manual.test.ts)
  - [`src/cr/__tests__/lanes/subagent-dispatch.test.ts`](../../src/cr/__tests__/lanes/subagent-dispatch.test.ts)
  - [`src/cr/__tests__/lanes/subagent.test.ts`](../../src/cr/__tests__/lanes/subagent.test.ts)
  - [`src/cr/__tests__/lanes/verify.test.ts`](../../src/cr/__tests__/lanes/verify.test.ts)
  - [`src/cr/__tests__/orchestrate.integration.test.ts`](../../src/cr/__tests__/orchestrate.integration.test.ts)
  - [`src/cr/__tests__/orchestrate.test.ts`](../../src/cr/__tests__/orchestrate.test.ts)
  - [`src/cr/__tests__/overwrite-guard.test.ts`](../../src/cr/__tests__/overwrite-guard.test.ts)
  - [`src/cr/__tests__/prior-review.test.ts`](../../src/cr/__tests__/prior-review.test.ts)
  - [`src/cr/__tests__/read-fd-summary.test.ts`](../../src/cr/__tests__/read-fd-summary.test.ts)
  - [`src/garden/detectors/__tests__/override-audit.test.ts`](../../src/garden/detectors/__tests__/override-audit.test.ts)
  - [`src/metrics/__tests__/cr-and-override.test.ts`](../../src/metrics/__tests__/cr-and-override.test.ts)
  - [`src/validate/__tests__/noldor-config.test.ts`](../../src/validate/__tests__/noldor-config.test.ts)

<!-- /generated: resources -->
