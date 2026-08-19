---
area: tooling
category: Tooling
deps: []
entry-id: Q-0144
links:
  code: []
  spec: docs/design/specs/2026-08-19-pendev-ui-design-phase-design.md
  tests: []
name: pen.dev UI Design Phase
packages:
  - package.json
phase: in-progress
since: 2026-08-17
noldor-tier: full
---

## Summary

The framework has no UI-design stage: `/noldor-spec` produces prose, and a frontend feature's visual design is either absent from the artifact trail or pasted in as a screenshot nobody validates. Wanted, driven by a live consumer need: a pen.dev-backed design step inside the spec phase where several UI versions can be described, drafted and compared while the spec is still being written, converging on one final design that the spec carries as its own artifact by the time the spec phase closes — design decisions adjudicated with the rest of the spec rather than after it. Two surfaces follow from that. A pipeline stage, so `/noldor-gate` routes UI-bearing work through the design step and the resulting artifact is gate-visible the way specs and plans are (`sizeToPath()` and the path set both move). And a review lane that checks the implemented UI against the chosen pen.dev design, sitting beside the codex and verifier lanes rather than duplicating them. Open questions dominate, hence `confidence: low`: how a pen.dev artifact is referenced and pinned so a spec's design cannot silently change under it; whether version drafts live in pen.dev with only the winner referenced, or all candidates are recorded as the spec's considered alternatives; whether the review lane can compare rendered output to a design mechanically or only prompt a reviewer with both; and what a non-UI feature does with the stage (skipped by predicate, not by operator memory). Related but distinct: Q-0116's design-artifact detector module governs how design artifacts are discovered once they exist, not where they come from. Consumer-blocking, which is why this outranks internal-polish entries below it per the vision's adoption tie-breaker.

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: pendev-ui-design-phase -->

## Changelog
