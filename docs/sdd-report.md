<!-- generated: do-not-edit -->

# SDD Report

Generated: 2026-07-02 by `pnpm sdd:report`.

Pre-MVP done features (`introduced` < `0.2.0`) are
grandfathered from `links.spec` / `links.code` checks.
Bump `MIN_ENFORCED_VERSION` in `scripts/garden/sdd-report.ts` once backfill is done.

## Summary

- Total features: 51
- Untriaged ideas: 0
- Backlog entries: 4
- Gap categories with issues: 7 / 14

## Metrics

### cycle-time [days]

```json
{
  "medianDays": 20.6,
  "p90Days": 52.6,
  "medianByPath": {
    "unknown": 45.6,
    "full-new": 20.6,
    "specs-only-new": 25.8
  },
  "excluded": {
    "noIntake": 19,
    "noTag": 14
  }
}
```

formula: days(intake → release): intake = FD frontmatter `since` else roadmap-history recovery; release = creator date of tag v<introduced>. Median + p90 over FDs with both endpoints.
blind spots: FDs with unrecoverable intake or an introduced version without a matching v-tag are excluded (see excluded tally). | Provenance segmentation approximates: autonomous = any agent-event for the slug; pre-event-log autonomous ships read as operator/unknown. | Pre-Noldor-Path commits make path segmentation read `unknown`.

### routing-accuracy [entries]

```json
{
  "table": {
    "full-new": {
      "full-new": 1
    },
    "full-attach": {
      "full-new": 2
    },
    "specs-only-attach": {
      "full-new": 1
    }
  },
  "matches": 1,
  "total": 4,
  "excluded": 6,
  "window": 10
}
```

formula: sizeToPath(intake.size, intake.parent != null) vs first Noldor-Path trailer of the FD's commits, over the last 10 shipped FDs (by release-tag date).
blind spots: Entries whose roadmap size/parent could not be recovered from history, or whose commits predate the Noldor-Path trailer, are excluded (see excluded count). | First-trailer-wins: a feature shipped across mixed paths is judged by its first commit path.

### cr-effectiveness [findings / corrective commits]

```json
{
  "perLane": {},
  "correctiveBySlug": {},
  "windowDays": 14
}
```

formula: Per-lane blockers+suggestions from .noldor/cr LaneFindings vs fix:/revert: commits carrying the same Noldor-FD within 14 days after the FD's release-tag date.
blind spots: Approximation: a corrective commit is attributed by trailer + subject prefix; refactors that silently fix, or fixes without the FD trailer, are invisible. | CR sinks are operator-local and pruned/archived — historical lanes may be missing entirely.

### drain-reliability [runs / events]

```json
{
  "lastRun": null,
  "history": null
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
- `decouple-milestones-from-semver` — Decouple Milestones from Semver (tooling) has no tests in links.tests
- `framework-doc-extraction` — Framework Doc Extraction (tooling) has no tests in links.tests
- `per-task-dev-environment-bootstrap` — Per-Task Dev Environment Bootstrap (tooling) has no tests in links.tests
- `trailer-scope-alias-map` — Trailer Scope-Alias Map (tooling) has no tests in links.tests

### Done features without docs

- `continuous-drain-daemon-and-escalation-inbox` — Continuous Drain Daemon and Escalation Inbox (tooling) has no entries in links.docs
- `make-noldor-agent-agnostic` — Make Noldor Agent-Agnostic (tooling) has no entries in links.docs

### Done features missing introduced

- `parallel-agent-dispatch-for-research-jobs` — Parallel-Agent Dispatch for Research Jobs is phase=done but introduced is unset (release script should fill on next pnpm release)

### Plans without matching spec

- `docs/superpowers/plans/2026-06-07-end-of-flow-ergonomics.md` — docs/superpowers/plans/2026-06-07-end-of-flow-ergonomics.md has slug "end-of-flow-ergonomics" with no matching spec under docs/superpowers/specs/

### Code files not referenced by any feature

- `src/checks/check-template-sync.ts` — src/checks/check-template-sync.ts is not referenced by any feature MD links.code — probable owner: make-noldor-agent-agnostic, version-aware-upgrade-and-migration-chain, acceptance-verify-lane
- `src/cli/commands/upgrade.ts` — src/cli/commands/upgrade.ts is not referenced by any feature MD links.code — probable owner: version-aware-upgrade-and-migration-chain, dynamic-fd-changelog, howto-index-pipeline
- `src/cli/help.ts` — src/cli/help.ts is not referenced by any feature MD links.code — probable owner: autonomous-queue-drain-runner, bootstrap-immunity-for-self-gating-features, continuous-drain-daemon-and-escalation-inbox
- `src/cli/index.ts` — src/cli/index.ts is not referenced by any feature MD links.code — probable owner: autonomous-queue-drain-runner, bootstrap-immunity-for-self-gating-features, continuous-drain-daemon-and-escalation-inbox
- `src/core/bump-session-marker.ts` — src/core/bump-session-marker.ts is not referenced by any feature MD links.code
- `src/core/doc-roots.ts` — src/core/doc-roots.ts is not referenced by any feature MD links.code — probable owner: outcome-telemetry-and-effectiveness-metrics, autonomous-queue-drain-runner, gate-flow-rework
- `src/core/extract-touches.ts` — src/core/extract-touches.ts is not referenced by any feature MD links.code — probable owner: plan-runner, dashboard-roadmap-backlog-polish, de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/core/noldor-cli.ts` — src/core/noldor-cli.ts is not referenced by any feature MD links.code — probable owner: outcome-telemetry-and-effectiveness-metrics, framework-milestones-support-poc-mvp-100
- `src/core/overrides-log.ts` — src/core/overrides-log.ts is not referenced by any feature MD links.code
- `src/core/phase-flip-done.ts` — src/core/phase-flip-done.ts is not referenced by any feature MD links.code
- `src/core/rollout-marker.ts` — src/core/rollout-marker.ts is not referenced by any feature MD links.code — probable owner: outcome-telemetry-and-effectiveness-metrics, noldor, release-sweep-process-hardening
- `src/core/rules/stage.ts` — src/core/rules/stage.ts is not referenced by any feature MD links.code
- `src/core/size-routing.ts` — src/core/size-routing.ts is not referenced by any feature MD links.code — probable owner: plan-runner, dashboard-roadmap-backlog-polish, de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/core/trailers.ts` — src/core/trailers.ts is not referenced by any feature MD links.code — probable owner: outcome-telemetry-and-effectiveness-metrics, noldor, release-sweep-process-hardening
- `src/features/migrate-link-rot.ts` — src/features/migrate-link-rot.ts is not referenced by any feature MD links.code
- `src/features/phase-flip-done-cli.ts` — src/features/phase-flip-done-cli.ts is not referenced by any feature MD links.code
- `src/features/phase-revert-cli.ts` — src/features/phase-revert-cli.ts is not referenced by any feature MD links.code
- `src/graphify/graph-to-toon.ts` — src/graphify/graph-to-toon.ts is not referenced by any feature MD links.code
- `src/hooks/agent-rules-guard.ts` — src/hooks/agent-rules-guard.ts is not referenced by any feature MD links.code
- `src/hooks/noldor-pre-edit-guard.ts` — src/hooks/noldor-pre-edit-guard.ts is not referenced by any feature MD links.code — probable owner: outcome-telemetry-and-effectiveness-metrics, noldor, release-sweep-process-hardening
- `src/hooks/noldor-validate-trailer.ts` — src/hooks/noldor-validate-trailer.ts is not referenced by any feature MD links.code — probable owner: outcome-telemetry-and-effectiveness-metrics, noldor, release-sweep-process-hardening
- `src/index.ts` — src/index.ts is not referenced by any feature MD links.code
- `src/milestones/cli.ts` — src/milestones/cli.ts is not referenced by any feature MD links.code — probable owner: outcome-telemetry-and-effectiveness-metrics, framework-milestones-support-poc-mvp-100
- `src/milestones/lib.ts` — src/milestones/lib.ts is not referenced by any feature MD links.code — probable owner: outcome-telemetry-and-effectiveness-metrics, framework-milestones-support-poc-mvp-100
- `src/milestones/validate-milestones.ts` — src/milestones/validate-milestones.ts is not referenced by any feature MD links.code — probable owner: outcome-telemetry-and-effectiveness-metrics, framework-milestones-support-poc-mvp-100
- `src/prep/formats.ts` — src/prep/formats.ts is not referenced by any feature MD links.code — probable owner: plan-runner, dashboard-roadmap-backlog-polish, de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/prep/print-format.ts` — src/prep/print-format.ts is not referenced by any feature MD links.code — probable owner: plan-runner, dashboard-roadmap-backlog-polish, de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/prep/types.ts` — src/prep/types.ts is not referenced by any feature MD links.code — probable owner: plan-runner, dashboard-roadmap-backlog-polish, de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/release/auto-restamp.ts` — src/release/auto-restamp.ts is not referenced by any feature MD links.code — probable owner: outcome-telemetry-and-effectiveness-metrics
- `src/release/graph-freshness.ts` — src/release/graph-freshness.ts is not referenced by any feature MD links.code
- `src/release/release-packages.ts` — src/release/release-packages.ts is not referenced by any feature MD links.code — probable owner: version-aware-upgrade-and-migration-chain, dynamic-fd-changelog, howto-index-pipeline
- `src/release/release-session.ts` — src/release/release-session.ts is not referenced by any feature MD links.code — probable owner: autonomous-plan-to-pr-merge, framework-pr-flow-agent-auto-merge, parallel-drain
- `src/release/release-version.ts` — src/release/release-version.ts is not referenced by any feature MD links.code — probable owner: dynamic-fd-changelog, framework-pr-flow-agent-auto-merge, noldor
- `src/rules/cli-cores.ts` — src/rules/cli-cores.ts is not referenced by any feature MD links.code
- `src/rules/cli-list.ts` — src/rules/cli-list.ts is not referenced by any feature MD links.code
- `src/rules/cli-resolve.ts` — src/rules/cli-resolve.ts is not referenced by any feature MD links.code
- `src/rules/cli-validate.ts` — src/rules/cli-validate.ts is not referenced by any feature MD links.code
- `src/rules/index-cache.ts` — src/rules/index-cache.ts is not referenced by any feature MD links.code
- `src/rules/load.ts` — src/rules/load.ts is not referenced by any feature MD links.code
- `src/rules/resolve.ts` — src/rules/resolve.ts is not referenced by any feature MD links.code
- `src/rules/types.ts` — src/rules/types.ts is not referenced by any feature MD links.code
- `src/templates/copy.ts` — src/templates/copy.ts is not referenced by any feature MD links.code — probable owner: make-noldor-agent-agnostic, version-aware-upgrade-and-migration-chain, acceptance-verify-lane
- `src/templates/diff.ts` — src/templates/diff.ts is not referenced by any feature MD links.code — probable owner: make-noldor-agent-agnostic, version-aware-upgrade-and-migration-chain, acceptance-verify-lane
- `src/templates/manifest.ts` — src/templates/manifest.ts is not referenced by any feature MD links.code — probable owner: make-noldor-agent-agnostic, version-aware-upgrade-and-migration-chain, acceptance-verify-lane
- `src/testing/contract-harness.ts` — src/testing/contract-harness.ts is not referenced by any feature MD links.code — probable owner: make-noldor-agent-agnostic, version-aware-upgrade-and-migration-chain, acceptance-verify-lane
- `src/testing/stub-gate.ts` — src/testing/stub-gate.ts is not referenced by any feature MD links.code — probable owner: make-noldor-agent-agnostic, version-aware-upgrade-and-migration-chain, acceptance-verify-lane
- `src/triage/remove-block-cli.ts` — src/triage/remove-block-cli.ts is not referenced by any feature MD links.code
- `src/verify/health.ts` — src/verify/health.ts is not referenced by any feature MD links.code
- `src/verify/port.ts` — src/verify/port.ts is not referenced by any feature MD links.code
- `src/verify/smoke-cli.ts` — src/verify/smoke-cli.ts is not referenced by any feature MD links.code
- `src/verify/smoke.ts` — src/verify/smoke.ts is not referenced by any feature MD links.code

### Test files without @tests: tag

- `src/checks/__tests__/check-template-sync.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/core/__tests__/concurrency.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/core/__tests__/doc-roots.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/core/__tests__/git-porcelain.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/core/__tests__/rollout-marker.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/core/__tests__/size-routing.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/core/__tests__/trailers.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/core/rules/__tests__/stage.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/cr/__tests__/aggregate.cli.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/dashboard/__tests__/server-static.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/hooks/__tests__/agent-rules-guard.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/hooks/__tests__/noldor-pre-edit-guard.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/milestones/__tests__/lib.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/milestones/__tests__/validate-milestones.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/prep/__tests__/print-format.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/release/__tests__/auto-restamp.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/release/__tests__/graph-freshness.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/release/__tests__/release-packages.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/release/__tests__/release-version.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/research/__tests__/fanout.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/research/__tests__/prompt.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/research/__tests__/staging.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/research/__tests__/types.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/rules/__tests__/cli.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/rules/__tests__/index-cache.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/rules/__tests__/load.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/rules/__tests__/resolve.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/rules/__tests__/types.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/verify/__tests__/health.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)

### Done features without code

- `code-reviewer-20` — Code Reviewer 2.0 (tooling) has no entries in links.code
- `decouple-milestones-from-semver` — Decouple Milestones from Semver (tooling) has no entries in links.code
- `framework-doc-extraction` — Framework Doc Extraction (tooling) has no entries in links.code
- `noldor-package-lift` — Noldor Package Lift (tooling) has no entries in links.code
- `per-task-dev-environment-bootstrap` — Per-Task Dev Environment Bootstrap (tooling) has no entries in links.code
- `scripts-reorganization-by-feature-area` — Scripts Reorganization By Feature/Area (tooling) has no entries in links.code
- `trailer-scope-alias-map` — Trailer Scope-Alias Map (tooling) has no entries in links.code
