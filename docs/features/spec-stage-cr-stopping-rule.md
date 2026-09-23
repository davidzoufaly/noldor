---
area: tooling
category: Tooling
deps: []
entry-id: Q-0263
links:
  code: []
  tests: []
name: Spec-Stage CR Stopping Rule
packages:
  - scripts
phase: in-progress
since: 2026-09-23
noldor-tier: specs-only
---

## Summary

Spec-stage review almost never ends green. In Charuy, spec stages ended green in 1 of 34 PRs, and no spec was ever green on round 1. In Noldor, 28 of 29 spec series since Aug 20 ended red, and no multi-round series converged. Blocker counts stay flat from round to round (15 → 15 → 14, 8 → 9 → 11) while specs grow (#148 went from 279 to 520 lines), so each round buys more surface for the next. Part of this comes from the prompt. The codex artifact prompt (`src/cr/run-codex.ts:126`) demands that "placeholder / TODO / unfilled content" be resolved, yet it is fed the FD, whose TODO stubs are filled after the spec by design; this produced repeated blockers on #148 and #113. Define what blocks at the spec stage: a missing or contradictory requirement, an infeasible design, or a risk the operator has not accepted. Wording, formatting, cross-references and FD TODO stubs never block, and FD stubs stop being fed as spec content. Consider a hard stop: after the second spec round, a finding can block only if it meets that definition and the operator has not already adjudicated it. Deletion test: a spec whose remaining findings are wording, formatting or FD-stub TODOs is green.

## Diagram

<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or
     two beside it for readers that do not render mermaid. No shape worth drawing?
     Replace this comment with: noldor:cut <reason> -->

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: spec-stage-cr-stopping-rule -->

## Changelog
