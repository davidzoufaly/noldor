---
area: tooling
category: Tooling
deps: []
entry-id: Q-0030
links:
  code: []
  tests:
    - src/garden/detectors/__tests__/skill-code-drift.test.ts
  spec: docs/design/specs/2026-07-13-skill-vs-code-drift-detector-design.md
name: Skill-vs-Code Drift Detector
packages:
  - scripts
phase: done
since: 2026-07-11T00:00:00.000Z
noldor-tier: specs-only
introduced: 1.0.0
---
## Summary

Skills reference CLI commands, `package.json` scripts, and `src/` paths that rot after reorgs (release-sweep needed a full path audit, PR #124; the gate skill body carried the same class of drift). Add a garden detector that scans `.claude/skills/**/SKILL.md` + `templates/.claude/skills/**` for `pnpm <script>` invocations not in `package.json` scripts, `noldor <sub>` commands not in the CLI manifest, and repo-relative paths that don't exist. Carried out of the drained release-sweep-skill-path-audit roadmap entry.

## User Story

As a framework maintainer, I want `garden detect` to flag skill bodies whose `pnpm` scripts, `noldor` subcommands, or file paths no longer exist, so that skill/code drift surfaces automatically at gardening time instead of via manual path audits after something breaks.

## Usage

**Agent/Programmatic API**

- `pnpm noldor garden detect` — JSON output gains the `skillDrift` category: one row per drifted reference with `skillPath`, `line`, `kind` (`pnpm-script` | `noldor-subcommand` | `missing-path`), `token`, and `detail`.
- `detectSkillCodeDrift(repo)` (`src/garden/detectors/skill-code-drift.ts`) — direct API; findings sorted by `skillPath`, then `line`.
- Findings count toward the release auto-restamp gate via `runGardenDetectViaCli` (`src/garden/garden-detect-runner.ts`) and surface in the `/noldor-garden` checklist as investigate-only items.
- Suppress an intentional negative reference (e.g. documenting that a script does NOT exist) by putting `<!-- noldor-skill-drift-ignore -->` on the line or alone on the preceding line.

## PRs

<!-- @prs-since-last-release: skill-vs-code-drift-detector -->

## Changelog

<!-- generated: resources -->

## Resources

- **Tests:**
  - [`src/garden/detectors/__tests__/skill-code-drift.test.ts`](../../src/garden/detectors/__tests__/skill-code-drift.test.ts)

<!-- /generated: resources -->
