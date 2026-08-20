---
area: tooling
category: Tooling
deps:
  - pendev-ui-design-phase
entry-id: Q-0145
links:
  code: []
  tests: []
name: UI-Design Review Lane
packages:
  - package.json
phase: in-progress
since: 2026-08-19
noldor-tier: specs-only
---

## Summary

Second slice of Q-0144 (pen.dev UI Design Phase): a reviewer-prompted CR lane that checks the implemented UI against the feature's committed `.pen` design. Mirrors the `reviewer` lane's subagent-dispatch shape: the lane feeds the reviewer the design structure extracted from the committed `.pen` (via pencil MCP — layout tree, components, copy) plus the code diff, and emits blockers into a standard lane sink beside the codex and verifier lanes. Fires on the same `consumer.uiPaths` predicate the design stage uses; skipped cleanly for non-UI sessions. Mechanical render-compare (screenshot diff against a running app) is explicitly deferred — a later enhancement once boot recipes exist (tracked as Q-0146). Blocked until the design stage (pendev-ui-design-phase) ships artifacts to review against.

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: ui-design-review-lane -->

## Changelog
