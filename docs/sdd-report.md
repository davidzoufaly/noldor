<!-- generated: do-not-edit -->

# SDD Report

Generated: 2026-08-20 by `pnpm sdd:report`.

Pre-MVP done features (`introduced` < `0.2.0`) are
grandfathered from `links.spec` / `links.code` checks.
Bump `MIN_ENFORCED_VERSION` in `scripts/garden/sdd-report.ts` once backfill is done.

## Summary

- Total features: 82
- Untriaged ideas: 5
- Backlog entries: 21
- Gap categories with issues: 8 / 15

## Code clones

- 271 clone group(s), 10.02% duplicated tokens across 361 file(s)
- src/dashboard/views.ts:818-873 and src/dashboard/views.ts:896-1000 (323 tokens)
- src/dashboard/views.ts:737-746 and src/dashboard/views.ts:1005-1014 (252 tokens)
- src/features/phase-flip-done-cli.ts:4-29 and src/features/phase-revert-cli.ts:4-29 (199 tokens)
- src/dashboard/views.ts:823-846 and src/dashboard/views.ts:949-972 and src/dashboard/views.ts:1043-1118 (176 tokens)
- src/dashboard/views.ts:826-846 and src/dashboard/views.ts:952-972 and src/dashboard/views.ts:1104-1125 (169 tokens)

## Gate compliance

### Tier distribution

- `full` (brainstorm + spec + plan): 39
- `specs-only` (no brainstorm): 43

### Override usage (last 30 days)

- `9461457` — CR round ran reviewer + verifier; verifier verdict pass (it stripped and re-added the entry to prove the offender count moves 2 -> 1), reviewer verdict approve with one med design blocker arguing the waiver treats the symptom rather than the allowlist gap. Operator accepted the blocker and filed it to ideas.md rather than widening this release into a gate refactor. No unaddressed correctness finding stands.
- `46994e9` — roadmap triage on main, no gate session — the entries
- `985dcb8` — queue-document triage with no gate session — parking two backlog entries touches only docs/backlog.md and the ID counter, the same shape as the preceding triage commit
- `fd2ce3b` — verify lane hit Q-0137 — reviewer approved, codex found no blocking issue, and the verifier's own payload reports "Verified feature at tip 421f7a6 ... exercised whole promised surface through real CLI", so the red is that lane's known serialization failure rather than a finding. Q-0137 documents this exact case: a green verification must never block a ship on a formatting failure.
- `5dba1c7` — code CR ran four rounds; every finding was applied. Rounds 1-2 caught real defects (no-sink error paths, a contradictory child payload parsing as a pass, mutate-then-timeout escaping the integrity check). Rounds 3-4 found only defects in the previous round's fixes, each smaller than the last, which is the self-feeding tail the round cap exists to stop. Round 4's remaining blockers are applied in this commit, so the tree carries no known unaddressed finding; the verifier lane returned pass. Operator accepted the red rather than dispatching a fifth round.
- `2221d4c` — codex code-lane red after 7 non-converging rounds; reviewer+verifier green on full range; operator escalate decision 2026-08-20
- `0be9ffe` — bookkeeping-only diff — framework runbooks, their templates twins and ideas.md, zero code. Same posture as the preceding triage commit: the verify lane fail-closes on a change with no behaviour to verify (Q-0137), so a code-stage round cannot go green on it.
- `04c9799` — bookkeeping-only diff — four queue documents and the ID counter, zero code. The verify lane fail-closes on a change with no behaviour to verify (Q-0137, filed in this very commit), so a review round could not go green on it.
- `5c35053` — code-stage CR ran 7 dispatches; verifier green on behaviour, reviewer findings since round 2 were documentation-consistency only, each fixed. Operator elected override rather than a further dispatch per prose fix.
- `5acbe68` — cr-red adjudicated — 2 design blockers accepted per spec Risks (operator override via cr escalate)
- `fac641f` — cr-red round 2, operator-approved — sole remaining blocker asks to restore two ideas.md bullets the operator deliberately dropped as shipped by PR #321; both mechanical findings from round 1 and the parent-link suggestion were applied.
- `93f1ba4` — cr-red after 10 code-CR rounds; operator-approved. Every finding was fixed and the verifier verified; the reviewer lane never returned fully clean, so no receipt was stamped. Open items in .noldor/cr/pr-summary-body-enforcement-escalation-context.md
- `aa0b7f7` — lessons-inbox append, no FD and no code — ideas.md prose only
- `aecbca4` — queue-document split prescribed by the drain's own Step 0 oversize guard; no FD, no code, roadmap prose only
- `b151dcd` — operator override after CR round 16 — sole med blocker fixed in this commit, residual suggestions filed to ideas.md
- `01c29d0` — fast-track — doc+counter state, zero code risk
- `1595710` — fast-track — doc+counter state, zero code risk

### Review-skip count (last 30 days)

Gated commits missing `Noldor-Reviewed` trailer: 90

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
    "noIntake": 30,
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
      "blockers": 12,
      "suggestions": 45
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
    "meanDurationMs": 979631
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

- `architecture-decision-record-surface` — Architecture Decision Record Surface is phase=done but introduced is unset (release script should fill on next pnpm release)
- `consumer-architecture-doc-surface` — Consumer Architecture Doc Surface is phase=done but introduced is unset (release script should fill on next pnpm release)
- `pendev-ui-design-phase` — pen.dev UI Design Phase is phase=done but introduced is unset (release script should fill on next pnpm release)
- `review-run-lifecycle-module` — Review-Run Lifecycle Module is phase=done but introduced is unset (release script should fill on next pnpm release)
- `root-readme-content-validator` — Root README Content Validator is phase=done but introduced is unset (release script should fill on next pnpm release)
- `ui-design-review-lane` — UI-Design Review Lane is phase=done but introduced is unset (release script should fill on next pnpm release)

### Untriaged ideas in ideas.md

- `ideas.md:62` — `/noldor-gate --drain <slug>` invoked \*\*by hand\*\* (no supervisor) carries no `--finish` signal, yet the drain-mode Step 1 override says to force-recreate `fast/<slug>` and delete it on the remote as "abandoned work safe to discard". On Q-0107 that branch held 7 commits with green tests from a prior child that never opened a PR — obeying the override literally would have destroyed finished work, unrecoverably on the remote side. The finish-vs-rebuild decision lives only in the supervisor (which knows whether the prior child exited 0), so an interactively-invoked drain has no way to know it. Gate should derive the branch state itself before destroying anything: `git log origin/main..fast/<slug>` non-empty + clean worktree ⇒ finish mode (deliver), empty or dirty ⇒ rebuild. (absorbed from a lesson, surfaced shipping Q-0107, PR #317)
- `ideas.md:63` — `cr autofix record --since` rejects a ref that `cr orchestrate --base-sha` accepts: `--since origin/main` exits 2 with `--since must be a hex sha (4-40 chars)`. The gate skill says to pass "the printed base-sha", so the asymmetry only bites a controller re-deriving the value — but then every caller needs `$(git rev-parse origin/main)` for one command and not the other. Accept any `git rev-parse`-able ref in `record` (resolve it, store the sha). (absorbed from a lesson, surfaced shipping Q-0107, PR #317)
- `ideas.md:64` — Gate Step 4's "wait for in-flight" `cr aggregate --slug <slug>` (no `--kind`) re-reds on a stale addressed spec sink: fix-and-proceed at the re-round cap leaves the artifact-stage sink red by design (no re-dispatch), so the kind-less aggregate exits 1 on findings already fixed in commits, and the controller has to recognise the staleness by hand and proceed on the Q-0069 precedent (code-stage green earns the receipt). Either kind-scope the wait step to running/standalone lanes, or have fix-and-proceed archive/annotate the sink it consciously leaves red. (absorbed from a lesson, surfaced shipping Q-0131 attach, PR #331)
- `ideas.md:65` — `autonomous` needs a `park` CLI to pair with `unpark`, plus an `operator-hold` EscalationReason. The park map is today the only working selection filter for a subset drain (recipe now in `docs/noldor/autonomy.md`), but it is a hand-edit of `.noldor/drain-park.json`, and borrowing `run-aborted` for a scope hold makes `autonomous inbox` read as repo-level failures for the whole batch. Either give park a CLI and the reason code, or implement the `--only <slug,…>` / `--size` flags Q-0121 already asks for and the hack goes away. (absorbed from a lesson, surfaced draining the 2026-08-13 S/med/fix batch, PRs #315-#319)
- `ideas.md:66` — `--iteration-timeout` should scale with `size:` the way routing already does — XS entries finish in ~15 min while S entries with real CR rounds want 45-60, so a batch of S entries on the 30-minute default systematically burns one retry each (Q-0107 was killed mid-CR with 4 commits and green tests already produced). Operator workaround documented in `docs/noldor/autonomy.md`; the fix is a size-aware cap. (absorbed from a lesson, surfaced draining the 2026-08-13 S/med/fix batch, PRs #315-#319)

### Stale backlog entries (>90 days)

- `Real-Codex Integration Smoke Test` — Real-Codex Integration Smoke Test (tooling) has been in backlog for 102 days since 2026-05-10

### Code files not referenced by any feature

- `src/checks/check-feature-slug-scope.ts` — src/checks/check-feature-slug-scope.ts is not referenced by any feature MD links.code
- `src/checks/check-lefthook-wiring.ts` — src/checks/check-lefthook-wiring.ts is not referenced by any feature MD links.code
- `src/core/cli-entry.ts` — src/core/cli-entry.ts is not referenced by any feature MD links.code — probable owner: architecture-decision-record-surface, pendev-ui-design-phase, de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/core/commit-cli.ts` — src/core/commit-cli.ts is not referenced by any feature MD links.code
- `src/core/commit-wrapper.ts` — src/core/commit-wrapper.ts is not referenced by any feature MD links.code
- `src/core/err-message.ts` — src/core/err-message.ts is not referenced by any feature MD links.code — probable owner: de-superpowers-vendor-spec-plan-and-worktree-flows, pendev-ui-design-phase, acceptance-verify-lane
- `src/core/extract-touches.ts` — src/core/extract-touches.ts is not referenced by any feature MD links.code — probable owner: framework-auto-split-suggestion-for-big-features-and-plans
- `src/core/fmt-guard-cli.ts` — src/core/fmt-guard-cli.ts is not referenced by any feature MD links.code
- `src/core/fmt-guard.ts` — src/core/fmt-guard.ts is not referenced by any feature MD links.code
- `src/core/framework-skew.ts` — src/core/framework-skew.ts is not referenced by any feature MD links.code
- `src/core/init-gitignore.ts` — src/core/init-gitignore.ts is not referenced by any feature MD links.code — probable owner: version-aware-upgrade-and-migration-chain, noldor, make-noldor-agent-agnostic
- `src/core/prerequisites.ts` — src/core/prerequisites.ts is not referenced by any feature MD links.code — probable owner: make-noldor-agent-agnostic, noldor
- `src/core/sha.ts` — src/core/sha.ts is not referenced by any feature MD links.code — probable owner: acceptance-verify-lane, specs-cr-gate-multi-reviewer
- `src/core/slug.ts` — src/core/slug.ts is not referenced by any feature MD links.code — probable owner: de-superpowers-vendor-spec-plan-and-worktree-flows, parallel-worktree-workflow, dashboard-worktree-health-page
- `src/core/state-file.ts` — src/core/state-file.ts is not referenced by any feature MD links.code — probable owner: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox
- `src/core/summary-body-contract.ts` — src/core/summary-body-contract.ts is not referenced by any feature MD links.code — probable owner: plan-runner, parallel-agent-dispatch-for-research-jobs, de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/core/summary-body-rollout.ts` — src/core/summary-body-rollout.ts is not referenced by any feature MD links.code
- `src/core/validate-summary-body.ts` — src/core/validate-summary-body.ts is not referenced by any feature MD links.code — probable owner: architecture-decision-record-surface, framework-pr-flow-agent-auto-merge
- `src/features/fill-links-code-gaps.ts` — src/features/fill-links-code-gaps.ts is not referenced by any feature MD links.code
- `src/fixtures/docs-check/target.ts` — src/fixtures/docs-check/target.ts is not referenced by any feature MD links.code
- `src/hooks/validate-pushed-summaries.ts` — src/hooks/validate-pushed-summaries.ts is not referenced by any feature MD links.code — probable owner: architecture-decision-record-surface, framework-pr-flow-agent-auto-merge
- `src/invariants/rule-pairs.ts` — src/invariants/rule-pairs.ts is not referenced by any feature MD links.code — probable owner: architecture-invariants
- `src/release/clean-tree.ts` — src/release/clean-tree.ts is not referenced by any feature MD links.code
- `src/release/preflight-fix.ts` — src/release/preflight-fix.ts is not referenced by any feature MD links.code
- `src/release/preflight-probes.ts` — src/release/preflight-probes.ts is not referenced by any feature MD links.code — probable owner: outcome-telemetry-and-effectiveness-metrics, noldor, framework-milestones-support-poc-mvp-100
- `src/release/preflight-render.ts` — src/release/preflight-render.ts is not referenced by any feature MD links.code — probable owner: noldor
- `src/release/preflight-types.ts` — src/release/preflight-types.ts is not referenced by any feature MD links.code — probable owner: noldor
- `src/release/preflight.ts` — src/release/preflight.ts is not referenced by any feature MD links.code — probable owner: noldor
- `src/release/release-commits.ts` — src/release/release-commits.ts is not referenced by any feature MD links.code — probable owner: dynamic-fd-changelog, noldor, framework-pr-flow-agent-auto-merge
- `src/sync/sync-spec-links.ts` — src/sync/sync-spec-links.ts is not referenced by any feature MD links.code
- `src/triage/has-block-cli.ts` — src/triage/has-block-cli.ts is not referenced by any feature MD links.code

### Tests with incomplete co-tag

- `src/metrics/__tests__/cr-and-override.test.ts` — imports files owned by FDs missing from @tests: tag — add: ui-design-review-lane
- `src/design/__tests__/archive-resolve.test.ts` — imports files owned by FDs missing from @tests: tag — add: autonomous-plan-to-pr-merge, de-superpowers-vendor-spec-plan-and-worktree-flows, pendev-ui-design-phase, release-script-self-provisions-its-own-session-marker, release-sweep-process-hardening, rules-cascade-v1
- `src/design/__tests__/ui-sync.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/migrations/__tests__/chain.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-script-test-migration-cleanup
- `src/migrations/__tests__/0.5.0.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-script-test-migration-cleanup, prefix-skills-with-noldor
- `src/migrations/__tests__/0.6.0.test.ts` — imports files owned by FDs missing from @tests: tag — add: prefix-skills-with-noldor
- `src/migrations/__tests__/0.7.0.test.ts` — imports files owned by FDs missing from @tests: tag — add: version-aware-upgrade-and-migration-chain
- `src/core/__tests__/feature-schema.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase
- `src/core/__tests__/review-profile.test.ts` — imports files owned by FDs missing from @tests: tag — add: code-reviewer-20
- `src/core/__tests__/feature-schema-since.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase
- `src/core/__tests__/consumer-config.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase
- `src/core/__tests__/branch-added.test.ts` — imports files owned by FDs missing from @tests: tag — add: rules-cascade-v1
- `src/core/__tests__/lanes.test.ts` — imports files owned by FDs missing from @tests: tag — add: ui-design-review-lane
- `src/core/__tests__/split-suggestion.test.ts` — imports files owned by FDs missing from @tests: tag — add: dashboard-roadmap-drag-drop, replace-roadmap-buckets-with-flat-priority-order, roadmap-priority-ordering
- `src/core/__tests__/framework-version.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase
- `src/core/__tests__/release-markers.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-script-test-migration-cleanup
- `src/core/__tests__/repo-paths.test.ts` — imports files owned by FDs missing from @tests: tag — add: code-clone-detector, dynamic-fd-file-pointers-via-frontmatter, feature-md-links-overhaul
- `src/core/__tests__/consumer-config-boundaries.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, pendev-ui-design-phase, version-aware-upgrade-and-migration-chain
- `src/core/__tests__/atomic-write.test.ts` — imports files owned by FDs missing from @tests: tag — add: dashboard-roadmap-drag-drop
- `src/core/__tests__/session.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase, rules-cascade-v1
- `src/core/__tests__/allowlist.test.ts` — imports files owned by FDs missing from @tests: tag — add: prefix-skills-with-noldor
- `src/core/__tests__/pr-flow-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor, pendev-ui-design-phase, rules-cascade-v1
- `src/core/__tests__/config.test.ts` — imports files owned by FDs missing from @tests: tag — add: code-clone-detector, code-reviewer-20, registry-distribution-for-the-noldor-package, release-bypass-retirement, ui-design-review-lane
- `src/core/__tests__/doc-roots.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-script-test-migration-cleanup, pendev-ui-design-phase
- `src/core/rules/__tests__/session-injected.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase, rules-cascade-v1
- `src/core/agent-runner/__tests__/types.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, ui-design-review-lane
- `src/core/agent-runner/__tests__/bounded-capture.test.ts` — imports files owned by FDs missing from @tests: tag — add: make-noldor-agent-agnostic
- `src/core/agent-runner/__tests__/registry-logsink.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, drain-startup-reconciliation-of-a-prior-dead-run, make-noldor-agent-agnostic
- `src/core/agent-runner/__tests__/doctor-runners.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, ui-design-review-lane
- `src/core/agent-runner/__tests__/registry.test.ts` — imports files owned by FDs missing from @tests: tag — add: ui-design-review-lane
- `src/garden/__tests__/garden-receipt.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-bypass-retirement
- `src/garden/__tests__/garden-detect.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase, release-bypass-retirement
- `src/garden/__tests__/graph-fd-lookup.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase, sdd-detector-5-idea-merge-semantic-similarity
- `src/garden/__tests__/sdd-report.test.ts` — imports files owned by FDs missing from @tests: tag — add: code-clone-detector, framework-script-test-migration-cleanup, pendev-ui-design-phase, release-bypass-retirement, sdd-detector-5-idea-merge-semantic-similarity
- `src/garden/__tests__/malformed-fd.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/skill-code-drift.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/override-audit.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-bypass-retirement
- `src/garden/detectors/__tests__/adr.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/fd-command-rot.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/fd-link-rot.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/architecture.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/circular-blocked-by.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/cr/__tests__/autofix-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, ui-design-review-lane
- `src/cr/__tests__/overwrite-guard.test.ts` — imports files owned by FDs missing from @tests: tag — add: ui-design-review-lane
- `src/cr/__tests__/orchestrate.integration.test.ts` — imports files owned by FDs missing from @tests: tag — add: ui-design-review-lane
- `src/cr/__tests__/filename.test.ts` — imports files owned by FDs missing from @tests: tag — add: ui-design-review-lane
- `src/cr/__tests__/autofix-ledger.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, ui-design-review-lane
- `src/cr/__tests__/bootstrap-immunity.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-bypass-retirement
- `src/cr/__tests__/autofix.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/delta.test.ts` — imports files owned by FDs missing from @tests: tag — add: ui-design-review-lane
- `src/cr/__tests__/run-codex.test.ts` — imports files owned by FDs missing from @tests: tag — add: specs-cr-gate-multi-reviewer
- `src/cr/__tests__/codex-failure.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/findings-schema.test.ts` — imports files owned by FDs missing from @tests: tag — add: ui-design-review-lane
- `src/cr/__tests__/orchestrate.test.ts` — imports files owned by FDs missing from @tests: tag — add: ui-design-review-lane
- `src/cr/__tests__/finding-class.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/prior-review.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, autonomous-plan-to-pr-merge, rules-cascade-v1, ui-design-review-lane
- `src/cr/__tests__/codex.test.ts` — imports files owned by FDs missing from @tests: tag — add: ui-design-review-lane
- `src/cr/__tests__/lanes/subagent-dispatch.test.ts` — imports files owned by FDs missing from @tests: tag — add: code-clone-detector, code-reviewer-20, continuous-drain-daemon-and-escalation-inbox, registry-distribution-for-the-noldor-package, release-bypass-retirement, ui-design-review-lane
- `src/cr/__tests__/lanes/ui-review.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, specs-cr-gate-multi-reviewer
- `src/cr/__tests__/lanes/verify-dispatch.test.ts` — imports files owned by FDs missing from @tests: tag — add: code-clone-detector, code-reviewer-20, continuous-drain-daemon-and-escalation-inbox, registry-distribution-for-the-noldor-package, release-bypass-retirement, specs-cr-gate-multi-reviewer, ui-design-review-lane
- `src/cr/__tests__/lanes/subagent.test.ts` — imports files owned by FDs missing from @tests: tag — add: rules-cascade-v1
- `src/cr/__tests__/lanes/ui-review-dispatch.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/lanes/codex.test.ts` — imports files owned by FDs missing from @tests: tag — add: code-clone-detector, code-reviewer-20, continuous-drain-daemon-and-escalation-inbox, registry-distribution-for-the-noldor-package, release-bypass-retirement, ui-design-review-lane
- `src/features/__tests__/feature-milestone.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase
- `src/features/__tests__/validate-features.test.ts` — imports files owned by FDs missing from @tests: tag — add: bootstrap-immunity-for-self-gating-features, pendev-ui-design-phase
- `src/features/__tests__/fill-links-code-gaps.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase
- `src/invariants/__tests__/rule-conflicts.test.ts` — imports files owned by FDs missing from @tests: tag — add: architecture-invariants
- `src/invariants/__tests__/boundaries.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, architecture-invariants, pendev-ui-design-phase, version-aware-upgrade-and-migration-chain
- `src/release/__tests__/release-session.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor, pendev-ui-design-phase, rules-cascade-v1
- `src/release/__tests__/release-cr-gate-e2e.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-bypass-retirement
- `src/release/__tests__/preflight-probes.test.ts` — imports files owned by FDs missing from @tests: tag — add: autonomous-plan-to-pr-merge, outcome-telemetry-and-effectiveness-metrics, pendev-ui-design-phase, pnpm-release-resume, release-bypass-retirement, release-script-self-provisions-its-own-session-marker, rules-cascade-v1
- `src/release/__tests__/release-cr-gate.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-bypass-retirement
- `src/release/__tests__/release-config-flow.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase
- `src/release/__tests__/release-resume.test.ts` — imports files owned by FDs missing from @tests: tag — add: dynamic-fd-changelog, framework-pr-flow-agent-auto-merge, registry-distribution-for-the-noldor-package, release-bypass-retirement, release-script-sddreport-skip-if-only-count-line-changed, release-script-self-provisions-its-own-session-marker, release-sweep-process-hardening
- `src/release/__tests__/preflight-render.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-script-sddreport-skip-if-only-count-line-changed
- `src/release/__tests__/preflight.test.ts` — imports files owned by FDs missing from @tests: tag — add: autonomous-plan-to-pr-merge, outcome-telemetry-and-effectiveness-metrics, pendev-ui-design-phase, pnpm-release-resume, release-bypass-retirement, release-script-self-provisions-its-own-session-marker, rules-cascade-v1
- `src/triage/__tests__/remove-block-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/triage/__tests__/triage-list-untriaged.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-script-test-migration-cleanup
- `src/cli/__tests__/validate-script-catalog.test.ts` — imports files owned by FDs missing from @tests: tag — add: autonomous-queue-drain-runner, bootstrap-immunity-for-self-gating-features, code-clone-detector, continuous-drain-daemon-and-escalation-inbox, framework-auto-split-suggestion-for-big-features-and-plans, graphify-plan-of-edges-nodes-for-plans-specs, outcome-telemetry-and-effectiveness-metrics, parallel-agent-dispatch-for-research-jobs, plan-runner, pnpm-release-resume, registry-distribution-for-the-noldor-package, sdd-detector-5-idea-merge-semantic-similarity, version-aware-upgrade-and-migration-chain
- `src/dashboard/__tests__/route-sweep.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, consumer-architecture-doc-surface, dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics, project-tracking-dashboard
- `src/dashboard/__tests__/dashboard-status.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/dashboard-layout-style-polish.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/dashboard-views.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/dashboard-worktrees.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/host.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/dashboard-agents.test.ts` — imports files owned by FDs missing from @tests: tag — add: dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, dynamic-fd-changelog, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics, project-tracking-dashboard, replace-roadmap-buckets-with-flat-priority-order, roadmap-priority-ordering
- `src/dashboard/__tests__/dashboard-mermaid.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/dashboard-test-pyramid.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/dashboard-ensure.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/milestones-view.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, decouple-milestones-from-semver
- `src/dashboard/__tests__/dashboard-skills.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/dashboard-repo-brand.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/metrics-view.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/dashboard-graph-health.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/dashboard-release-notes.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/dashboard-render-markdown.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/dashboard-layout-body-styles.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/dashboard-server.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/server-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dynamic-fd-changelog, replace-roadmap-buckets-with-flat-priority-order, roadmap-priority-ordering
- `src/dashboard/__tests__/dashboard-doc-surfaces.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/blocked-by.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, dynamic-fd-changelog, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics, project-tracking-dashboard, replace-roadmap-buckets-with-flat-priority-order, roadmap-priority-ordering
- `src/dashboard/__tests__/dashboard-data.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, code-clone-detector, scan-roots-repo-paths-provider
- `src/dashboard/__tests__/dashboard-identity.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/testing/__tests__/consumer-fixture.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, pendev-ui-design-phase
- `src/testing/__tests__/drain-e2e.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase, rules-cascade-v1
- `src/testing/__tests__/stub-runner.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, ui-design-review-lane
- `src/hooks/__tests__/noldor-validate-trailer.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-doc-extraction
- `src/templates/__tests__/templates.test.ts` — imports files owned by FDs missing from @tests: tag — add: make-noldor-agent-agnostic, noldor
- `src/autonomous/__tests__/drain-reconcile.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/autonomous/__tests__/build-pool.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/autonomous/__tests__/phase-events.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, autonomous-queue-drain-runner, consumer-contract-ci-and-headless-gate-e2e-harness, drain-startup-reconciliation-of-a-prior-dead-run, parallel-drain
- `src/autonomous/__tests__/salvage.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/autonomous/__tests__/decide-next.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/autonomous/__tests__/status-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness, drain-startup-reconciliation-of-a-prior-dead-run, parallel-drain
- `src/autonomous/__tests__/drain-selection.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, agent-events-phase-tracking-run-ids-and-agents-dashboard-page, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox, drain-startup-reconciliation-of-a-prior-dead-run, parallel-drain, plan-runner
- `src/autonomous/__tests__/resolve-roadmap-conflict.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/autonomous/__tests__/watch-state.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/autonomous/__tests__/watch-args.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/autonomous/__tests__/branch-work.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, agent-events-phase-tracking-run-ids-and-agents-dashboard-page, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox, drain-startup-reconciliation-of-a-prior-dead-run, make-noldor-agent-agnostic, parallel-drain, parallel-drain-roadmapmd-conflict-auto-resolution, plan-runner
- `src/autonomous/__tests__/queue-drain-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/autonomous/__tests__/gate-prompt.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness, prefix-skills-with-noldor
- `src/autonomous/__tests__/merge-classify.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/autonomous/__tests__/merge-coordinator.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/sync/__tests__/sync-code-links.test.ts` — imports files owned by FDs missing from @tests: tag — add: feature-md-links-overhaul
- `src/sync/__tests__/sync-fd-resources.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase
- `src/sync/__tests__/sync-doc-links.test.ts` — imports files owned by FDs missing from @tests: tag — add: feature-md-links-overhaul

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
