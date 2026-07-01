<!-- generated: do-not-edit -->

# SDD Report

Generated: 2026-07-01 by `pnpm sdd:report`.

Pre-MVP done features (`introduced` < `0.2.0`) are
grandfathered from `links.spec` / `links.code` checks.
Bump `MIN_ENFORCED_VERSION` in `scripts/garden/sdd-report.ts` once backfill is done.

## Summary

- Total features: 50
- Untriaged ideas: 0
- Backlog entries: 4
- Gap categories with issues: 7 / 14

## Gate compliance

### Tier distribution

- `full` (brainstorm + spec + plan): 32
- `specs-only` (no brainstorm): 18

### Override usage (last 30 days)

- `ec7bf0b` — cr-red override acceptance-verify-lane - operator accepted residual med risk-notes after 5 CR rounds; 4 substantive fixes landed; verify lane pass
- `1f08bd2` — fast-track framework chore, no FD; spans gate SKILL.md twins + docs/noldor + docs/features so no single conventional scope fits. Controller-reviewed; /garden audits the override.
- `211e3ae` — fast-track framework chore, no FD; cr:orchestrate is slug-based so no review-receipt path fits; allowlist + doc changes controller-reviewed, /garden audits the override.

### Review-skip count (last 30 days)

Gated commits missing `Noldor-Reviewed` trailer: 72

## Metrics

### cycle-time [days]

```json
{
  "medianDays": 25.8,
  "p90Days": 31.8,
  "medianByPath": {
    "specs-only-new": 25.8
  },
  "excluded": {
    "noIntake": 17,
    "noTag": 16
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
    "subagent": {
      "blockers": 7,
      "suggestions": 19
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
    "shipped": 0,
    "skipped": 0,
    "retried": 2
  },
  "history": {
    "salvaged": 0,
    "escalatedTotal": 2,
    "escalatedBySlug": {
      "trailer-scope-alias-map": 1,
      "prefix-skills-with-noldor": 1
    },
    "meanDurationMs": 451693
  }
}
```

formula: lastRun: shipped/skip/retries from .noldor/drain-state.json (live snapshot, overwritten per run). history: salvaged = agent-events kind=salvaged; escalated = escalations.jsonl counts (total/per-slug — rows carry no run id); mean duration over all agent-events.
blind spots: drain-state.json is the LATEST run only — it cannot yield per-run history or trends. | Event/escalation history starts at the event-log epoch (2026-06-12); earlier drains are invisible. | EscalationRow has no run identifier — per-run escalation grouping is not derivable (run-id is out of v1 scope).

### override-pressure [override commits]

```json
{}
```

formula: Count of commits carrying a Noldor-Override-prefixed trailer, grouped by trailer key and by release window (first tag dated >= commit date; after last tag → unreleased).
blind spots: Only trailer-carrying overrides count; env-var bypasses (the release-skip env flags) leave no commit trace. | Rising counts can mean a stricter gate OR more violations — the metric flags friction, not fault.

### tokens-per-feature [raw tokens (NEVER cost)]

```json
{}
```

formula: Sum of agent-event tokens.total per slug. Tokens are read verbatim from runner usage records (claude-jsonl / codex-session / opencode-session); events without trustworthy usage carry no tokens.
blind spots: null = no usage data, not zero usage: operator-driven interactive sessions and runners without locatable usage records are invisible. | Only spawn-captured agents count; epoch-limited to when token capture shipped.

## Gap details

### Done features without tests

- `code-reviewer-20` — Code Reviewer 2.0 (tooling) has no tests in links.tests
- `de-superpowers-vendor-spec-plan-and-worktree-flows` — De-Superpowers: Vendor Spec, Plan and Worktree Flows (tooling) has no tests in links.tests
- `decouple-milestones-from-semver` — Decouple Milestones from Semver (tooling) has no tests in links.tests
- `framework-doc-extraction` — Framework Doc Extraction (tooling) has no tests in links.tests
- `per-task-dev-environment-bootstrap` — Per-Task Dev Environment Bootstrap (tooling) has no tests in links.tests
- `release-script-self-provisions-its-own-session-marker` — Release Script Self-Provisions Its Own Session Marker (tooling) has no tests in links.tests
- `release-sweep-process-hardening` — Release-Sweep Process Hardening (tooling) has no tests in links.tests
- `replace-roadmap-buckets-with-flat-priority-order` — Replace Roadmap Buckets with Flat Priority Order (tooling) has no tests in links.tests
- `trailer-scope-alias-map` — Trailer Scope-Alias Map (tooling) has no tests in links.tests
- `triage-scoring-rubric-effort-impact-confidence-dependency` — `/triage` Scoring Rubric (effort × impact × confidence × dependency) (tooling) has no tests in links.tests
- `version-aware-upgrade-and-migration-chain` — Version-Aware Upgrade and Migration Chain (tooling) has no tests in links.tests

### Done features without docs

- `continuous-drain-daemon-and-escalation-inbox` — Continuous Drain Daemon and Escalation Inbox (tooling) has no entries in links.docs
- `make-noldor-agent-agnostic` — Make Noldor Agent-Agnostic (tooling) has no entries in links.docs

### Done features missing introduced

- `acceptance-verify-lane` — Acceptance-Verify Lane is phase=done but introduced is unset (release script should fill on next pnpm release)
- `bootstrap-immunity-for-self-gating-features` — Bootstrap-Immunity for Self-Gating Features is phase=done but introduced is unset (release script should fill on next pnpm release)
- `code-reviewer-20` — Code Reviewer 2.0 is phase=done but introduced is unset (release script should fill on next pnpm release)
- `consumer-contract-ci-and-headless-gate-e2e-harness` — Consumer-Contract CI and Headless Gate E2E Harness is phase=done but introduced is unset (release script should fill on next pnpm release)
- `continuous-drain-daemon-and-escalation-inbox` — Continuous Drain Daemon and Escalation Inbox is phase=done but introduced is unset (release script should fill on next pnpm release)
- `de-superpowers-vendor-spec-plan-and-worktree-flows` — De-Superpowers: Vendor Spec, Plan and Worktree Flows is phase=done but introduced is unset (release script should fill on next pnpm release)
- `drain-startup-reconciliation-of-a-prior-dead-run` — Drain Startup Reconciliation of a Prior Dead Run is phase=done but introduced is unset (release script should fill on next pnpm release)
- `dynamic-fd-file-pointers-via-frontmatter` — Dynamic FD ↔ File Pointers via Frontmatter is phase=done but introduced is unset (release script should fill on next pnpm release)
- `framework-milestones-support-poc-mvp-100` — Framework Milestones Support (POC / MVP / 1.0.0) is phase=done but introduced is unset (release script should fill on next pnpm release)
- `graphify-plan-of-edges-nodes-for-plans-specs` — Graphify `plan-of` edges + nodes for plans/specs is phase=done but introduced is unset (release script should fill on next pnpm release)
- `make-noldor-agent-agnostic` — Make Noldor Agent-Agnostic is phase=done but introduced is unset (release script should fill on next pnpm release)
- `outcome-telemetry-and-effectiveness-metrics` — Outcome Telemetry and Effectiveness Metrics is phase=done but introduced is unset (release script should fill on next pnpm release)
- `parallel-drain-roadmapmd-conflict-auto-resolution` — Parallel-Drain `roadmap.md` Conflict Auto-Resolution is phase=done but introduced is unset (release script should fill on next pnpm release)
- `per-task-dev-environment-bootstrap` — Per-Task Dev Environment Bootstrap is phase=done but introduced is unset (release script should fill on next pnpm release)
- `version-aware-upgrade-and-migration-chain` — Version-Aware Upgrade and Migration Chain is phase=done but introduced is unset (release script should fill on next pnpm release)

### Plans without matching spec

- `docs/superpowers/plans/2026-06-07-end-of-flow-ergonomics.md` — docs/superpowers/plans/2026-06-07-end-of-flow-ergonomics.md has slug "end-of-flow-ergonomics" with no matching spec under docs/superpowers/specs/

### Code files not referenced by any feature

- `scripts/migration/classify-feature-track.ts` — scripts/migration/classify-feature-track.ts is not referenced by any feature MD links.code
- `scripts/migration/classify.ts` — scripts/migration/classify.ts is not referenced by any feature MD links.code
- `scripts/migration/cross-tree-link-audit.ts` — scripts/migration/cross-tree-link-audit.ts is not referenced by any feature MD links.code
- `scripts/migration/partition-blocks.ts` — scripts/migration/partition-blocks.ts is not referenced by any feature MD links.code
- `scripts/migration/stage-framework-docs.ts` — scripts/migration/stage-framework-docs.ts is not referenced by any feature MD links.code

### Tests with incomplete co-tag

- `src/metrics/__tests__/compute.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/metrics/__tests__/cr-and-override.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, outcome-telemetry-and-effectiveness-metrics
- `src/metrics/__tests__/routing-accuracy.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/metrics/__tests__/cycle-time.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/metrics/__tests__/facts.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/metrics/__tests__/compute-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/migrations/__tests__/chain.test.ts` — imports files owned by FDs missing from @tests: tag — add: version-aware-upgrade-and-migration-chain
- `src/migrations/__tests__/semver.test.ts` — imports files owned by FDs missing from @tests: tag — add: version-aware-upgrade-and-migration-chain
- `src/migrations/__tests__/pkg-version.test.ts` — imports files owned by FDs missing from @tests: tag — add: version-aware-upgrade-and-migration-chain
- `src/prep/__tests__/formats.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows, plan-runner
- `src/prep/__tests__/scaffold.test.ts` — imports files owned by FDs missing from @tests: tag — add: plan-runner
- `src/prep/__tests__/index-doc.test.ts` — imports files owned by FDs missing from @tests: tag — add: plan-runner
- `src/prep/__tests__/staging.test.ts` — imports files owned by FDs missing from @tests: tag — add: plan-runner
- `src/prep/__tests__/discover.test.ts` — imports files owned by FDs missing from @tests: tag — add: plan-runner
- `src/prep/__tests__/prep-promote.test.ts` — imports files owned by FDs missing from @tests: tag — add: plan-runner
- `src/core/__tests__/changelog.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/core/__tests__/consumer-config.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, version-aware-upgrade-and-migration-chain
- `src/core/__tests__/next-priority.test.ts` — imports files owned by FDs missing from @tests: tag — add: autonomous-queue-drain-runner, noldor
- `src/core/__tests__/validate-skill-catalog.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/core/__tests__/agent-events.test.ts` — imports files owned by FDs missing from @tests: tag — add: continuous-drain-daemon-and-escalation-inbox, make-noldor-agent-agnostic
- `src/core/__tests__/framework-version.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, version-aware-upgrade-and-migration-chain
- `src/core/__tests__/validate-noldor-scope.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/core/__tests__/release-markers.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/core/__tests__/lint-plan-snippets.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/core/__tests__/validate-noldor.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/core/__tests__/pr-flow-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: parallel-drain
- `src/core/__tests__/pr-flow.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor, parallel-drain
- `src/core/agent-runner/usage/__tests__/adapters.test.ts` — imports files owned by FDs missing from @tests: tag — add: make-noldor-agent-agnostic
- `src/core/agent-runner/__tests__/types.test.ts` — imports files owned by FDs missing from @tests: tag — add: drain-startup-reconciliation-of-a-prior-dead-run, make-noldor-agent-agnostic
- `src/core/agent-runner/__tests__/runners.test.ts` — imports files owned by FDs missing from @tests: tag — add: make-noldor-agent-agnostic
- `src/core/agent-runner/__tests__/doctor-runners.test.ts` — imports files owned by FDs missing from @tests: tag — add: drain-startup-reconciliation-of-a-prior-dead-run, make-noldor-agent-agnostic
- `src/core/agent-runner/__tests__/registry.test.ts` — imports files owned by FDs missing from @tests: tag — add: drain-startup-reconciliation-of-a-prior-dead-run, make-noldor-agent-agnostic
- `src/garden/__tests__/plan-resolution.test.ts` — imports files owned by FDs missing from @tests: tag — add: graphify-plan-of-edges-nodes-for-plans-specs, outcome-telemetry-and-effectiveness-metrics
- `src/garden/__tests__/backlog-demote.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/__tests__/garden-receipt.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/__tests__/garden-detect.test.ts` — imports files owned by FDs missing from @tests: tag — add: bootstrap-immunity-for-self-gating-features, framework-milestones-support-poc-mvp-100, graphify-plan-of-edges-nodes-for-plans-specs, outcome-telemetry-and-effectiveness-metrics
- `src/garden/__tests__/graph-fd-lookup.test.ts` — imports files owned by FDs missing from @tests: tag — add: bootstrap-immunity-for-self-gating-features, framework-milestones-support-poc-mvp-100, noldor, outcome-telemetry-and-effectiveness-metrics, release-script-sddreport-skip-if-only-count-line-changed
- `src/garden/__tests__/sdd-report.test.ts` — imports files owned by FDs missing from @tests: tag — add: bootstrap-immunity-for-self-gating-features, framework-milestones-support-poc-mvp-100, noldor, outcome-telemetry-and-effectiveness-metrics, release-script-sddreport-skip-if-only-count-line-changed
- `src/garden/__tests__/garden-detect-runner.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/garden/__tests__/sdd-report-metrics.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics, release-script-sddreport-skip-if-only-count-line-changed
- `src/garden/detectors/__tests__/migration-coverage.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/tier-mismatch.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/override-audit.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor, outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/fd-without-plan.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/milestone-shipped-incomplete.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/trailer-scope-mismatch.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/codex-cr-override-audit.test.ts` — imports files owned by FDs missing from @tests: tag — add: bootstrap-immunity-for-self-gating-features, noldor, outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/code-links-drift.test.ts` — imports files owned by FDs missing from @tests: tag — add: dynamic-fd-file-pointers-via-frontmatter, outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/allowlist-drift.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/plan-without-fd.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/bootstrap-override-audit.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, bootstrap-immunity-for-self-gating-features, outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/branch-protection.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/cr/__tests__/overwrite-guard.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/prompt-stdin.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/review-profile.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/amend-receipt.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/orchestrate.integration.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/filename.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/read-fd-summary.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/gate-registry.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, bootstrap-immunity-for-self-gating-features
- `src/cr/__tests__/cli-args.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, noldor
- `src/cr/__tests__/deep-review-spawn.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, make-noldor-agent-agnostic
- `src/cr/__tests__/bootstrap-immunity.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, bootstrap-immunity-for-self-gating-features, noldor
- `src/cr/__tests__/delta.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/escalate.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/context.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, noldor
- `src/cr/__tests__/run-codex.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, make-noldor-agent-agnostic, noldor
- `src/cr/__tests__/sidecar.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, noldor
- `src/cr/__tests__/atomic-write.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/findings-schema.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/config.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, continuous-drain-daemon-and-escalation-inbox
- `src/cr/__tests__/schema-parity.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, noldor
- `src/cr/__tests__/orchestrate.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/aggregate.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/codex.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, noldor
- `src/cr/__tests__/lanes/subagent-dispatch.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, make-noldor-agent-agnostic
- `src/cr/__tests__/lanes/verify-dispatch.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/lanes/manual.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/lanes/verify.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/lanes/subagent.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, make-noldor-agent-agnostic
- `src/cr/__tests__/lanes/codex.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/features/__tests__/feature-milestone.test.ts` — imports files owned by FDs missing from @tests: tag — add: bootstrap-immunity-for-self-gating-features, framework-milestones-support-poc-mvp-100
- `src/features/__tests__/migrate-code-tags.test.ts` — imports files owned by FDs missing from @tests: tag — add: dynamic-fd-file-pointers-via-frontmatter
- `src/features/__tests__/feature-schema.test.ts` — imports files owned by FDs missing from @tests: tag — add: bootstrap-immunity-for-self-gating-features, framework-milestones-support-poc-mvp-100
- `src/features/__tests__/feature-schema-since.test.ts` — imports files owned by FDs missing from @tests: tag — add: bootstrap-immunity-for-self-gating-features, framework-milestones-support-poc-mvp-100
- `src/features/__tests__/propose-pointers.test.ts` — imports files owned by FDs missing from @tests: tag — add: dynamic-fd-file-pointers-via-frontmatter, outcome-telemetry-and-effectiveness-metrics
- `src/features/__tests__/validate-features.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-milestones-support-poc-mvp-100
- `src/features/__tests__/fill-links-code-gaps.test.ts` — imports files owned by FDs missing from @tests: tag — add: bootstrap-immunity-for-self-gating-features, framework-milestones-support-poc-mvp-100
- `src/utils/__tests__/write-blocks.test.ts` — imports files owned by FDs missing from @tests: tag — add: parallel-drain-roadmapmd-conflict-auto-resolution
- `src/release/__tests__/release-cr-gate-e2e.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/release/__tests__/release-cr-gate.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/release/__tests__/llm-polish-summary.test.ts` — imports files owned by FDs missing from @tests: tag — add: make-noldor-agent-agnostic
- `src/release/__tests__/release-config-flow.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, version-aware-upgrade-and-migration-chain
- `src/release/__tests__/sdd-report-diff.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics, release-script-sddreport-skip-if-only-count-line-changed
- `src/docs/__tests__/docs-howto.test.ts` — imports files owned by FDs missing from @tests: tag — add: howto-index-pipeline
- `src/docs/__tests__/howto-schema.test.ts` — imports files owned by FDs missing from @tests: tag — add: howto-index-pipeline
- `src/cli/commands/__tests__/upgrade.test.ts` — imports files owned by FDs missing from @tests: tag — add: version-aware-upgrade-and-migration-chain
- `src/dashboard/__tests__/dashboard-layout-style-polish.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/dashboard-views.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/dashboard-worktrees.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/dashboard-mermaid.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/dashboard-test-pyramid.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/dashboard-ensure.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/milestones-view.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/dashboard-skills.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/metrics-view.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/dashboard-graph-health.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/api-blocks.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/dashboard-release-notes.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/dashboard-render-markdown.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/dashboard-layout-body-styles.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/dashboard-server.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/edge-scroll.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/server-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/dashboard-doc-surfaces.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/dashboard-data.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/testing/__tests__/consumer-fixture.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness, drain-startup-reconciliation-of-a-prior-dead-run, make-noldor-agent-agnostic, version-aware-upgrade-and-migration-chain
- `src/testing/__tests__/contract-harness.test.ts` — imports files owned by FDs missing from @tests: tag — add: consumer-contract-ci-and-headless-gate-e2e-harness
- `src/testing/__tests__/drain-e2e.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, autonomous-queue-drain-runner, consumer-contract-ci-and-headless-gate-e2e-harness, drain-startup-reconciliation-of-a-prior-dead-run, noldor
- `src/testing/__tests__/stub-runner.test.ts` — imports files owned by FDs missing from @tests: tag — add: consumer-contract-ci-and-headless-gate-e2e-harness, drain-startup-reconciliation-of-a-prior-dead-run, make-noldor-agent-agnostic
- `src/hooks/__tests__/noldor-pre-commit.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/worktrees/__tests__/worktree-status.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/worktrees/__tests__/create-worktree.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/worktrees/__tests__/worktree-conflicts.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows, outcome-telemetry-and-effectiveness-metrics
- `src/worktrees/__tests__/down-worktree.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/worktrees/__tests__/launch-worktrees.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/worktrees/__tests__/open-editor.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/worktrees/__tests__/dev-surfaces.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/worktrees/__tests__/up-worktree.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/templates/__tests__/agent-filter.test.ts` — imports files owned by FDs missing from @tests: tag — add: make-noldor-agent-agnostic
- `src/autonomous/__tests__/drain-reconcile.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, autonomous-queue-drain-runner, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox, drain-startup-reconciliation-of-a-prior-dead-run, make-noldor-agent-agnostic, parallel-drain, parallel-drain-roadmapmd-conflict-auto-resolution, plan-runner
- `src/autonomous/__tests__/drain-eligibility.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, autonomous-queue-drain-runner, consumer-contract-ci-and-headless-gate-e2e-harness
- `src/autonomous/__tests__/notify.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox
- `src/autonomous/__tests__/build-pool.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, autonomous-queue-drain-runner, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox, drain-startup-reconciliation-of-a-prior-dead-run, parallel-drain, plan-runner
- `src/autonomous/__tests__/salvage.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox, parallel-drain-roadmapmd-conflict-auto-resolution
- `src/autonomous/__tests__/decide-next.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, autonomous-queue-drain-runner, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox, drain-startup-reconciliation-of-a-prior-dead-run, parallel-drain, plan-runner
- `src/autonomous/__tests__/drain-source.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness, plan-runner
- `src/autonomous/__tests__/resolve-roadmap-conflict.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox, parallel-drain-roadmapmd-conflict-auto-resolution
- `src/autonomous/__tests__/run-drain.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, autonomous-queue-drain-runner, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox, drain-startup-reconciliation-of-a-prior-dead-run, parallel-drain, plan-runner
- `src/autonomous/__tests__/watch-state.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, autonomous-queue-drain-runner, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox, drain-startup-reconciliation-of-a-prior-dead-run, parallel-drain, plan-runner
- `src/autonomous/__tests__/watch-args.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox
- `src/autonomous/__tests__/escalations.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, autonomous-queue-drain-runner, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox, drain-startup-reconciliation-of-a-prior-dead-run, parallel-drain, plan-runner
- `src/autonomous/__tests__/watch-detach.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness
- `src/autonomous/__tests__/queue-drain-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, autonomous-queue-drain-runner, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox, drain-startup-reconciliation-of-a-prior-dead-run, parallel-drain, plan-runner
- `src/autonomous/__tests__/drain-lock.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, autonomous-queue-drain-runner, consumer-contract-ci-and-headless-gate-e2e-harness, drain-startup-reconciliation-of-a-prior-dead-run
- `src/autonomous/__tests__/drain-state.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, autonomous-queue-drain-runner, consumer-contract-ci-and-headless-gate-e2e-harness, drain-startup-reconciliation-of-a-prior-dead-run, parallel-drain
- `src/autonomous/__tests__/merge-classify.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, autonomous-queue-drain-runner, consumer-contract-ci-and-headless-gate-e2e-harness, drain-startup-reconciliation-of-a-prior-dead-run, make-noldor-agent-agnostic, parallel-drain, parallel-drain-roadmapmd-conflict-auto-resolution, plan-runner
- `src/autonomous/__tests__/merge-coordinator.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, autonomous-queue-drain-runner, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox, drain-startup-reconciliation-of-a-prior-dead-run, parallel-drain, plan-runner
- `src/sync/__tests__/sync-code-links.test.ts` — imports files owned by FDs missing from @tests: tag — add: dynamic-fd-file-pointers-via-frontmatter
- `src/graphify/__tests__/enrich-doc-nodes.test.ts` — imports files owned by FDs missing from @tests: tag — add: graphify-plan-of-edges-nodes-for-plans-specs

### Done features without code

- `code-reviewer-20` — Code Reviewer 2.0 (tooling) has no entries in links.code
- `decouple-milestones-from-semver` — Decouple Milestones from Semver (tooling) has no entries in links.code
- `framework-doc-extraction` — Framework Doc Extraction (tooling) has no entries in links.code
- `noldor-package-lift` — Noldor Package Lift (tooling) has no entries in links.code
- `per-task-dev-environment-bootstrap` — Per-Task Dev Environment Bootstrap (tooling) has no entries in links.code
- `scripts-reorganization-by-feature-area` — Scripts Reorganization By Feature/Area (tooling) has no entries in links.code
- `trailer-scope-alias-map` — Trailer Scope-Alias Map (tooling) has no entries in links.code
