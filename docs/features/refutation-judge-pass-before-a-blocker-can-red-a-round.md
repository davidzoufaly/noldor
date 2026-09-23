---
area: tooling
category: Tooling
deps: []
entry-id: Q-0262
links:
  code: []
  tests: []
name: Refutation Judge Pass Before a Blocker Can Red a Round
packages:
  - scripts
phase: in-progress
since: 2026-09-23
noldor-tier: specs-only
---

## Summary

Some blockers are simply wrong, and today nothing checks a claim before it turns a round red. In Charuy, 51 blockers (2.2%) contradicted the code they cited. 92% of them came from codex, and several were repeated across rounds: "announces its runId" kept coming back after a rebuttal (#179), and "upgrades unrelated dependencies" was filed although the base lockfile already had those versions (#126). In Noldor, codex's "placeholder classification can never succeed" was false five rounds in a row (#405). The panther claude-reviewer (gooddata/gdc-mastercard-panther `.github/claude-reviewer`) handles this with a judge: a cheap second model reads the diff plus the emitted findings and tries to refute each one with concrete contrary evidence. It drops only refuted findings and fails open, keeping everything when the result is inconclusive or the judge errors. Add the same pass after the lanes finish and before aggregate. A refuted blocker is demoted to a note that carries the judge's evidence, never silently dropped. Context leaks cause part of this class and may deserve their own fix. A framework-only rule vendored into a consumer's `.claude/engineering-rules.md` produced 27 Charuy blockers demanding a `templates/` twin in a repo that has none. Stale-base two-dot diffs caused others (#214, #109). Deletion test: a blocker whose cited line contradicts its claim is demoted, with the judge's evidence attached.

The two context-leak causes are carved out as their own entries: the framework-only rule leak to **Q-0264** and the stale-base two-dot diff to **Q-0265** (both `split-from: Q-0262`). This feature is the judge pass alone.

## Diagram

<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or
     two beside it for readers that do not render mermaid. No shape worth drawing?
     Replace this comment with: noldor:cut <reason> -->

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: refutation-judge-pass-before-a-blocker-can-red-a-round -->

## Changelog
