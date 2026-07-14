---
area: tooling
category: Tooling
deps: []
entry-id: Q-0043
links:
  code: []
  tests: []
name: README Rewrite — Consumer-Journey Order
packages:
  - scripts
phase: in-progress
since: 2026-07-13
noldor-tier: specs-only
---

## Summary

Deep-audit finding (batch `.noldor/research/2026-07-13-184850`, `readme-quality.findings.md` has the proposed outline): README is not wrong post-PR#126 but covers only 5 of 34 CLI command groups, omits gate/drain/upgrade/`init --adopt`, never links the adoption guide, and enumerates a stale config field set. Rewrite in consumer-journey order (install from GH Packages → init/adopt → gate workflow → dashboard → drain → upgrade), link the adoption guide instead of duplicating it, stop enumerating config fields. Same pass: fix `docs/noldor/README.md` index staleness — it still calls the adoption guide a "stub — WIP" (it's a full 105-line guide with live consumers) and omits 4 existing pages (incl. agent-runtimes.md).

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: readme-rewrite-consumer-journey-order -->

## Changelog
