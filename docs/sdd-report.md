<!-- generated: do-not-edit -->

# SDD Report

Generated: 2026-05-30 by `pnpm sdd:report`.

Pre-MVP done features (`introduced` < `0.2.0`) are
grandfathered from `links.spec` / `links.code` checks.
Bump `MIN_ENFORCED_VERSION` in `scripts/garden/sdd-report.ts` once backfill is done.

## Summary

- Total features: 30
- Untriaged ideas: 0
- Backlog entries: 3
- Gap categories with issues: 7 / 14

## Gap details

### Done features without tests

- `decouple-milestones-from-semver` — Decouple Milestones from Semver (tooling) has no tests in links.tests
- `framework-doc-extraction` — Framework Doc Extraction (tooling) has no tests in links.tests
- `release-script-self-provisions-its-own-session-marker` — Release Script Self-Provisions Its Own Session Marker (tooling) has no tests in links.tests
- `release-sweep-process-hardening` — Release-Sweep Process Hardening (tooling) has no tests in links.tests
- `replace-roadmap-buckets-with-flat-priority-order` — Replace Roadmap Buckets with Flat Priority Order (tooling) has no tests in links.tests
- `triage-scoring-rubric-effort-impact-confidence-dependency` — `/triage` Scoring Rubric (effort × impact × confidence × dependency) (tooling) has no tests in links.tests

### Done features without docs

- `howto-index-pipeline` — How-To Index Pipeline (tooling) has no entries in links.docs

### Done features missing introduced

- `framework-doc-extraction` — Framework Doc Extraction is phase=done but introduced is unset (release script should fill on next pnpm release)
- `howto-index-pipeline` — How-To Index Pipeline is phase=done but introduced is unset (release script should fill on next pnpm release)
- `noldor-package-lift` — Noldor Package Lift is phase=done but introduced is unset (release script should fill on next pnpm release)

### Plans without matching spec

- `docs/superpowers/plans/2026-05-28-framework-doc-extraction-phase-0.md` — docs/superpowers/plans/2026-05-28-framework-doc-extraction-phase-0.md has slug "framework-doc-extraction-phase-0" with no matching spec under docs/superpowers/specs/
- `docs/superpowers/plans/2026-05-29-framework-doc-extraction-repo-extraction-rev2-phase-a.md` — docs/superpowers/plans/2026-05-29-framework-doc-extraction-repo-extraction-rev2-phase-a.md has slug "framework-doc-extraction-repo-extraction-rev2-phase-a" with no matching spec under docs/superpowers/specs/

### Code files not referenced by any feature

- `scripts/migration/classify-feature-track.ts` — scripts/migration/classify-feature-track.ts is not referenced by any feature MD links.code
- `scripts/migration/classify.ts` — scripts/migration/classify.ts is not referenced by any feature MD links.code
- `scripts/migration/cross-tree-link-audit.ts` — scripts/migration/cross-tree-link-audit.ts is not referenced by any feature MD links.code
- `scripts/migration/partition-blocks.ts` — scripts/migration/partition-blocks.ts is not referenced by any feature MD links.code
- `scripts/migration/stage-framework-docs.ts` — scripts/migration/stage-framework-docs.ts is not referenced by any feature MD links.code

### Tests with incomplete co-tag

- `graphify-out/graph.json` — graphify-out/graph.json does not exist. Run /graphify + pnpm toon to generate the graph, or ensure the path is correct.

### Done features without code

- `decouple-milestones-from-semver` — Decouple Milestones from Semver (tooling) has no entries in links.code
- `framework-doc-extraction` — Framework Doc Extraction (tooling) has no entries in links.code
- `noldor-package-lift` — Noldor Package Lift (tooling) has no entries in links.code
- `scripts-reorganization-by-feature-area` — Scripts Reorganization By Feature/Area (tooling) has no entries in links.code
