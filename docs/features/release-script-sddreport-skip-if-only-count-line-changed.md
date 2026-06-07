---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/release/index.ts
    - src/garden/sdd-report.ts
  tests: []
name: Release Script `sdd:report` Skip-If-Only-Count-Line-Changed
packages:
  - noldor
phase: in-progress
noldor-tier: specs-only
---

## Summary

`src/release/index.ts` runs `pnpm noldor garden sdd-report --release` and aborts when `docs/sdd-report.md` is dirty. But `sdd:report` is not idempotent: the `Review-skip count (last 30 days)` line increments by 1 per commit on the active branch (each sweep commit lacks `Noldor-Reviewed` and counts as a review-skip). Even when `/release-sweep` step 5.5 pre-emptively commits the regen, the release-time re-run always produces a +1 diff and aborts. Discovered 2026-05-17 during `release-sweep-process-hardening` part 2 plan execution (idempotency verification failed). Two fix candidates: (a) release-script treats "only the review-skip count line changed" as clean and proceeds; (b) `sdd:report` gains a flag to exclude in-flight branch commits from the count. Until shipped, the release operator hits a single sdd:report-driven retry on the first `pnpm release` after sweep PR merge.

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: release-script-sddreport-skip-if-only-count-line-changed -->

## Changelog
