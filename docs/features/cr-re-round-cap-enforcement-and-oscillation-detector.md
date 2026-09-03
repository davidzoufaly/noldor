---
area: tooling
category: Tooling
deps: []
entry-id: Q-0170
links:
  code: []
  tests: []
name: CR Re-Round Cap Enforcement and Oscillation Detector
packages:
  - scripts
phase: in-progress
since: 2026-08-23
noldor-tier: specs-only
---

## Summary

Q-0130's re-round cap (2) is enforced in one half of the loop and asserted in the other. `AUTOFIX_ROUND_CAP` is a real bound on the auto-fix seam, but only `cr autofix record` writes the ledger it reads — an operator-driven round writes nothing, `cr orchestrate` has no round counter at all, and the combined bound is prose in a skill file. The cost is measurable: of 41 unique `Noldor-Path-Override` trailers in this repo's history, 23 name a CR round or convergence failure. The Q-0146 code CR ran 12 rounds, the reviewer finding one new med per round indefinitely while codex oscillated against its own round-4 demand and re-flagged documented `noldor:cut` sites five times.

This feature ships the enforcement half. `cr orchestrate` records every arbitration round in the existing ledger and refuses to dispatch past the cap, printing the round history and naming the `Noldor-Path-Override` remedy. A dispatch counts as a round only when it arbitrates unresolved blockers, so the extra dispatch a capped-then-fixed session needs to re-mint its `HEAD^{tree}`-bound receipt is never refused. Separately it closes the codex cut-marker gap at its source: the codex prompt is built in `run-codex.ts` and carries no cut guide and no `.noldor/rules/` cascade, so codex had never been told that a marked cut is a decision — which accounts for five of those twelve wasted rounds on its own.

The oscillation detector, locatable findings, the `noldor:cut` code-comment scanner and the machine-readable arbitration record are carved to **Q-0209** (`split-from: Q-0170`), which builds on this counter.

## Diagram

<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or
     two beside it for readers that do not render mermaid. No shape worth drawing?
     Replace this comment with: noldor:cut <reason> -->

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: cr-re-round-cap-enforcement-and-oscillation-detector -->

## Changelog
