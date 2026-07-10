---
area: tooling
category: Tooling
deps: []
links:
  code: []
  tests: []
  spec: >-
    docs/superpowers/specs/2026-07-10-prefix-skills-with-noldor-design.md
name: Prefix Skills with noldor-
packages:
  - scripts
phase: in-progress
noldor-tier: full
---

## Summary

Prefix the framework's skill names with `noldor-` to namespace them and avoid collisions with consumer-side or vendored skills. Parked 2026-07-02, re-sized S→L: a 2026-06-13 drain attempt revealed this is a self-referential mega-rename — 9 unprefixed skills (`gate`, `garden`, `triage`, `promote`, `milestone`, `new-feature`, `draft-feature-md`, `refactor`, `release-sweep`) plus template twins, the drain's `gatePrompt` in `src/autonomous/drain-source.ts`, and back-compat aliases for consumer repos that already vendored the old names. Only `noldor-spec` / `noldor-plan` / `noldor-research` were born prefixed. Needs the full spec+plan path if picked up; never fast-track.

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: prefix-skills-with-noldor -->

## Changelog
