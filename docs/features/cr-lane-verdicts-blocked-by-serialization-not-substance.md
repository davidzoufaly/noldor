---
area: tooling
category: Tooling
deps: []
entry-id: Q-0250
links:
  code:
    - src/cr/extract-json.ts
    - src/cr/lanes/prompt-parts.ts
    - src/cr/lanes/subagent.ts
    - src/cr/lanes/subagent-dispatch.ts
    - src/cr/lanes/verify.ts
    - src/cr/lanes/verify-dispatch.ts
    - src/cr/lanes/ui-review-dispatch.ts
    - src/cr/lanes/render-export-dispatch.ts
    - src/cr/aggregate.ts
    - src/cr/findings-schema.ts
    - src/core/agent-runner/capabilities.ts
    - src/core/agent-runner/runners/claude.ts
  tests: []
  spec: docs/design/specs/2026-09-22-cr-lane-verdicts-blocked-by-serialization-not-substance-design.md
name: CR Lane Verdicts Blocked by Serialization, Not Substance
packages:
  - scripts
phase: in-progress
since: 2026-09-22
noldor-tier: full
---

## Summary

Getting a green CR check is unreliable for reasons that have nothing to do with the code under review: a lane can approve a change and still red the round on how it wrote the answer down. Two confirmed mechanisms, both observed blocking a ship. **(1) The verify lane cannot report on a change whose evidence contains fenced code, because its own payload is a fence.** Shipping Q-0239 the verifier ran the full acceptance set twice and emitted `{"verdict":"pass"}` both times; `parseVerifyPayload` recovered neither, because the evidence quotes the ` ```bash ` blocks the change is about and the inner backticks close the outer fence early. The repair round failed identically, and `proseReportsSuccess` (`src/cr/lanes/verify.ts`) missed too — `PROSE_SUCCESS_RE` wants a `verifi*` stem or "all checks pass", which a verifier writing plainly never produces, while `PROSE_FAILURE_RE` vetoes on `\bmissing\b` / `\bwrong\b` / `\bcannot\b`, words that appear constantly in an honest description of what was tested. So the rescue valve is biased hard toward veto in exactly the rounds it exists to rescue, and the only exit was `Noldor-Path-Override`. **(2) A reviewer lane that writes `- (none)` under an empty severity bucket reds the round with phantom blockers.** Shipping Q-0246 the code-stage reviewer returned `summary: "approve"` yet its sink carried `[high]`/`[med]` blockers whose `message` was the literal string `(none)`; `cr aggregate` read `ok=false`, no receipt was minted, and `cr autofix plan` declined `no-mechanical` with nothing to apply. Candidate fixes: make the lane prompt demand a one-line machine verdict outside any fence (`NOLDOR-VERDICT: pass`) instead of pattern-matching free prose; have the extractor take the last balanced fence, or length-prefix the payload; drop a bullet whose text is empty or `(none)` (case-insensitive, parens optional); and stop `cr aggregate`'s `ok` from silently disagreeing with a lane's own `approve` summary. Deletion test: a change whose evidence contains fenced code, and a reviewer sink carrying `(none)` bullets, both produce the lane's real verdict. (found 2026-09-20 shipping Q-0239 / Q-0246)

## Diagram

<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or
     two beside it for readers that do not render mermaid. No shape worth drawing?
     Replace this comment with: noldor:cut <reason> -->

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: cr-lane-verdicts-blocked-by-serialization-not-substance -->

## Changelog
