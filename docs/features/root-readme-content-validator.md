---
area: tooling
category: Tooling
deps: []
entry-id: Q-0139
links:
  code: []
  tests: []
  spec: docs/design/specs/2026-08-20-root-readme-content-validator-design.md
name: Root README Content Validator
packages:
  - package.json
phase: in-progress
since: 2026-08-17T00:00:00.000Z
noldor-tier: full
---
## Summary

Root `README.md` is the one doc surface the framework never inspects for content, so every capability it adds drifts out of the README silently. Four mechanisms touch the file and none of them read what it says: `pnpm noldor docs check` includes it but only resolves internal links (`src/docs/docs-check.ts:223`), the `bootstrap commands` rule-pair asserts a `pnpm test` mention at `severity: 'warn'` (`src/invariants/rule-pairs.ts:63`, soft by design because the README is consumer-owned), SDD detector 12 `detectReadmePackageDrift` (`src/garden/sdd-report.ts:489`) keys on `packages/<prefix>-*` directories and is therefore dead in this repository, and release-sweep step 4 is prose asking an LLM to eyeball the architecture, stack and command sections. The miss is concrete: Q-0093 added a `docs architecture` subcommand to `src/cli/manifest.ts` plus a four-page `docs/architecture/` surface carrying its own presence validator, garden detector, SDD gap and release probe, and the README's `## CLI reference` and `## Docs` sections both stayed silent — the string "architecture" appears nowhere in it. Wanted: three structural checks mirroring the registry Q-0093 already built — `src/cli/manifest.ts` against the README CLI-reference section, every registered doc surface reachable from `## Docs`, and every command quoted in `## Quick start` / `## Daily workflow` present in root `package.json` `scripts`. Two constraints bind the design. The README sits deliberately outside `RELEASE_SWEEP_GLOBS` (`src/core/allowlist.ts:20`), so a finding is always operator-fixed in a separate micro-chore rather than repaired in place by the sweep. And the finding must land on a non-blocking channel — routing it to `sddGaps` would let a README typo withhold a release through the four-hop chain Q-0136 exists to make structural. Deletion test: adding a CLI subcommand or a doc surface without touching the README fails a check that names the missing section. (found 2026-08-17 asking why PR #333 left the root README untouched)

The source roadmap entry carried `- blocked-by: Q-0136` (typed advisory/blocking gap channels), which is still open and has no FD, so it cannot be expressed in `deps:` above. The operator elected to proceed: the spec routes findings onto the existing hand-rolled advisory `GardenFindings` key that Q-0093 already kept out of `FINDING_CATEGORIES`, rather than waiting for Q-0136 to make that channel structural. Q-0136 remains the follow-up that turns the convention into a type.

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: root-readme-content-validator -->

## Changelog
