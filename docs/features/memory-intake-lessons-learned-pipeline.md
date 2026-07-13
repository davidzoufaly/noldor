---
area: tooling
category: Tooling
deps: []
entry-id: Q-0026
links:
  code: []
  tests: []
name: Memory-Intake / Lessons-Learned Pipeline
packages:
  - scripts
phase: in-progress
since: 2026-07-07
noldor-tier: specs-only
---

## Summary

Systemic self-capture so the framework routinely absorbs ephemeral operator/agent knowledge into itself instead of depending on an out-of-repo assistant memory (the 2026-07-07 audit that produced Q-0019..Q-0025 was a one-time manual sweep). The intake is deliberately minimal: a `## Lessons` capture section in the existing `ideas.md` inbox (no new file, no new CLI) plus one skill — `/noldor-absorb` — that classifies each unfiled lesson (`drop` shipped-historical / `gotcha` → docs / `actionable` → triage queue / `feedback` → runbooks) and files it, stamping `[absorbed YYYY-MM-DD → <dest>]` on the source bullet. Goal: framework stays self-aware and self-owned with zero dependency on any single assistant's private memory. Speculative — validate the manual loop pays off before automating.

The one-time migration of the existing Claude memories into the framework is split out as its own follow-up entry (seeded in `ideas.md` for triage); this FD ships the mechanism only.

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: memory-intake-lessons-learned-pipeline -->

## Changelog
