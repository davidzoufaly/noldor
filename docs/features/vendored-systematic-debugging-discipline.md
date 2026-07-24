---
area: tooling
category: Tooling
deps: []
entry-id: Q-0044
links:
  code: []
  tests: []
  spec: >-
    docs/design/specs/archive/2026-07-14-vendored-systematic-debugging-discipline-design.md
name: Vendored Systematic-Debugging Discipline
packages:
  - scripts
phase: done
since: 2026-07-13T00:00:00.000Z
noldor-tier: specs-only
introduced: 1.0.0
---

## Summary

Vendor the `systematic-debugging` discipline as a framework skill (`noldor-debug`): the disciplined loop — reproduce → minimise → hypothesise → instrument → fix → regression-test — invoked before proposing fixes for any bug, test failure, or unexpected behaviour. Today noldor has no debugging-discipline skill at all; consumers fall back to ad-hoc debugging. Author it in the vendored-skill style (self-contained SKILL.md, no plugin reference), register it in the skill-catalog (gated by `validate skill-catalog`), and reference it from the gate fast-track/fix paths so it's surfaced when a change is a bug fix.

## User Story

As an agent (or human) fixing a bug in a Noldor consumer repo without the superpowers plugin installed, I want a vendored systematic-debugging discipline surfaced before I propose a fix, so that I find the root cause and write a failing test first instead of guess-and-check patching symptoms.

## Usage

- Invoke directly: `/noldor-debug` on any bug, test failure, or unexpected behaviour — before proposing a fix.
- Automatic surfacing: the `## Systematic debugging` baseline in `.claude/engineering-rules.md` (`@`-imported into every session) carries the discipline, so it is present on every bug-fix change without a gate step.
- The skill is a socially-enforced rule (no CLI, no hook): work the four phases (root cause → pattern → hypothesis + minimal test → fix + regression test), then verify the fix with `/noldor-verify` before claiming it works.

## PRs

<!-- @prs-since-last-release: vendored-systematic-debugging-discipline -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/archive/2026-07-14-vendored-systematic-debugging-discipline-design.md`](../../docs/design/specs/archive/2026-07-14-vendored-systematic-debugging-discipline-design.md)

<!-- /generated: resources -->
