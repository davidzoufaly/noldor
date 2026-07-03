---
area: tooling
category: Tooling
deps: []
links:
  code: []
  docs: []
  tests: []
  spec: >-
    docs/superpowers/specs/2026-07-03-self-boundaries-declaration-and-cycle-break-design.md
name: Self-Boundaries Declaration and Cycle Break
packages:
  - scripts
phase: in-progress
noldor-tier: specs-only
---
## Summary

Replaces the retired Charuy-premise `runtime-architecture-invariant-expansion` with the noldor-native version the 2026-07 audit surfaced: `pnpm noldor invariants run` passes 4/4 but the `boundaries` check sources rules from `.noldor/config.json` = `[]` — dependency-cruiser runs with zero rules while 4 real prod cycles exist (core↔cr via `src/core/pr-flow-cli.ts` importing `cr/config` — the repo-wide config loader lives in the wrong module; features↔garden via `sdd-report.ts` doubling as shared FD-loading lib; garden↔sync; garden↔invariants). Declare real boundary rules for the framework's own module graph, then break the cycles (move the config loader out of `src/cr/`, extract the FD-loading lib from `sdd-report.ts`). The framework preaches boundary discipline; it should declare some for itself. Also retire the Charuy-inherited `keyboard-binding` invariant (slowest check, 922ms, UI concern in a CLI framework).

## User Story

As a framework maintainer, I want Noldor to declare and enforce boundary rules for its own module graph, so that the `boundaries` invariant actually guards against dependency cycles instead of passing vacuously with zero rules.

## Usage

```bash
# run all invariants — boundaries now enforces 4 real rules, 3 invariants total
pnpm noldor invariants run
# alias
pnpm noldor checks invariants
```

Rules live in `.noldor/config.json` under `consumer.boundaries` (dependency-cruiser forbidden-rule shape; regex strings, plus the `{from: {}, to: {circular: true}}` no-cycle backstop). Agents hitting a red `boundaries` check must move code to respect the layering (`cli/orchestration → domain modules → core`), never edit the rules to pass.

## PRs

<!-- @prs-since-last-release: self-boundaries-declaration-and-cycle-break -->

## Changelog
