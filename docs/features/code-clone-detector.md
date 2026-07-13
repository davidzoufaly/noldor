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

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: code-clone-detector -->

## Changelog
