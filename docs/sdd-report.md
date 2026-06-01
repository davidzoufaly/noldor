<!-- generated: do-not-edit -->

# SDD Report

Generated: 2026-06-01 by `pnpm sdd:report`.

Pre-MVP done features (`introduced` < `0.2.0`) are
grandfathered from `links.spec` / `links.code` checks.
Bump `MIN_ENFORCED_VERSION` in `scripts/garden/sdd-report.ts` once backfill is done.

## Summary

- Total features: 30
- Untriaged ideas: 16
- Backlog entries: 3
- Gap categories with issues: 5 / 14

## Gate compliance

### Tier distribution

- `full` (brainstorm + spec + plan): 19
- `specs-only` (no brainstorm): 11

### Override usage (last 30 days)

No overrides in the last 30 days.

### Review-skip count (last 30 days)

Gated commits missing `Noldor-Reviewed` trailer: 8

## Gap details

### Done features without tests

- `decouple-milestones-from-semver` — Decouple Milestones from Semver (tooling) has no tests in links.tests
- `framework-doc-extraction` — Framework Doc Extraction (tooling) has no tests in links.tests
- `release-script-self-provisions-its-own-session-marker` — Release Script Self-Provisions Its Own Session Marker (tooling) has no tests in links.tests
- `release-sweep-process-hardening` — Release-Sweep Process Hardening (tooling) has no tests in links.tests
- `replace-roadmap-buckets-with-flat-priority-order` — Replace Roadmap Buckets with Flat Priority Order (tooling) has no tests in links.tests
- `triage-scoring-rubric-effort-impact-confidence-dependency` — `/triage` Scoring Rubric (effort × impact × confidence × dependency) (tooling) has no tests in links.tests

### Done features missing introduced

- `framework-doc-extraction` — Framework Doc Extraction is phase=done but introduced is unset (release script should fill on next pnpm release)
- `howto-index-pipeline` — How-To Index Pipeline is phase=done but introduced is unset (release script should fill on next pnpm release)
- `noldor-package-lift` — Noldor Package Lift is phase=done but introduced is unset (release script should fill on next pnpm release)

### Untriaged ideas in ideas.md

- `ideas.md:30` — next priority -> be able to dispatch next priority via agent window
- `ideas.md:31` — when checking FD also consider checking backlog/if there might be other candidates for the same FD so it can suggest new FD with higher confidence so it will be usefull also later
- `ideas.md:32` — milestones to dashboard web
- `ideas.md:33` — where are milestones documented?
- `ideas.md:34` — is gate function properly documented
- `ideas.md:35` — add "remove" button from backlog and roadmap to action column rename it to "actions"
- `ideas.md:36` — is scaleforge docs up-to-date?
- `ideas.md:37` — test cr codex
- `ideas.md:44` — paraler development
- `ideas.md:45` — top ten items roadmap / backlog items noldor
- `ideas.md:49` — move it to standalone repo -> package
- `ideas.md:50` — code reviewer 2.0 -> inspiration from MC Code Reviwer
- `ideas.md:51` — code reviewer configuration for fast-track
- `ideas.md:56` — still does it make sense to introduce SQL into a framework?
- `ideas.md:57` — get rid of superpowers -> and disable them + other skills
- `ideas.md:58` — framework should consist of mini skills supported by scripts and hooks, only little markdown files (supportive) -> framework docs should be there for me and other contributors not for a agent to use it

### Code files not referenced by any feature

- `scripts/migration/classify-feature-track.ts` — scripts/migration/classify-feature-track.ts is not referenced by any feature MD links.code
- `scripts/migration/classify.ts` — scripts/migration/classify.ts is not referenced by any feature MD links.code
- `scripts/migration/cross-tree-link-audit.ts` — scripts/migration/cross-tree-link-audit.ts is not referenced by any feature MD links.code
- `scripts/migration/partition-blocks.ts` — scripts/migration/partition-blocks.ts is not referenced by any feature MD links.code
- `scripts/migration/stage-framework-docs.ts` — scripts/migration/stage-framework-docs.ts is not referenced by any feature MD links.code

### Done features without code

- `decouple-milestones-from-semver` — Decouple Milestones from Semver (tooling) has no entries in links.code
- `framework-doc-extraction` — Framework Doc Extraction (tooling) has no entries in links.code
- `noldor-package-lift` — Noldor Package Lift (tooling) has no entries in links.code
- `scripts-reorganization-by-feature-area` — Scripts Reorganization By Feature/Area (tooling) has no entries in links.code
