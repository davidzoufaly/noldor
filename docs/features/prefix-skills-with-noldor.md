---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/core/prefix-skills-codemod.ts
    - src/migrations/0.6.0.ts
    - src/migrations/0.5.0.ts
    - src/autonomous/gate-prompt.ts
    - src/core/allowlist.ts
  tests:
    - src/core/__tests__/prefix-skills-codemod.test.ts
    - src/migrations/__tests__/0.6.0.test.ts
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

As a Noldor operator (human or agent) working across multiple repos, I want every framework skill to live under the `noldor-` namespace, so that framework skills never collide with consumer-side or vendored skills of the same generic word and the whole skill surface reads as one coherent, discoverable namespace.

## Usage

**Skill invocation** — invoke any framework skill by its `noldor-` name: `/noldor-gate`, `/noldor-promote`, `/noldor-triage`, `/noldor-garden`, `/noldor-milestone`, `/noldor-new-feature`, `/noldor-draft-feature-md`, `/noldor-refactor`, `/noldor-release-sweep` (joining the already-prefixed `/noldor-spec`, `/noldor-plan`, `/noldor-research`).

**Consumer upgrade** — `noldor upgrade --dry-run` previews the 0.5.0 → 0.6.0 step (adds the `noldor-*` skill dirs + rewritten `docs/noldor` twins, removes the 9 old vendored dirs); `noldor upgrade` applies it, idempotent on re-run.

**No new CLI surface** — the drain/gate entrypoints are unchanged except the emitted slash string (`/noldor-gate --drain <slug>`).

## PRs

<!-- @prs-since-last-release: prefix-skills-with-noldor -->

## Changelog
