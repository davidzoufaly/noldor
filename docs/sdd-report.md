<!-- generated: do-not-edit -->

# SDD Report

Generated: 2026-06-11 by `pnpm sdd:report`.

Pre-MVP done features (`introduced` < `0.2.0`) are
grandfathered from `links.spec` / `links.code` checks.
Bump `MIN_ENFORCED_VERSION` in `scripts/garden/sdd-report.ts` once backfill is done.

## Summary

- Total features: 35
- Untriaged ideas: 27
- Backlog entries: 1
- Gap categories with issues: 7 / 14

## Gate compliance

### Tier distribution

- `full` (brainstorm + spec + plan): 22
- `specs-only` (no brainstorm): 13

### Override usage (last 30 days)

- `1f08bd2` — fast-track framework chore, no FD; spans gate SKILL.md twins + docs/noldor + docs/features so no single conventional scope fits. Controller-reviewed; /garden audits the override.
- `211e3ae` — fast-track framework chore, no FD; cr:orchestrate is slug-based so no review-receipt path fits; allowlist + doc changes controller-reviewed, /garden audits the override.

### Review-skip count (last 30 days)

Gated commits missing `Noldor-Reviewed` trailer: 47

## Gap details

### Done features without tests

- `decouple-milestones-from-semver` — Decouple Milestones from Semver (tooling) has no tests in links.tests
- `framework-doc-extraction` — Framework Doc Extraction (tooling) has no tests in links.tests
- `release-script-self-provisions-its-own-session-marker` — Release Script Self-Provisions Its Own Session Marker (tooling) has no tests in links.tests
- `release-sweep-process-hardening` — Release-Sweep Process Hardening (tooling) has no tests in links.tests
- `replace-roadmap-buckets-with-flat-priority-order` — Replace Roadmap Buckets with Flat Priority Order (tooling) has no tests in links.tests
- `trailer-scope-alias-map` — Trailer Scope-Alias Map (tooling) has no tests in links.tests
- `triage-scoring-rubric-effort-impact-confidence-dependency` — `/triage` Scoring Rubric (effort × impact × confidence × dependency) (tooling) has no tests in links.tests

### Done features missing introduced

- `autonomous-queue-drain-runner` — Autonomous Queue-Drain Runner is phase=done but introduced is unset (release script should fill on next pnpm release)
- `parallel-drain` — Parallel Drain is phase=done but introduced is unset (release script should fill on next pnpm release)
- `plan-runner` — Plan-Runner — Autonomous Plan Executor is phase=done but introduced is unset (release script should fill on next pnpm release)
- `release-script-sddreport-skip-if-only-count-line-changed` — Release Script `sdd:report` Skip-If-Only-Count-Line-Changed is phase=done but introduced is unset (release script should fill on next pnpm release)
- `trailer-scope-alias-map` — Trailer Scope-Alias Map is phase=done but introduced is unset (release script should fill on next pnpm release)

### Untriaged ideas in ideas.md

- `ideas.md:36` — do not ask for commiting the plan -> commit autonomously
- `ideas.md:37` — po vyběru cesty -> zbytečná otázka pro potvrzení
- `ideas.md:38` — next priority -> be able to dispatch next priority via agent window
- `ideas.md:39` — when checking FD also consider checking backlog/if there might be other candidates for the same FD so it can suggest new FD with higher confidence so it will be usefull also later
- `ideas.md:40` — milestones to dashboard web
- `ideas.md:41` — where are milestones documented?
- `ideas.md:42` — is gate function properly documented
- `ideas.md:43` — roadmap nové akce -> top and bottom
- `ideas.md:44` — add "remove" button from backlog and roadmap to action column rename it to "actions"
- `ideas.md:48` — code reviewer 2.0 -> inspiration from MC Code Reviwer
- `ideas.md:49` — code reviewer configuration for fast-track
- `ideas.md:52` — codex CR gate unsatisfiable — 18 commits since v0.1.0 lack codex receipts; release needs RELEASE_SKIP_CR_GATE=1 until codex CR operationalized or pre-v0.1.0 grandfathered
- `ideas.md:53` — graphify writes cache to src/graphify-out/ when scanned on src -> breaks fmt:check every run (had to mv to /tmp 3x); make it write under graphify-out/ or exclude from fmt
- `ideas.md:54` — GARDEN_SRC_PATHS = apps/packages/scripts/ (not src/) -> garden-receipt freshness doesn't track this repo's source; mirror scanPaths
- `ideas.md:55` — every src-touching fast-track re-stales the graph (scanPaths=src) -> forces a graph-refresh sweep before each release; consider auto-regen in release or relax freshness for test-only diffs
- `ideas.md:56` — pnpm toon script omits required graph.json arg (bare `pnpm toon` fails; src/garden/graph-fd-lookup.ts tells users to run it)
- `ideas.md:57` — README Status section stale -> claims pre-extract, lives in Charuy monorepo; we're standalone now
- `ideas.md:58` — graphify-out/graph.html oxfmt churn ~41k lines/sweep -> gitignore graph.html or exclude from fmt
- `ideas.md:59` — .noldor/release-pushes.log not gitignored (operator-local release audit, like garden-receipt)
- `ideas.md:60` — sdd-report review-skip count non-idempotent: bumps per fast-track commit, re-fires release gate once (roadmap: skip-if-only-count-line-changed)
- `ideas.md:64` — de-claudification
- `ideas.md:65` — get rid of superpowers -> and disable them + other skills (consider handoff to autonomous mode)
- `ideas.md:66` — paraler development
- `ideas.md:68` — top ten items roadmap / backlog items noldor
- `ideas.md:69` — agents foder -> agent rules, commands,..
- `ideas.md:73` — still does it make sense to introduce SQL into a framework?
- `ideas.md:74` — CLI standalone tool

### Plans without matching spec

- `docs/superpowers/plans/2026-06-07-end-of-flow-ergonomics.md` — docs/superpowers/plans/2026-06-07-end-of-flow-ergonomics.md has slug "end-of-flow-ergonomics" with no matching spec under docs/superpowers/specs/

### Code files not referenced by any feature

- `scripts/migration/classify-feature-track.ts` — scripts/migration/classify-feature-track.ts is not referenced by any feature MD links.code — probable owner: autonomous-queue-drain-runner, parallel-drain, plan-runner
- `scripts/migration/classify.ts` — scripts/migration/classify.ts is not referenced by any feature MD links.code — probable owner: autonomous-queue-drain-runner, parallel-drain, plan-runner
- `scripts/migration/cross-tree-link-audit.ts` — scripts/migration/cross-tree-link-audit.ts is not referenced by any feature MD links.code — probable owner: autonomous-queue-drain-runner, parallel-drain, plan-runner
- `scripts/migration/partition-blocks.ts` — scripts/migration/partition-blocks.ts is not referenced by any feature MD links.code
- `scripts/migration/stage-framework-docs.ts` — scripts/migration/stage-framework-docs.ts is not referenced by any feature MD links.code

### Tests with incomplete co-tag

- `src/prep/__tests__/scaffold.test.ts` — imports files owned by FDs missing from @tests: tag — add: plan-runner
- `src/prep/__tests__/index-doc.test.ts` — imports files owned by FDs missing from @tests: tag — add: plan-runner
- `src/prep/__tests__/staging.test.ts` — imports files owned by FDs missing from @tests: tag — add: plan-runner
- `src/prep/__tests__/discover.test.ts` — imports files owned by FDs missing from @tests: tag — add: plan-runner
- `src/prep/__tests__/prep-promote.test.ts` — imports files owned by FDs missing from @tests: tag — add: plan-runner
- `src/core/__tests__/changelog.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/core/__tests__/next-priority.test.ts` — imports files owned by FDs missing from @tests: tag — add: autonomous-queue-drain-runner, noldor
- `src/core/__tests__/validate-skill-catalog.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/core/__tests__/validate-noldor-scope.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/core/__tests__/release-markers.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/core/__tests__/lint-plan-snippets.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/core/__tests__/validate-noldor.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/core/__tests__/pr-flow-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: parallel-drain
- `src/core/__tests__/pr-flow.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor, parallel-drain
- `src/garden/__tests__/graph-fd-lookup.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor, release-script-sddreport-skip-if-only-count-line-changed
- `src/garden/__tests__/sdd-report.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor, release-script-sddreport-skip-if-only-count-line-changed
- `src/garden/detectors/__tests__/override-audit.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/garden/detectors/__tests__/codex-cr-override-audit.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/cr/__tests__/cli-args.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/cr/__tests__/context.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/cr/__tests__/run-codex.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/cr/__tests__/sidecar.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/cr/__tests__/schema-parity.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/cr/__tests__/codex.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/release/__tests__/release-cr-gate-e2e.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/release/__tests__/release-cr-gate.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/release/__tests__/sdd-report-diff.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-script-sddreport-skip-if-only-count-line-changed
- `src/docs/__tests__/docs-howto.test.ts` — imports files owned by FDs missing from @tests: tag — add: howto-index-pipeline
- `src/docs/__tests__/howto-schema.test.ts` — imports files owned by FDs missing from @tests: tag — add: howto-index-pipeline
- `src/hooks/__tests__/noldor-pre-commit.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/autonomous/__tests__/drain-eligibility.test.ts` — imports files owned by FDs missing from @tests: tag — add: autonomous-queue-drain-runner
- `src/autonomous/__tests__/build-pool.test.ts` — imports files owned by FDs missing from @tests: tag — add: autonomous-queue-drain-runner, parallel-drain, plan-runner
- `src/autonomous/__tests__/decide-next.test.ts` — imports files owned by FDs missing from @tests: tag — add: autonomous-queue-drain-runner, parallel-drain, plan-runner
- `src/autonomous/__tests__/drain-source.test.ts` — imports files owned by FDs missing from @tests: tag — add: plan-runner
- `src/autonomous/__tests__/run-drain.test.ts` — imports files owned by FDs missing from @tests: tag — add: autonomous-queue-drain-runner, parallel-drain, plan-runner
- `src/autonomous/__tests__/queue-drain-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: autonomous-queue-drain-runner, parallel-drain, plan-runner
- `src/autonomous/__tests__/drain-lock.test.ts` — imports files owned by FDs missing from @tests: tag — add: autonomous-queue-drain-runner
- `src/autonomous/__tests__/drain-state.test.ts` — imports files owned by FDs missing from @tests: tag — add: autonomous-queue-drain-runner, parallel-drain
- `src/autonomous/__tests__/merge-classify.test.ts` — imports files owned by FDs missing from @tests: tag — add: autonomous-queue-drain-runner, parallel-drain, plan-runner
- `src/autonomous/__tests__/merge-coordinator.test.ts` — imports files owned by FDs missing from @tests: tag — add: autonomous-queue-drain-runner, parallel-drain, plan-runner

### Done features without code

- `decouple-milestones-from-semver` — Decouple Milestones from Semver (tooling) has no entries in links.code
- `framework-doc-extraction` — Framework Doc Extraction (tooling) has no entries in links.code
- `noldor-package-lift` — Noldor Package Lift (tooling) has no entries in links.code
- `scripts-reorganization-by-feature-area` — Scripts Reorganization By Feature/Area (tooling) has no entries in links.code
- `trailer-scope-alias-map` — Trailer Scope-Alias Map (tooling) has no entries in links.code
