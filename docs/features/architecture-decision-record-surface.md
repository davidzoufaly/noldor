---
area: docs
category: Tooling
deps: []
entry-id: Q-0135
links:
  code: []
  tests: []
name: Architecture Decision Record Surface
packages:
  - package.json
phase: in-progress
since: 2026-08-17
noldor-tier: specs-only
---

## Summary

Q-0093 shipped `docs/architecture/` and explicitly carved decision records out of it — its Non-goals says ADRs are "a different artifact (append-only, dated, superseded-by chains) with a different lifecycle. Carved to a sibling roadmap entry" — but that sibling was never minted, so the shipped spec references an entry that does not exist. This is it. Wanted: `docs/adr/NNNN-<slug>.md` with validated frontmatter (`status: accepted | superseded`, `date`, `supersedes` / `superseded-by`), an append-only discipline the framework can check, and a `loadDocRoots` key. The demand is already concrete: `Package Runtime Representation ADR` (Q-0117) asks to record the source-at-runtime decision as an ADR and currently has nowhere to put it, and the read-only audit named source-at-runtime packaging, adoption-safe advisories, sequential queue writes and graph fallbacks as decisions whose reasoning survives only in archived specs. Deletion test: a reviewer can answer "why does this bind us today" without opening `docs/design/specs/archive/`. Decide during spec: whether a superseded record is validated for a forward pointer, and whether the surface reuses the architecture registry's opt-in rule so `noldor init` cannot block a consumer who has written no ADRs. (split from Q-0093 at design time, 2026-08-17)

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: architecture-decision-record-surface -->

## Changelog
