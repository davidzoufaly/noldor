---
area: docs
category: Tooling
deps: []
entry-id: Q-0093
links:
  code: []
  tests: []
name: Consumer Architecture Doc Surface
packages:
  - noldor
phase: in-progress
since: 2026-08-11
noldor-tier: specs-only
---

## Summary

Consumers get feature MDs, specs, and plans but no architecture surface — no place that answers "how is this system shaped" above the per-feature level. Idea: a dedicated folder of architecture file(s) in the consumer doc tree, with diagramming. Needs a scoping spike before promotion: whether the content is hand-authored or derived from the graphify AST graph (which already has communities and edges), whether the diagrams are generated or drawn, and how the surface avoids becoming the stalest page in the tree.

The same gap holds for Noldor itself, and the scoping spike should decide whether one surface serves both or whether framework-internal architecture is a separate promotable item. The repo has rich feature docs and 107 design artifacts but no root `CONTEXT.md`, no module map and no `docs/adr/`, so maintainers and agents infer current architecture and rationale from 47k runtime LOC plus historical specs whose links are already stale (Q-0098). That makes unusual but intentional constraints — source-at-runtime packaging, adoption-safe advisories, sequential queue writes, graph fallbacks — read as accidental bugs, while genuine cross-module seams such as repository mutation (Q-0109) and snapshot ownership (Q-0110) stay implicit. Wanted: a concise current map in the project's own domain vocabulary showing major modules, dependency direction, durable state, entry points, and where each decision record lives, plus ADRs for active consequential choices rather than backfilled history. Deletion test: a new reader should not have to traverse archived plans to answer "which module owns repository paths, writes, and review completion?"

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: consumer-architecture-doc-surface -->

## Changelog
