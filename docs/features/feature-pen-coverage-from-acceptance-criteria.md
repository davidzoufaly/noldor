---
area: tooling
category: Tooling
deps:
  - pendev-ui-design-phase
entry-id: Q-0297
links:
  code: []
  spec: >-
    docs/design/specs/2026-09-25-feature-pen-coverage-from-acceptance-criteria-design.md
  tests:
    - src/core/__tests__/spec-criteria.test.ts
    - src/design/__tests__/design-approval.test.ts
    - src/design/__tests__/feature-coverage.test.ts
name: Feature .pen Coverage From Acceptance Criteria
packages:
  - package.json
phase: in-progress
since: 2026-09-25T00:00:00.000Z
noldor-tier: specs-only
---

## Summary

The same coverage hole bites a *feature's* `.pen`, not only a baseline, and the one page-level rule is a count the agent executes by hand. The enforced set is existence (`no-design-artifact`, `ambiguous-design`), ratification (`design-unapproved`) and freshness (`pen-modified`); `noldor-spec` step 1.5(b) adds "exactly one `FINAL:` page per surface", which is prose and counts pages rather than asking what is in them. Shipping Q-0275 the first design drew only the happy path — rest, keyboard focus, empty scene, engine error, in-flight and the folded-bar layout were all missing until the operator asked where the interactions were, and three of those states are pinned by acceptance criteria. Wanted: the coverage set a feature `.pen` is held to is **derived from the spec's acceptance criteria**, not hand-written, and the verdict step checks against that list rather than a page count. It builds on the declared coverage set Q-0247 adds for baselines (split out of Q-0247 on 2026-09-25). `render-export-dispatch` / `render-compare` already export `.pen` pages to images, so a model-driven check can read them even where a static one cannot. (found 2026-09-22 shipping Q-0275)

## Diagram

<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or
     two beside it for readers that do not render mermaid. No shape worth drawing?
     Replace this comment with: noldor:cut <reason> -->

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: feature-pen-coverage-from-acceptance-criteria -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/2026-09-25-feature-pen-coverage-from-acceptance-criteria-design.md`](../../docs/design/specs/2026-09-25-feature-pen-coverage-from-acceptance-criteria-design.md)
- **Tests:**
  - [`src/core/__tests__/spec-criteria.test.ts`](../../src/core/__tests__/spec-criteria.test.ts)
  - [`src/design/__tests__/design-approval.test.ts`](../../src/design/__tests__/design-approval.test.ts)
  - [`src/design/__tests__/feature-coverage.test.ts`](../../src/design/__tests__/feature-coverage.test.ts)

<!-- /generated: resources -->
