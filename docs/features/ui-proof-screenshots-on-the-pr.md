---
area: tooling
category: Tooling
deps: []
entry-id: Q-0343
links:
  code: []
  tests: []
  spec: docs/design/specs/2026-10-07-ui-proof-screenshots-on-the-pr-design.md
name: UI Proof Screenshots on the PR
packages:
  - package.json
phase: in-progress
since: 2026-10-07T00:00:00.000Z
noldor-tier: specs-only
---

## Summary

When a feature touches UI, the PR should carry a screenshot of it working as proof — and when the feature is e2e-tested on the UI end, the screenshot comes from that run. Today a UI change ships with a text-only PR body, so a reviewer has to check out the branch to see the result. Capture screenshots from the e2e/verify run (or a dedicated capture step) and attach them to the PR body via `pr-flow`.

## Diagram

<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or
     two beside it for readers that do not render mermaid. No shape worth drawing?
     Replace this comment with: noldor:cut <reason> -->

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: ui-proof-screenshots-on-the-pr -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/2026-10-07-ui-proof-screenshots-on-the-pr-design.md`](../../docs/design/specs/2026-10-07-ui-proof-screenshots-on-the-pr-design.md)

<!-- /generated: resources -->
