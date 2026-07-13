---
area: tooling
category: Tooling
deps: []
entry-id: Q-0033
links:
  code: []
  tests: []
  spec: docs/superpowers/specs/2026-07-13-code-clone-detector-design.md
name: Code-Clone Detector
packages:
  - scripts
phase: in-progress
since: 2026-07-11
noldor-tier: full
---

## Summary

Token/AST-based Type-1/2/3 clone detection (copy-paste dups, à la `jscpd`). Deterministic corpus over `scanPaths`, no LLM. Surface duplicate blocks as a new signal in `sdd-report` + feed `/refactor`; optional CR-gate block above a configurable clone threshold. Fits the "deterministic detector + optional LLM triage" pattern (same shape as detector-5 idea-merge). Distinct from existing pieces: `/refactor` finds consolidation opportunities from god-nodes/cohesion but doesn't do line/token clone matching; `graphify` AST graph has structural similarity signal but no clone report. Semantic (Type-4) clones out of scope — that's the embeddings-infra entry.

## User Story

As a framework maintainer, I want a deterministic token-based clone report over the configured source roots, so that copy-paste duplication surfaces in sdd-report and refactor sessions target real duplicate blocks instead of guessing from file sizes.

## Usage

**Agent/Programmatic API**

- `pnpm noldor clones report` — human summary (top groups, duplication %); `--json` for the full `CloneReport` (feeds `/noldor-refactor`).
- `pnpm noldor clones check` — exit 1 when `clones.thresholdPct` (`.noldor/config.json`) is exceeded; unset threshold = always green. Wire into CI/lefthook for a hard gate.
- Flags: `--min-tokens N` (50), `--min-lines N` (5), `--gap-tokens N` (10), `--include-tests`.
- `sdd-report` — `## Code clones` section renders group count + duplication % + top-5 groups on every regen.

## PRs

<!-- @prs-since-last-release: code-clone-detector -->

## Changelog
