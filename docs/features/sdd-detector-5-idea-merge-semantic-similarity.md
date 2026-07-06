---
area: tooling
category: Tooling
deps: []
links:
  code: []
  tests: []
  spec: docs/superpowers/specs/2026-07-06-sdd-detector-5-idea-merge-semantic-similarity-design.md
name: SDD Detector 5 — Idea-Merge Semantic Similarity
packages:
  - scripts
phase: in-progress
noldor-tier: full
entry-id: Q-0003
---

## Summary

Standalone graphify enhancement (not in the substrate family). When `/triage` proposes targets for ideas in `ideas.md`, compute semantic similarity between idea text and existing FD names + community labels via graphify; surface top-3 `merge:<slug>` candidates ranked by similarity. Reduces hand-judgment burden in `/triage` and biases toward merging into existing host FDs (per CLAUDE.md `/triage` rubric). Trigger: when next batch of ideas accumulates and triage feels noisy.

Scope carried from the source roadmap block:

- Strengthen merge-first behavior — `/triage` should propose merging into existing roadmap/backlog blocks before suggesting new entries, with the candidate-host list surfaced explicitly in the confirmation table (today the bias is implicit).
- When checking an FD, also scan backlog for other candidates for the same FD → suggest a new FD with higher confidence so it stays useful later too.

## User Story

As an operator (or triage agent) running `/triage`, I want the merge-candidate hosts surfaced as an explicit ranked shortlist drawn from all FDs, roadmap, and backlog entries — with FD matches proposed as parent-linked new entries — so that I fold new ideas into existing work instead of scattering near-duplicate entries that `/garden` later flags.

## Usage

**CLI**

- `pnpm noldor triage merge-candidates` — print a human-readable table of every merge candidate (`kind · slug · name · disposition`) for eyeballing.
- `pnpm noldor triage merge-candidates --json` — emit the candidate corpus as JSON; consumed by `/triage`.

**Triage integration**

- `/triage` calls `merge-candidates --json` once per run. For each untriaged idea it ranks the corpus and surfaces the top-3 considered hosts as a `cands: a, b, c` annotation in the confirmation table.
- Disposition per match: a roadmap/backlog host → `merge:<slug>` (sub-bullet append); an FD host → a new entry carrying `parent:<fd-slug>` (attach intent for a later `/promote`); no match → a parent-less new entry.

## PRs

<!-- @prs-since-last-release: sdd-detector-5-idea-merge-semantic-similarity -->

## Changelog
