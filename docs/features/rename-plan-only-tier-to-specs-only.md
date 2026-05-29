---
area: tooling
category: Tooling
deps: []
links:
  code:
    - scripts/noldor/rename-plan-only-tier.ts
  tests:
    - scripts/noldor/__tests__/rename-plan-only-tier.test.ts
name: Rename Plan-Only Tier To Specs-Only
packages:
  - scripts
phase: done
noldor-tier: specs-only
introduced: 0.6.0
---

## Summary

Renames the Noldor framework's medium-depth FD creation tier from `plan-only` to `specs-only` across the schema, session paths, hooks, validators, skill prompts, framework docs, tests, fixtures, and 28 FD frontmatters. Pure terminology shift — same semantics. Companion tier `full` stays.

## User Story

As a framework operator or contributor, I want the medium-depth tier label to reflect what it actually produces (a spec, not a plan-without-spec), so that the AskUserQuestion prompt at `/gate` and `/new-feature` time, the path identifiers (`specs-only-new` / `specs-only-attach`), and the FD frontmatter agree on the same vocabulary.

## Usage

User-visible touch points after this lands:

- `/gate` and `/new-feature` ask `"FD creation depth — specs-only (no brainstorm) or full (spec + brainstorm)?"` instead of the prior `plan-only (no spec)` wording.
- Path identifiers on commits, sessions, and `.noldor/session.json` become `specs-only-new` and `specs-only-attach`.
- FD frontmatter `noldor-tier:` accepts `specs-only` or `full`; `plan-only` is no longer a valid value (`pnpm validate:features` rejects it).
- No migration is needed for existing FDs — the one-shot script `scripts/noldor/rename-plan-only-tier.ts` (run as `pnpm noldor:rename-plan-only-tier`) rewrites all 28 historical FD frontmatters in one pass during this PR.

## Follow-up

The rename's User Story stated the intent was to make the tier label reflect what it actually produces (a spec). The implementation in this FD was label-only — the tier kept its plan-producing behavior. The follow-up FD `noldor-specs-only-tier-produces-spec` (2026-05-25) honored the original intent by flipping the tier's actual behavior to produce a spec file. The 29 existing FDs tagged `noldor-tier: specs-only` keep their tag as a historical label-only carryover (none of them had a real spec file at the time of the flip; the legacy plan-producing path simply ceases to be reachable from `/gate`). See [`docs/superpowers/specs/2026-05-25-noldor-specs-only-tier-produces-spec-design.md`](../superpowers/specs/2026-05-25-noldor-specs-only-tier-produces-spec-design.md).

## PRs

<!-- @prs-since-last-release: rename-plan-only-tier-to-specs-only -->

## Changelog

<!-- generated: resources -->

## Resources

- **Code:**
  - [`scripts/noldor/rename-plan-only-tier.ts`](../../scripts/noldor/rename-plan-only-tier.ts)
- **Tests:**
  - [`scripts/noldor/__tests__/rename-plan-only-tier.test.ts`](../../scripts/noldor/__tests__/rename-plan-only-tier.test.ts)

<!-- /generated: resources -->
