---
area: testing
category: Tooling
deps: []
entry-id: Q-0171
links:
  code: []
  tests: []
name: Test Suites Read Live Repo State — Shifting Full-Suite Failures
packages:
  - scripts
phase: in-progress
since: 2026-08-23
noldor-tier: specs-only
---

## Summary

The full `npx vitest run` fails on a *shifting* set of files that each pass in isolation, so a green suite is currently a matter of timing. Observed twice within ten minutes on 2026-08-20: run one failed `src/garden/__tests__/sdd-report.test.ts` (2 tests), run two failed `src/release/__tests__/preflight.test.ts` + `src/dashboard/__tests__/route-sweep.test.ts` (8 tests) with sdd-report green; all three files passed together in isolation (141 tests). The common factor is tests that read live repository state — `.noldor/session.json`, which the same session's `noldor set-autonomous` rewrites mid-run, and the dashboard port — rather than a fixture. Identify which suites read live `.noldor/` state or bind a fixed port and give them a fixture or a temp root, since the alternative is that every future red suite gets retried instead of read. Deletion test: the full suite passes with a session marker present, an autonomous flag flip mid-run, and a dashboard already listening. (found 2026-08-20 draining the XS batch)

## Diagram

<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or
     two beside it for readers that do not render mermaid. No shape worth drawing?
     Replace this comment with: noldor:cut <reason> -->

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: test-suites-read-live-repo-state-shifting-full-suite-failures -->

## Changelog
