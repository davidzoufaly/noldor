<!-- generated: do-not-edit -->

# SDD Report

Generated: 2026-08-14 by `pnpm sdd:report`.

Pre-MVP done features (`introduced` < `0.2.0`) are
grandfathered from `links.spec` / `links.code` checks.
Bump `MIN_ENFORCED_VERSION` in `scripts/garden/sdd-report.ts` once backfill is done.

## Summary

- Total features: 76
- Untriaged ideas: 0
- Backlog entries: 19
- Gap categories with issues: 7 / 14

## Code clones

- 282 clone group(s), 12.26% duplicated tokens across 329 file(s)
- src/garden/garden-detect.ts:85-191 and src/garden/garden-detect.ts:194-300 (388 tokens)
- src/dashboard/views.ts:752-807 and src/dashboard/views.ts:830-934 (323 tokens)
- src/dashboard/data.ts:1137-1168 and src/garden/sdd-report.ts:964-999 (259 tokens)
- src/dashboard/views.ts:671-680 and src/dashboard/views.ts:939-948 (252 tokens)
- src/sync/sync-code-links.ts:13-59 and src/sync/sync-test-links.ts:8-56 (227 tokens)

## Gate compliance

### Tier distribution

- `full` (brainstorm + spec + plan): 37
- `specs-only` (no brainstorm): 39

### Override usage (last 30 days)

- `fac641f` — cr-red round 2, operator-approved — sole remaining blocker asks to restore two ideas.md bullets the operator deliberately dropped as shipped by PR #321; both mechanical findings from round 1 and the parent-link suggestion were applied.
- `93f1ba4` — cr-red after 10 code-CR rounds; operator-approved. Every finding was fixed and the verifier verified; the reviewer lane never returned fully clean, so no receipt was stamped. Open items in .noldor/cr/pr-summary-body-enforcement-escalation-context.md
- `aa0b7f7` — lessons-inbox append, no FD and no code — ideas.md prose only
- `aecbca4` — queue-document split prescribed by the drain's own Step 0 oversize guard; no FD, no code, roadmap prose only
- `b151dcd` — operator override after CR round 16 — sole med blocker fixed in this commit, residual suggestions filed to ideas.md
- `01c29d0` — fast-track — doc+counter state, zero code risk
- `1595710` — fast-track — doc+counter state, zero code risk

### Review-skip count (last 30 days)

Gated commits missing `Noldor-Reviewed` trailer: 64

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
      "blockers": 11,
      "suggestions": 43
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
    "shipped": 5,
    "skipped": 8,
    "retried": 0
  },
  "history": {
    "salvaged": 2,
    "escalatedTotal": 16,
    "escalatedBySlug": {
      "trailer-scope-alias-map": 2,
      "prefix-skills-with-noldor": 2,
      "framework-script-test-migration-cleanup": 3,
      "scope-sibling-trailer-for-doc-sync-commits": 1,
      "-": 2,
      "diff-scoped-clone-gate-flags-mere-adjacency": 2,
      "queue-drain-selection-and-staleness-guards": 1,
      "roadmap-has-block-predicate": 1,
      "spec-lint-prior-art-requirement": 1,
      "mandatory-codex-review-round": 1
    },
    "meanDurationMs": 999231
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
  "dashboard-merge-skills-into-framework": 49050,
  "docs-link-gate-is-red-and-blind-to-design-artifacts": 118206,
  "codex-lane-cannot-review-code": 60342,
  "cr-aggregate-reads-a-missing-sink-as-green": 83345,
  "diff-scoped-clone-gate-flags-mere-adjacency": 69208,
  "worktree-session-path-hazards": 49468,
  "clone-gate-reads-untracked-new-files-as-green": 52408,
  "dashboard-docs-flag-path-contract": 53635,
  "milestone-yaml-scalar-writer-emits-unreadable-frontmatter": 54796,
  "attach-retires-an-entry-id-and-leaves-dangling-refs": 262311,
  "doctor-ahead-anchor-dead-end": 64090,
  "clone-detector-flags-chained-builder-schemas": 64136
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

### Done features missing introduced

- `pr-summary-body-enforcement` — PR Summary Body Enforcement is phase=done but introduced is unset (release script should fill on next pnpm release)

### Stale backlog entries (>90 days)

- `Real-Codex Integration Smoke Test` — Real-Codex Integration Smoke Test (tooling) has been in backlog for 96 days since 2026-05-10

### Code files not referenced by any feature

- `src/core/atomic-write.ts` — src/core/atomic-write.ts is not referenced by any feature MD links.code — probable owner: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox
- `src/core/cli-entry.ts` — src/core/cli-entry.ts is not referenced by any feature MD links.code
- `src/core/commit-cli.ts` — src/core/commit-cli.ts is not referenced by any feature MD links.code
- `src/core/commit-wrapper.ts` — src/core/commit-wrapper.ts is not referenced by any feature MD links.code
- `src/core/design-artifact-names.ts` — src/core/design-artifact-names.ts is not referenced by any feature MD links.code — probable owner: outcome-telemetry-and-effectiveness-metrics, architecture-invariants, bootstrap-immunity-for-self-gating-features
- `src/core/fmt-guard-cli.ts` — src/core/fmt-guard-cli.ts is not referenced by any feature MD links.code
- `src/core/fmt-guard.ts` — src/core/fmt-guard.ts is not referenced by any feature MD links.code
- `src/core/framework-skew.ts` — src/core/framework-skew.ts is not referenced by any feature MD links.code — probable owner: version-aware-upgrade-and-migration-chain, acceptance-verify-lane, framework-pr-flow-agent-auto-merge
- `src/core/init-gitignore.ts` — src/core/init-gitignore.ts is not referenced by any feature MD links.code — probable owner: make-noldor-agent-agnostic, version-aware-upgrade-and-migration-chain
- `src/core/lanes.ts` — src/core/lanes.ts is not referenced by any feature MD links.code — probable owner: acceptance-verify-lane, specs-cr-gate-multi-reviewer, autonomous-plan-to-pr-merge
- `src/core/prerequisites.ts` — src/core/prerequisites.ts is not referenced by any feature MD links.code — probable owner: make-noldor-agent-agnostic
- `src/core/sha.ts` — src/core/sha.ts is not referenced by any feature MD links.code — probable owner: acceptance-verify-lane, specs-cr-gate-multi-reviewer
- `src/core/slug.ts` — src/core/slug.ts is not referenced by any feature MD links.code — probable owner: acceptance-verify-lane, specs-cr-gate-multi-reviewer
- `src/core/state-file.ts` — src/core/state-file.ts is not referenced by any feature MD links.code — probable owner: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox
- `src/core/summary-body-rollout.ts` — src/core/summary-body-rollout.ts is not referenced by any feature MD links.code — probable owner: version-aware-upgrade-and-migration-chain, acceptance-verify-lane, framework-pr-flow-agent-auto-merge
- `src/core/validate-summary-body.ts` — src/core/validate-summary-body.ts is not referenced by any feature MD links.code
- `src/hooks/validate-pushed-summaries.ts` — src/hooks/validate-pushed-summaries.ts is not referenced by any feature MD links.code — probable owner: version-aware-upgrade-and-migration-chain, acceptance-verify-lane, framework-pr-flow-agent-auto-merge
- `src/invariants/rule-pairs.ts` — src/invariants/rule-pairs.ts is not referenced by any feature MD links.code — probable owner: architecture-invariants
- `src/release/clean-tree.ts` — src/release/clean-tree.ts is not referenced by any feature MD links.code
- `src/release/preflight-fix.ts` — src/release/preflight-fix.ts is not referenced by any feature MD links.code
- `src/release/preflight-probes.ts` — src/release/preflight-probes.ts is not referenced by any feature MD links.code — probable owner: outcome-telemetry-and-effectiveness-metrics, noldor, framework-milestones-support-poc-mvp-100
- `src/release/preflight-render.ts` — src/release/preflight-render.ts is not referenced by any feature MD links.code
- `src/release/preflight-types.ts` — src/release/preflight-types.ts is not referenced by any feature MD links.code
- `src/release/preflight.ts` — src/release/preflight.ts is not referenced by any feature MD links.code — probable owner: noldor, release-script-self-provisions-its-own-session-marker
- `src/triage/retired-ids.ts` — src/triage/retired-ids.ts is not referenced by any feature MD links.code — probable owner: noldor, stable-entry-ids-for-roadmap-backlog, triage-scoring-rubric-effort-impact-confidence-dependency

### Tests with incomplete co-tag

- `src/design/__tests__/archive-resolve.test.ts` — imports files owned by FDs missing from @tests: tag — add: autonomous-plan-to-pr-merge, release-script-self-provisions-its-own-session-marker, release-sweep-process-hardening, rules-cascade-v1
- `src/core/__tests__/next-priority.test.ts` — imports files owned by FDs missing from @tests: tag — add: stable-entry-ids-for-roadmap-backlog
- `src/core/__tests__/repo-paths.test.ts` — imports files owned by FDs missing from @tests: tag — add: dynamic-fd-file-pointers-via-frontmatter
- `src/garden/__tests__/backlog-demote.test.ts` — imports files owned by FDs missing from @tests: tag — add: stable-entry-ids-for-roadmap-backlog
- `src/garden/__tests__/sdd-report.test.ts` — imports files owned by FDs missing from @tests: tag — add: stable-entry-ids-for-roadmap-backlog
- `src/cr/__tests__/bootstrap-immunity.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-bypass-retirement
- `src/dashboard/__tests__/dashboard-agents.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/milestones-view.test.ts` — imports files owned by FDs missing from @tests: tag — add: decouple-milestones-from-semver

### Done features without code

- `dashboard-blocked-by-graph-view` — Dashboard Blocked-By Graph View (tooling) has no entries in links.code
- `dashboard-broken-pages-audit` — Dashboard Broken-Pages Audit (tooling) has no entries in links.code
- `memory-intake-lessons-learned-pipeline` — Memory-Intake / Lessons-Learned Pipeline (tooling) has no entries in links.code
- `noldor-package-lift` — Noldor Package Lift (tooling) has no entries in links.code
- `pr-summary-body-enforcement` — PR Summary Body Enforcement (tooling) has no entries in links.code
- `readme-rewrite-consumer-journey-order` — README Rewrite — Consumer-Journey Order (tooling) has no entries in links.code
- `scripts-reorganization-by-feature-area` — Scripts Reorganization By Feature/Area (tooling) has no entries in links.code
- `self-boundaries-declaration-and-cycle-break` — Self-Boundaries Declaration and Cycle Break (tooling) has no entries in links.code
- `skill-vs-code-drift-detector` — Skill-vs-Code Drift Detector (tooling) has no entries in links.code
- `state-file-fail-open-hardening` — State-File Fail-Open Hardening (tooling) has no entries in links.code
- `trailer-scope-alias-map` — Trailer Scope-Alias Map (tooling) has no entries in links.code
- `vendored-systematic-debugging-discipline` — Vendored Systematic-Debugging Discipline (tooling) has no entries in links.code
