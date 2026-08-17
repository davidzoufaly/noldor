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

A `docs/architecture/` folder holding four hand-drawn mermaid diagrams that answer "how is this system shaped" above the per-feature level: `context` (the system, its actors, the externals it talks to), `containers` (deployable and runnable units — FE app, BE service, DB, worker, CLI, infra), `modules` (internal dependency direction and which module owns which durable state) and `flows` (the load-bearing runtime flows). The framework ships the registry, a presence validator, an advisory staleness check, scaffold-only templates, a garden detector, an SDD-report gap and a release probe; consumers write the content. One surface serves both a consumer repo and Noldor itself, which fills the same four pages.

Before this, a repo documented features, designs and conventions but nothing above them, so intentional constraints — source-at-runtime packaging, adoption-safe advisories, sequential queue writes, graph fallbacks — read as accidental bugs, and cross-module seams such as repository mutation (Q-0109) and snapshot ownership (Q-0110) stayed implicit. Deletion test: a new reader should not have to traverse archived plans to answer "which module owns repository paths, writes, and review completion?"

Scoped out at design time: decision records (`docs/adr/`) are a different artifact with a different lifecycle and are not part of this surface, and a dashboard route for the folder is roadmap entry Q-0134.

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: consumer-architecture-doc-surface -->

## Changelog
