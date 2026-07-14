---
area: tooling
category: Tooling
deps: []
entry-id: Q-0044
links:
  code: []
  tests: []
name: Vendored Systematic-Debugging Discipline
packages:
  - scripts
phase: in-progress
since: 2026-07-13
noldor-tier: specs-only
---

## Summary

Vendor the `systematic-debugging` discipline as a framework skill (`noldor-debug`): the disciplined loop — reproduce → minimise → hypothesise → instrument → fix → regression-test — invoked before proposing fixes for any bug, test failure, or unexpected behaviour. Today noldor has no debugging-discipline skill at all; consumers fall back to ad-hoc debugging. Author it in the vendored-skill style (self-contained SKILL.md, no plugin reference), register it in the skill-catalog (gated by `validate skill-catalog`), and reference it from the gate fast-track/fix paths so it's surfaced when a change is a bug fix.

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: vendored-systematic-debugging-discipline -->

## Changelog
