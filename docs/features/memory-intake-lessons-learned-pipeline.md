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
phase: done
since: 2026-07-07T00:00:00.000Z
noldor-tier: specs-only
---
## Summary

Systemic self-capture so the framework routinely absorbs ephemeral operator/agent knowledge into itself instead of depending on an out-of-repo assistant memory (the 2026-07-07 audit that produced Q-0019..Q-0025 was a one-time manual sweep). The intake is deliberately minimal: a `## Lessons` capture section in the existing `ideas.md` inbox (no new file, no new CLI) plus one skill — `/noldor-absorb` — that classifies each unfiled lesson (`drop` shipped-historical / `gotcha` → docs / `actionable` → triage queue / `feedback` → runbooks) and files it, stamping `[absorbed YYYY-MM-DD → <dest>]` on the source bullet. Goal: framework stays self-aware and self-owned with zero dependency on any single assistant's private memory. Speculative — validate the manual loop pays off before automating.

The one-time migration of the existing Claude memories into the framework is split out as its own follow-up entry (seeded in `ideas.md` for triage); this FD ships the mechanism only.

## User Story

As an operator or agent, I want to drop a hard-won lesson under `## Lessons` in `ideas.md` and run one skill to classify and file it into the framework's own docs, so that operational knowledge lives in the repo — visible to every consumer and future agent — without a new tool, file, or CLI to learn.

## Usage

**UI**

1. Add a top-level `-` bullet under `## Lessons` in `ideas.md` (plain edit — no command needed).
2. Run `/noldor-absorb`.
3. Review the proposed disposition table (`drop | gotcha | actionable | feedback` per bullet) and batch-confirm; override any row.
4. Confirmed lessons are filed (`gotcha`/`feedback` → `docs/noldor/` page + template twin; `actionable` → `## Verticals → #### Later` for `/noldor-triage`) and stamped `[absorbed YYYY-MM-DD → <dest>]`.

## PRs

<!-- @prs-since-last-release: memory-intake-lessons-learned-pipeline -->

## Changelog
