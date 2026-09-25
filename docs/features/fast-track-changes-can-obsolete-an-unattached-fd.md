---
area: tooling
category: Tooling
deps: []
entry-id: Q-0233
links:
  code:
    - src/features/features-owners-cli.ts
    - src/garden/detectors/undeclared-doc-impact.ts
    - src/garden/graph-fd-lookup.ts
  spec: >-
    docs/design/specs/2026-09-25-fast-track-changes-can-obsolete-an-unattached-fd-design.md
  tests:
    - src/features/__tests__/features-owners-cli.test.ts
    - src/garden/__tests__/fd-ownership.test.ts
    - src/garden/detectors/__tests__/undeclared-doc-impact.test.ts
    - src/hooks/__tests__/noldor-validate-trailer.test.ts
name: Fast-Track Changes Can Obsolete an Unattached FD
packages:
  - scripts
phase: in-progress
since: 2026-09-08T00:00:00.000Z
noldor-tier: specs-only
---

## Summary

A fast-track ships without attaching to any feature MD, so when one or more fast-tracks change the business logic, files, or behaviour an FD documents, that FD silently goes stale — the doc-tracked invariant holds only for paths that scaffold an artifact. Worth exploring whether fast-track should optionally attach to an FD the way the attach paths do (carrying the parent slug, refreshing the FD's Usage on ship), or whether a detector should flag an FD whose `links.code` paths moved under a fast-track commit it never records. The first is a gate change, the second a garden detector; they are not exclusive. (surfaced 2026-09-08)

## Diagram

<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or
     two beside it for readers that do not render mermaid. No shape worth drawing?
     Replace this comment with: noldor:cut <reason> -->

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: fast-track-changes-can-obsolete-an-unattached-fd -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/2026-09-25-fast-track-changes-can-obsolete-an-unattached-fd-design.md`](../../docs/design/specs/2026-09-25-fast-track-changes-can-obsolete-an-unattached-fd-design.md)
- **Code:**
  - [`src/features/features-owners-cli.ts`](../../src/features/features-owners-cli.ts)
  - [`src/garden/detectors/undeclared-doc-impact.ts`](../../src/garden/detectors/undeclared-doc-impact.ts)
  - [`src/garden/graph-fd-lookup.ts`](../../src/garden/graph-fd-lookup.ts)
- **Tests:**
  - [`src/features/__tests__/features-owners-cli.test.ts`](../../src/features/__tests__/features-owners-cli.test.ts)
  - [`src/garden/__tests__/fd-ownership.test.ts`](../../src/garden/__tests__/fd-ownership.test.ts)
  - [`src/garden/detectors/__tests__/undeclared-doc-impact.test.ts`](../../src/garden/detectors/__tests__/undeclared-doc-impact.test.ts)
  - [`src/hooks/__tests__/noldor-validate-trailer.test.ts`](../../src/hooks/__tests__/noldor-validate-trailer.test.ts)

<!-- /generated: resources -->
