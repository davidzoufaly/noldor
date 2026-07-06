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

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: sdd-detector-5-idea-merge-semantic-similarity -->

## Changelog
