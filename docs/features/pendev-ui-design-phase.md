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

The framework has no UI-design stage: `/noldor-spec` produces prose, and a frontend feature's visual design is either absent from the artifact trail or pasted in as a screenshot nobody validates. This feature adds a pen.dev-backed design step inside the spec phase: on UI-bearing sessions (decided by a `consumer.uiPaths` predicate with an FD `design:` override, never by operator memory), several UI versions are drafted and compared as pages inside one repo-committed `.pen` file while the spec is still being written, converging on one `FINAL:` design per affected surface that the spec links and gate Step 2.5 commits alongside it — design decisions adjudicated with the rest of the spec rather than after it. A shared baseline at `docs/design/ui/baseline/<surface>.pen` mirrors the shipped UI so every design session seeds from reality; ship-time write-back plus an ancestry-based per-surface freshness check and a `design ui-sync` remediation command keep it from rotting. The design spec resolves the entry's open questions (artifact pinning via git, candidates-as-pages, predicate semantics, non-UI skip); the review lane that checks implemented UI against the chosen design was carved out to Q-0145. Related but distinct: Q-0116's design-artifact detector module governs how design artifacts are discovered once they exist, not where they come from. Consumer-blocking, which is why this outranked internal-polish entries per the vision's adoption tie-breaker.

## User Story

As an operator shipping a UI feature through the gate, I want the spec phase to produce a pinned visual design seeded from an always-current baseline of the shipped UI, so that design decisions are adjudicated with the spec, iteration starts from reality rather than memory, and the artifact trail records what was chosen and why.

## Usage

- Consumer setup: add `"uiPaths": ["src/dashboard/app/**"]` (optionally `"uiSurfaces": {"dashboard": ["src/dashboard/app/**"]}`) to `consumer` in `.noldor/config.json`; run `pnpm noldor design ui-sync` once per surface to bootstrap the baseline.
- Spec phase (automatic): on a UI-bearing entry, the design step seeds `docs/design/ui/<date>-<slug>.pen` from the affected baseline surfaces, iterates variants as pages, marks one winner `FINAL:` per surface; the gate commits it with the spec.
- Override: set `design: required` or `design: skip` in the FD frontmatter to force either verdict (operator-only field).
- Freshness: `pnpm noldor checks ui-design-freshness` any time; gate Step 4 and release preflight run it automatically; `pnpm noldor design ui-sync` repairs any red.

## PRs

<!-- @prs-since-last-release: pendev-ui-design-phase -->

## Changelog
