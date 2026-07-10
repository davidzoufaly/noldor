---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/triage/merge-candidates.ts
    - src/triage/merge-candidates-cli.ts
    - src/core/fd-load.ts
    - src/cli/manifest.ts
    - .claude/skills/noldor-triage/SKILL.md
  tests:
    - src/core/__tests__/fd-load.test.ts
    - src/triage/__tests__/merge-candidates.test.ts
  spec: >-
    docs/superpowers/specs/2026-07-06-sdd-detector-5-idea-merge-semantic-similarity-design.md
name: SDD Detector 5 — Idea-Merge Semantic Similarity
packages:
  - scripts
phase: done
noldor-tier: full
entry-id: Q-0003
introduced: 0.5.0
---
## Summary

When `/noldor-triage` proposes targets for ideas in `ideas.md`, a `triage merge-candidates` CLI emits the full merge-candidate corpus — every FD, roadmap block, and backlog block — as structured JSON, and `/noldor-triage`'s LLM ranks the top-3 `merge:<slug>` hosts per idea and surfaces them in the confirmation table. Reduces hand-judgment burden in `/noldor-triage` and biases toward merging into existing host FDs (per CLAUDE.md `/noldor-triage` rubric). The original "semantic similarity via graphify / community labels" framing was dropped at spec time — graphify's AST graph carries no feature-level embeddings, and Noldor's offline/deterministic posture rules out an external embedding model; ranking is deterministic-corpus + in-skill LLM judgment, no embeddings or network (see the linked spec). Trigger: when next batch of ideas accumulates and triage feels noisy.

Scope carried from the source roadmap block:

- Strengthen merge-first behavior — `/noldor-triage` should propose merging into existing roadmap/backlog blocks before suggesting new entries, with the candidate-host list surfaced explicitly in the confirmation table (today the bias is implicit).
- When checking an FD, also scan backlog for other candidates for the same FD → suggest a new FD with higher confidence so it stays useful later too.

## User Story

As an operator (or triage agent) running `/noldor-triage`, I want the merge-candidate hosts surfaced as an explicit ranked shortlist drawn from all FDs, roadmap, and backlog entries — with FD matches proposed as parent-linked new entries — so that I fold new ideas into existing work instead of scattering near-duplicate entries that `/noldor-garden` later flags.

## Usage

**CLI**

- `pnpm noldor triage merge-candidates` — print a human-readable table of every merge candidate (`kind · slug · name · disposition`) for eyeballing.
- `pnpm noldor triage merge-candidates --json` — emit the candidate corpus as JSON; consumed by `/noldor-triage`.

**Triage integration**

- `/noldor-triage` calls `merge-candidates --json` once per run. For each untriaged idea it ranks the corpus and surfaces the top-3 considered hosts as a `cands: a, b, c` annotation in the confirmation table.
- Disposition per match: a roadmap/backlog host → `merge:<slug>` (sub-bullet append); an FD host → a new entry carrying `parent:<fd-slug>` (attach intent for a later `/noldor-promote`); no match → a parent-less new entry.

## PRs

<!-- @prs-since-last-release: sdd-detector-5-idea-merge-semantic-similarity -->

## Changelog
