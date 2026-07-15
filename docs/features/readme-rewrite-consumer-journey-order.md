---
area: tooling
category: Tooling
deps: []
entry-id: Q-0043
links:
  code: []
  tests: []
  spec: docs/design/specs/2026-07-14-readme-rewrite-consumer-journey-order-design.md
name: README Rewrite — Consumer-Journey Order
packages:
  - scripts
phase: done
since: 2026-07-13T00:00:00.000Z
noldor-tier: specs-only
introduced: 1.0.0
---
## Summary

Deep-audit finding (batch `.noldor/research/2026-07-13-184850`, `readme-quality.findings.md` has the proposed outline): README is not wrong post-PR#126 but covers only 5 of 34 CLI command groups, omits gate/drain/upgrade/`init --adopt`, never links the adoption guide, and enumerates a stale config field set. Rewrite in consumer-journey order (install from GH Packages → init/adopt → gate workflow → dashboard → drain → upgrade), link the adoption guide instead of duplicating it, stop enumerating config fields. Same pass: fix `docs/noldor/README.md` index staleness — it still calls the adoption guide a "stub — WIP" (it's a full 105-line guide with live consumers) and omits 4 existing pages (incl. agent-runtimes.md).

## User Story

As a developer or agent evaluating or adopting Noldor into a repo, I want the README to walk me through install → init → configure → daily gate workflow → upgrade in that order and point me at the adoption guide and per-topic docs, so that I can go from "never heard of it" to a working gated repo without reverse-engineering the CLI surface or discovering `init --adopt` by accident.

## Usage

Read `README.md` top-to-bottom. A new consumer follows the journey order: Prerequisites (`pnpm noldor doctor` to verify) → Install (`.npmrc` + `pnpm add -D @davidzoufaly/noldor`) → Initialize (`pnpm noldor init`, or `init --adopt` for an existing repo) → Configure (`.noldor/config.json`, validated by `pnpm noldor validate noldor-config`) → Daily workflow (`/noldor-gate`) → Upgrading (`noldor upgrade`). Deep dives are one click away via the linked `docs/noldor/*` pages and the `docs/noldor/README.md` index.

## PRs

<!-- @prs-since-last-release: readme-rewrite-consumer-journey-order -->

## Changelog
