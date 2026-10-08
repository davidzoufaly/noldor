---
area: tooling
category: Tooling
deps: []
entry-id: Q-0341
links:
  code: []
  tests: []
  spec: >-
    docs/design/specs/2026-10-08-graph-and-main-freshness-before-coding-design.md
name: Graph and Main Freshness Before Coding
packages:
  - scripts
phase: in-progress
since: 2026-10-07T00:00:00.000Z
noldor-tier: specs-only
---

## Summary

Graph freshness is checked once per session, at the spec's structural-read step, and never again (surfaced 2026-10-04, charuy Q-0145). `noldor-spec` step 1.7 runs `design graph-context`, rebuilds on `stale`, reads the digest, then restores `graphify-out/`. Nothing re-checks before implementation starts, during it, or before the code-stage CR, so a long session (spec → 3 review rounds → code) can plan and code against a graph the tree has moved past, and other sessions' merges to `origin/main` mid-session are never pulled in. Worktrees branch from `origin/main` at create time and `pr-flow` fetches at the end, but nothing fetches in between. Options: (a) gate Step 3.5 (rule brief before the first edit) also runs `design graph-context` over the files about to be touched and rebuilds locally on `stale` (~15 s, restored afterwards, never committed); (b) a `git fetch origin main` + "main moved N commits since worktree create" notice at the same seam, so the operator can merge main in before coding rather than at push.

## Diagram

<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or
     two beside it for readers that do not render mermaid. No shape worth drawing?
     Replace this comment with: noldor:cut <reason> -->

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: graph-and-main-freshness-before-coding -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/2026-10-08-graph-and-main-freshness-before-coding-design.md`](../../docs/design/specs/2026-10-08-graph-and-main-freshness-before-coding-design.md)

<!-- /generated: resources -->
