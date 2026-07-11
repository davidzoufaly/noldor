---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/core/wait.ts
    - src/core/wait-cli.ts
  tests: []
name: Noldor-Native Wait Primitive
packages:
  - scripts
phase: in-progress
noldor-tier: specs-only
---

## Summary

Runner-agnostic alternative to the harness `Monitor` tool, consumer side only: `noldor wait <state-file> --until <terminal-cond> [--emit <jsonpath>]` that polls until a job reaches a terminal state and surfaces progress. Do NOT invent a new progress format — reuse the existing producer-side state files (`.noldor/drain-state.json` heartbeat, `.noldor/cr/<slug>-<kind>-<lane>.json` sinks). The "write one side / read other" channel already exists; the gap is a portable wait/poll the controller calls instead of the host harness's Monitor (which can be blocked + isn't cross-runner). Parked: background-task completion notifications already cover most waiting.

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: noldor-native-wait-primitive -->

## Changelog
