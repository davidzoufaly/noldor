---
area: tooling
category: Tooling
deps: []
entry-id: Q-0027
links:
  code: []
  tests:
    - src/core/agent-runner/__tests__/registry-logsink.test.ts
    - src/dashboard/__tests__/route-sweep.test.ts
name: Dashboard Broken-Pages Audit
packages:
  - scripts
phase: in-progress
since: 2026-07-11T00:00:00.000Z
noldor-tier: specs-only
---
## Summary

Many dashboard pages are currently broken, and the live drain-observation view is missing from the main menu (and not working when reached directly). Audit every dashboard route, fix the broken pages, and surface live drain observation as a first-class main-menu item.

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: dashboard-broken-pages-audit -->

## Changelog
