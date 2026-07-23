<!-- generated: do-not-edit -->

# SDD Report

Generated: 2026-07-23 by `pnpm sdd:report`.

Pre-MVP done features (`introduced` < `0.2.0`) are
grandfathered from `links.spec` / `links.code` checks.
Bump `MIN_ENFORCED_VERSION` in `scripts/garden/sdd-report.ts` once backfill is done.

## Summary

- Total features: 75
- Untriaged ideas: 0
- Backlog entries: 5
- Gap categories with issues: 6 / 14

## Code clones

- 280 clone group(s), 13.81% duplicated tokens across 291 file(s)
- src/garden/garden-detect.ts:98-204 and src/garden/garden-detect.ts:221-327 (388 tokens)
- src/dashboard/views.ts:752-807 and src/dashboard/views.ts:830-934 (323 tokens)
- src/dashboard/data.ts:1130-1161 and src/garden/sdd-report.ts:908-943 (259 tokens)
- src/dashboard/views.ts:671-680 and src/dashboard/views.ts:939-948 (252 tokens)
- src/sync/sync-code-links.ts:13-59 and src/sync/sync-test-links.ts:8-56 (227 tokens)

## Gate compliance

### Tier distribution

- `full` (brainstorm + spec + plan): 37
- `specs-only` (no brainstorm): 38

### Override usage (last 30 days)

- `026845f` — templates/docs twin edits not yet allowlisted (tracked as Q-0023)
- `bbbc88d` — mechanical doc-frontmatter twin sync; zero code delta; templates/docs/noldor twins fall outside micro-chore/release-sweep allowlists (framework gap)
- `a890954` — prep-promote batch (drafts operator-approved at artifact stage)
- `d015f16` — prep-promote batch (drafts operator-approved at artifact stage)
- `7001d1e` — prep-promote batch (drafts operator-approved at artifact stage)
- `cfb750a` — prep-promote batch (drafts operator-approved at artifact stage)
- `4404525` — prep-promote batch (drafts operator-approved at artifact stage)

### Review-skip count (last 30 days)

Gated commits missing `Noldor-Reviewed` trailer: 103

## Metrics

### cycle-time [days]

```json
{
  "medianDays": 20.6,
  "p90Days": 56.5,
  "medianByPath": {
    "unknown": 20.6,
    "full-new": 20.6,
    "specs-only-new": 25.8
  },
  "excluded": {
    "noIntake": 29,
    "noTag": 5
  }
}
```

formula: days(intake → release): intake = FD frontmatter `since` else roadmap-history recovery; release = creator date of tag v<introduced>. Median + p90 over FDs with both endpoints.
blind spots: FDs with unrecoverable intake or an introduced version without a matching v-tag are excluded (see excluded tally). | Provenance segmentation approximates: autonomous = any agent-event for the slug; pre-event-log autonomous ships read as operator/unknown. | Pre-Noldor-Path commits make path segmentation read `unknown`.

### routing-accuracy [entries]

```json
{
  "table": {},
  "matches": 0,
  "total": 0,
  "excluded": 10,
  "window": 10
}
```

formula: sizeToPath(intake.size, intake.parent != null) vs first Noldor-Path trailer of the FD's commits, over the last 10 shipped FDs (by release-tag date).
blind spots: Entries whose roadmap size/parent could not be recovered from history, or whose commits predate the Noldor-Path trailer, are excluded (see excluded count). | First-trailer-wins: a feature shipped across mixed paths is judged by its first commit path.

### cr-effectiveness [findings / corrective commits]

```json
{
  "perLane": {
    "reviewer": {
      "blockers": 7,
      "suggestions": 32
    },
    "verifier": {
      "blockers": 0,
      "suggestions": 0
    }
  },
  "correctiveBySlug": {},
  "windowDays": 14
}
```

formula: Per-lane blockers+suggestions from .noldor/cr LaneFindings vs fix:/revert: commits carrying the same Noldor-FD within 14 days after the FD's release-tag date.
blind spots: Approximation: a corrective commit is attributed by trailer + subject prefix; refactors that silently fix, or fixes without the FD trailer, are invisible. | CR sinks are operator-local and pruned/archived — historical lanes may be missing entirely.

### drain-reliability [runs / events]

```json
{
  "lastRun": {
    "shipped": 3,
    "skipped": 0,
    "retried": 0
  },
  "history": {
    "salvaged": 2,
    "escalatedTotal": 10,
    "escalatedBySlug": {
      "trailer-scope-alias-map": 2,
      "prefix-skills-with-noldor": 2,
      "framework-script-test-migration-cleanup": 3,
      "scope-sibling-trailer-for-doc-sync-commits": 1,
      "-": 2
    },
    "meanDurationMs": 1062684
  }
}
```

formula: lastRun: shipped/skip/retries from .noldor/drain-state.json (live snapshot, overwritten per run). history: salvaged = agent-events kind=salvaged; escalated = escalations.jsonl counts (total/per-slug); mean duration over exited agent-events (spawned/phase rows excluded).
blind spots: drain-state.json is the LATEST run only — it cannot yield per-run history or trends. | Event/escalation history starts at the event-log epoch (2026-06-12); earlier drains are invisible. | Rows written before run ids shipped carry no runId — they group under "(no run id)".

### override-pressure [override commits]

```json
{}
```

formula: Count of commits carrying a Noldor-Override-prefixed trailer, grouped by trailer key and by release window (first tag dated >= commit date; after last tag → unreleased).
blind spots: Only trailer-carrying overrides count; env-var bypasses (the release-skip env flags) leave no commit trace. | Rising counts can mean a stricter gate OR more violations — the metric flags friction, not fault.

### tokens-per-feature [raw tokens (NEVER cost)]

```json
{
  "graphify-ast-only-sweep-default": null,
  "framework-auto-split-suggestion-for-big-features-and-plans": 105051,
  "framework-script-test-migration-cleanup": 827485,
  "scope-sibling-trailer-for-doc-sync-commits": 272153,
  "self-boundaries-declaration-and-cycle-break": 215653,
  "stable-entry-ids-for-roadmap-backlog": 394863,
  "first-class-blocked-by-field": 507049,
  "init-adopt-flag-drift-reconciliation": 124900,
  "consumer-rule-conflicts-graceful-degradation": 200457,
  "init-scaffold-noldor-scope-allowlist": 1076721,
  "add-templates-docs-to-micro-chore-and-release-sweep-allowlists": 79251,
  "pr-flow-fallback-merges-on-red-ci": 115370,
  "plans-source-drain-deps-gating": 116951,
  "test-tag-presence-on-src-layout": 110733,
  "verify-lane-bake-in-blocking-mode-pr-evidence": 454759,
  "dashboard-actions-row-full-height": 48296,
  "dashboard-merge-hot-zones-into-wip-age": 184834,
  "dashboard-merge-skills-into-framework": 49050
}
```

formula: Sum of agent-event tokens.total per slug. Tokens are read verbatim from runner usage records (claude-jsonl / codex-session / opencode-session); events without trustworthy usage carry no tokens.
blind spots: null = no usage data, not zero usage: operator-driven interactive sessions and runners without locatable usage records are invisible. | Only spawn-captured agents count; epoch-limited to when token capture shipped.

## Gap details

### Done features without tests

- `memory-intake-lessons-learned-pipeline` — Memory-Intake / Lessons-Learned Pipeline (tooling) has no tests in links.tests
- `readme-rewrite-consumer-journey-order` — README Rewrite — Consumer-Journey Order (tooling) has no tests in links.tests
- `trailer-scope-alias-map` — Trailer Scope-Alias Map (tooling) has no tests in links.tests
- `vendored-systematic-debugging-discipline` — Vendored Systematic-Debugging Discipline (tooling) has no tests in links.tests

### Done features without docs

- `continuous-drain-daemon-and-escalation-inbox` — Continuous Drain Daemon and Escalation Inbox (tooling) has no entries in links.docs
- `make-noldor-agent-agnostic` — Make Noldor Agent-Agnostic (tooling) has no entries in links.docs

### Plans without matching spec

- `docs/design/plans/2026-06-07-end-of-flow-ergonomics.md` — docs/design/plans/2026-06-07-end-of-flow-ergonomics.md has slug "end-of-flow-ergonomics" with no matching spec under docs/design/specs/

### Code files not referenced by any feature

- `src/core/atomic-write.ts` — src/core/atomic-write.ts is not referenced by any feature MD links.code — probable owner: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox
- `src/core/fmt-guard-cli.ts` — src/core/fmt-guard-cli.ts is not referenced by any feature MD links.code
- `src/core/fmt-guard.ts` — src/core/fmt-guard.ts is not referenced by any feature MD links.code
- `src/core/init-gitignore.ts` — src/core/init-gitignore.ts is not referenced by any feature MD links.code — probable owner: version-aware-upgrade-and-migration-chain, noldor, make-noldor-agent-agnostic
- `src/core/lanes.ts` — src/core/lanes.ts is not referenced by any feature MD links.code — probable owner: acceptance-verify-lane, specs-cr-gate-multi-reviewer
- `src/core/prerequisites.ts` — src/core/prerequisites.ts is not referenced by any feature MD links.code — probable owner: make-noldor-agent-agnostic
- `src/core/prompt-stdin.ts` — src/core/prompt-stdin.ts is not referenced by any feature MD links.code — probable owner: acceptance-verify-lane, specs-cr-gate-multi-reviewer
- `src/core/review-profile.ts` — src/core/review-profile.ts is not referenced by any feature MD links.code — probable owner: acceptance-verify-lane, specs-cr-gate-multi-reviewer, make-noldor-agent-agnostic
- `src/core/state-file.ts` — src/core/state-file.ts is not referenced by any feature MD links.code — probable owner: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox
- `src/invariants/rule-pairs.ts` — src/invariants/rule-pairs.ts is not referenced by any feature MD links.code — probable owner: architecture-invariants
- `src/release/clean-tree.ts` — src/release/clean-tree.ts is not referenced by any feature MD links.code — probable owner: registry-distribution-for-the-noldor-package

### Tests with incomplete co-tag

- `src/migrations/__tests__/chain.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-script-test-migration-cleanup
- `src/migrations/__tests__/0.5.0.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-script-test-migration-cleanup, prefix-skills-with-noldor
- `src/migrations/__tests__/0.6.0.test.ts` — imports files owned by FDs missing from @tests: tag — add: prefix-skills-with-noldor
- `src/migrations/__tests__/0.7.0.test.ts` — imports files owned by FDs missing from @tests: tag — add: version-aware-upgrade-and-migration-chain
- `src/core/__tests__/feature-schema.test.ts` — imports files owned by FDs missing from @tests: tag — add: stable-entry-ids-for-roadmap-backlog
- `src/core/__tests__/feature-schema-since.test.ts` — imports files owned by FDs missing from @tests: tag — add: stable-entry-ids-for-roadmap-backlog
- `src/core/__tests__/next-priority.test.ts` — imports files owned by FDs missing from @tests: tag — add: stable-entry-ids-for-roadmap-backlog
- `src/core/__tests__/release-markers.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-script-test-migration-cleanup
- `src/core/__tests__/repo-paths.test.ts` — imports files owned by FDs missing from @tests: tag — add: code-clone-detector, dynamic-fd-file-pointers-via-frontmatter
- `src/core/__tests__/consumer-config-boundaries.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, version-aware-upgrade-and-migration-chain
- `src/core/__tests__/allowlist.test.ts` — imports files owned by FDs missing from @tests: tag — add: prefix-skills-with-noldor
- `src/core/__tests__/config.test.ts` — imports files owned by FDs missing from @tests: tag — add: code-clone-detector
- `src/core/__tests__/doc-roots.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-script-test-migration-cleanup
- `src/core/agent-runner/__tests__/types.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, portable-gate-entrypoint-for-non-claude-runners
- `src/core/agent-runner/__tests__/registry-logsink.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, drain-startup-reconciliation-of-a-prior-dead-run, make-noldor-agent-agnostic
- `src/core/agent-runner/__tests__/doctor-runners.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, portable-gate-entrypoint-for-non-claude-runners
- `src/core/agent-runner/__tests__/registry.test.ts` — imports files owned by FDs missing from @tests: tag — add: portable-gate-entrypoint-for-non-claude-runners
- `src/garden/__tests__/backlog-demote.test.ts` — imports files owned by FDs missing from @tests: tag — add: stable-entry-ids-for-roadmap-backlog
- `src/garden/__tests__/garden-receipt.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-bypass-retirement
- `src/garden/__tests__/garden-detect.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-bypass-retirement
- `src/garden/__tests__/graph-fd-lookup.test.ts` — imports files owned by FDs missing from @tests: tag — add: sdd-detector-5-idea-merge-semantic-similarity, stable-entry-ids-for-roadmap-backlog
- `src/garden/__tests__/sdd-report.test.ts` — imports files owned by FDs missing from @tests: tag — add: code-clone-detector, framework-script-test-migration-cleanup, release-bypass-retirement, scan-roots-repo-paths-provider, sdd-detector-5-idea-merge-semantic-similarity, stable-entry-ids-for-roadmap-backlog
- `src/garden/detectors/__tests__/skill-code-drift.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/override-audit.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-bypass-retirement
- `src/garden/detectors/__tests__/fd-command-rot.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/fd-link-rot.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/circular-blocked-by.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/cr/__tests__/bootstrap-immunity.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-bypass-retirement
- `src/features/__tests__/feature-milestone.test.ts` — imports files owned by FDs missing from @tests: tag — add: stable-entry-ids-for-roadmap-backlog
- `src/features/__tests__/propose-pointers.test.ts` — imports files owned by FDs missing from @tests: tag — add: scan-roots-repo-paths-provider
- `src/features/__tests__/fill-links-code-gaps.test.ts` — imports files owned by FDs missing from @tests: tag — add: scan-roots-repo-paths-provider, stable-entry-ids-for-roadmap-backlog
- `src/invariants/__tests__/rule-conflicts.test.ts` — imports files owned by FDs missing from @tests: tag — add: architecture-invariants
- `src/invariants/__tests__/boundaries.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, architecture-invariants, version-aware-upgrade-and-migration-chain
- `src/utils/__tests__/parse-blocks.test.ts` — imports files owned by FDs missing from @tests: tag — add: stable-entry-ids-for-roadmap-backlog
- `src/release/__tests__/release-session.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/release/__tests__/release-cr-gate-e2e.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-bypass-retirement
- `src/release/__tests__/release-cr-gate.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-bypass-retirement
- `src/release/__tests__/release-resume.test.ts` — imports files owned by FDs missing from @tests: tag — add: dynamic-fd-changelog, framework-pr-flow-agent-auto-merge, registry-distribution-for-the-noldor-package, release-bypass-retirement, release-script-sddreport-skip-if-only-count-line-changed, release-script-self-provisions-its-own-session-marker, release-sweep-process-hardening
- `src/triage/__tests__/score.test.ts` — imports files owned by FDs missing from @tests: tag — add: stable-entry-ids-for-roadmap-backlog
- `src/triage/__tests__/triage-list-untriaged.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-script-test-migration-cleanup
- `src/triage/__tests__/validate-triage.test.ts` — imports files owned by FDs missing from @tests: tag — add: stable-entry-ids-for-roadmap-backlog
- `src/cli/__tests__/validate-script-catalog.test.ts` — imports files owned by FDs missing from @tests: tag — add: autonomous-queue-drain-runner, bootstrap-immunity-for-self-gating-features, code-clone-detector, continuous-drain-daemon-and-escalation-inbox, framework-auto-split-suggestion-for-big-features-and-plans, graphify-plan-of-edges-nodes-for-plans-specs, outcome-telemetry-and-effectiveness-metrics, parallel-agent-dispatch-for-research-jobs, plan-runner, pnpm-release-resume, registry-distribution-for-the-noldor-package, sdd-detector-5-idea-merge-semantic-similarity, stable-entry-ids-for-roadmap-backlog, version-aware-upgrade-and-migration-chain
- `src/dashboard/__tests__/route-sweep.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics, project-tracking-dashboard
- `src/dashboard/__tests__/dashboard-layout-style-polish.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/dashboard-views.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, scan-roots-repo-paths-provider, stable-entry-ids-for-roadmap-backlog
- `src/dashboard/__tests__/dashboard-worktrees.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, scan-roots-repo-paths-provider
- `src/dashboard/__tests__/host.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/dashboard-agents.test.ts` — imports files owned by FDs missing from @tests: tag — add: dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, dynamic-fd-changelog, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics, project-tracking-dashboard, replace-roadmap-buckets-with-flat-priority-order, roadmap-priority-ordering, scan-roots-repo-paths-provider
- `src/dashboard/__tests__/dashboard-mermaid.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, scan-roots-repo-paths-provider
- `src/dashboard/__tests__/dashboard-test-pyramid.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, scan-roots-repo-paths-provider
- `src/dashboard/__tests__/dashboard-ensure.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/milestones-view.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, decouple-milestones-from-semver, scan-roots-repo-paths-provider
- `src/dashboard/__tests__/dashboard-skills.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, scan-roots-repo-paths-provider
- `src/dashboard/__tests__/dashboard-repo-brand.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/metrics-view.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/dashboard-graph-health.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, scan-roots-repo-paths-provider
- `src/dashboard/__tests__/api-blocks.test.ts` — imports files owned by FDs missing from @tests: tag — add: stable-entry-ids-for-roadmap-backlog
- `src/dashboard/__tests__/dashboard-release-notes.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, scan-roots-repo-paths-provider
- `src/dashboard/__tests__/dashboard-render-markdown.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, scan-roots-repo-paths-provider
- `src/dashboard/__tests__/dashboard-layout-body-styles.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/dashboard-server.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/server-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/dashboard-doc-surfaces.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, scan-roots-repo-paths-provider
- `src/dashboard/__tests__/blocked-by.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, dynamic-fd-changelog, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics, project-tracking-dashboard, replace-roadmap-buckets-with-flat-priority-order, roadmap-priority-ordering, scan-roots-repo-paths-provider
- `src/dashboard/__tests__/dashboard-data.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, code-clone-detector, scan-roots-repo-paths-provider
- `src/testing/__tests__/consumer-fixture.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/testing/__tests__/stub-runner.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, portable-gate-entrypoint-for-non-claude-runners
- `src/hooks/__tests__/noldor-validate-trailer.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-doc-extraction
- `src/templates/__tests__/templates.test.ts` — imports files owned by FDs missing from @tests: tag — add: make-noldor-agent-agnostic, noldor
- `src/autonomous/__tests__/drain-reconcile.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, portable-gate-entrypoint-for-non-claude-runners
- `src/autonomous/__tests__/build-pool.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, portable-gate-entrypoint-for-non-claude-runners
- `src/autonomous/__tests__/phase-events.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, autonomous-queue-drain-runner, consumer-contract-ci-and-headless-gate-e2e-harness, drain-startup-reconciliation-of-a-prior-dead-run, parallel-drain
- `src/autonomous/__tests__/salvage.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/autonomous/__tests__/decide-next.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, portable-gate-entrypoint-for-non-claude-runners
- `src/autonomous/__tests__/status-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness, drain-startup-reconciliation-of-a-prior-dead-run, parallel-drain
- `src/autonomous/__tests__/resolve-roadmap-conflict.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/autonomous/__tests__/run-drain.test.ts` — imports files owned by FDs missing from @tests: tag — add: portable-gate-entrypoint-for-non-claude-runners
- `src/autonomous/__tests__/watch-state.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/autonomous/__tests__/watch-args.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/autonomous/__tests__/escalations.test.ts` — imports files owned by FDs missing from @tests: tag — add: portable-gate-entrypoint-for-non-claude-runners
- `src/autonomous/__tests__/queue-drain-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/autonomous/__tests__/gate-prompt.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness, prefix-skills-with-noldor
- `src/autonomous/__tests__/merge-classify.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, portable-gate-entrypoint-for-non-claude-runners
- `src/autonomous/__tests__/merge-coordinator.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, portable-gate-entrypoint-for-non-claude-runners
- `src/sync/__tests__/sync-code-links.test.ts` — imports files owned by FDs missing from @tests: tag — add: scan-roots-repo-paths-provider

### Done features without code

- `dashboard-blocked-by-graph-view` — Dashboard Blocked-By Graph View (tooling) has no entries in links.code
- `dashboard-broken-pages-audit` — Dashboard Broken-Pages Audit (tooling) has no entries in links.code
- `memory-intake-lessons-learned-pipeline` — Memory-Intake / Lessons-Learned Pipeline (tooling) has no entries in links.code
- `noldor-package-lift` — Noldor Package Lift (tooling) has no entries in links.code
- `readme-rewrite-consumer-journey-order` — README Rewrite — Consumer-Journey Order (tooling) has no entries in links.code
- `scripts-reorganization-by-feature-area` — Scripts Reorganization By Feature/Area (tooling) has no entries in links.code
- `self-boundaries-declaration-and-cycle-break` — Self-Boundaries Declaration and Cycle Break (tooling) has no entries in links.code
- `skill-vs-code-drift-detector` — Skill-vs-Code Drift Detector (tooling) has no entries in links.code
- `state-file-fail-open-hardening` — State-File Fail-Open Hardening (tooling) has no entries in links.code
- `trailer-scope-alias-map` — Trailer Scope-Alias Map (tooling) has no entries in links.code
- `vendored-systematic-debugging-discipline` — Vendored Systematic-Debugging Discipline (tooling) has no entries in links.code
