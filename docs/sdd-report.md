<!-- generated: do-not-edit -->

# SDD Report

Generated: 2026-09-02 by `pnpm sdd:report`.

Pre-MVP done features (`introduced` < `0.2.0`) are
grandfathered from `links.spec` / `links.code` checks.
Bump `MIN_ENFORCED_VERSION` in `scripts/garden/sdd-report.ts` once backfill is done.

## Summary

- Total features: 85
- Untriaged ideas: 0
- Backlog entries: 27
- Gap categories with issues: 4 / 15

## Code clones

- 291 clone group(s), 9.09% duplicated tokens across 409 file(s)
- src/dashboard/views.ts:818-873 and src/dashboard/views.ts:896-1000 (323 tokens)
- src/features/phase-flip-done-cli.ts:4-45 and src/features/phase-revert-cli.ts:4-45 (277 tokens)
- src/dashboard/views.ts:737-746 and src/dashboard/views.ts:1005-1014 (252 tokens)
- src/dashboard/views.ts:823-846 and src/dashboard/views.ts:949-972 and src/dashboard/views.ts:1043-1118 (176 tokens)
- src/features/validate-features.ts:187-223 and src/features/validate-features.ts:344-380 (171 tokens)

## Gate compliance

### Tier distribution

- `full` (brainstorm + spec + plan): 40
- `specs-only` (no brainstorm): 45

### Override usage (last 30 days)

- `86ed29a` — operator-waived review receipt at the CR re-round cap after 3 rounds and 23 fixed findings; all mechanical gates green
- `c601952` — reviewer approve + codex clean at round 7; verify lane red is infra-only (own transcript reports success, then a dispatch timeout) — receipt could not be amended on a red aggregate
- `4d506ad` — eight code-stage CR rounds without convergence; remaining findings carved to Q-0197; mechanical gates green at this tip
- `f311816` — code-stage CR closed after 7 rounds — verifier green throughout, reviewer approve at round 5, rounds 5-7 self-fed on symlink hardening of an advisory heuristic; all findings reproduced and fixed, sinks in .noldor/cr
- `366cb50` — cr-non-convergence after 8 rounds; rounds 7/8 mutually contradictory on skipIf(root) and the chmod fixture; all security findings through round 7 fixed and probe-verified; residue recorded in the FD Changelog
- `5a1b323` — review-loop-converged-on-prose
- `58e9539` — micro-chore lane omits `.noldor/config.json`, and the CR-gate exemption this release needs can only live there. Diff is README + ideas + one config entry; zero source files.
- `57134eb` — micro-chore lane rejects `.noldor/id-counter.json` — `MICRO_CHORE_GLOBS` omits the counter that `triage mint-id` bumps, so the framework bookkeeping this commit carries cannot land through its own lane (precedent: #346, #335). Diff is docs + queue bookkeeping only, zero source files.
- `c488b25` — code CR arbitrated after 12 rounds — verifier green, all 12 reviewer findings fixed (final one in this commit), codex mandate ran 12x with ~17 findings fixed and its last 3 blockers oscillating against its own round-4 demands; full sink record in .noldor/cr and rationale at each noldor:cut site
- `51ac63d` — codex-tail-at-cap — reviewer and verifier lanes green on rounds 1+2; codex regenerated finer-grain findings each round (legit subset applied, remainder declined with rationale in session); operator-approved override
- `fd05534` — eight CR rounds, never green; rounds 5-8 only found defects in prior rounds fixes, past the documented 2-re-round cap. Operator accepted at the cap.
- `6549d4e` — five code-stage CR rounds; the residual build-lock window is irreducible on POSIX (no conditional unlink) and is declared in code with a noldor:cut plus its upgrade path. The concurrency path is evidenced by a four-builder stress run (one build, three refusals) rather than by reviewer assent. Every other gate is green: 4157 tests under NOLDOR\_RUNTIME unset/dist/source, contract fixture, template-sync, clones, summary-body.
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

### Review-skip count (last 30 days)

Gated commits missing `Noldor-Reviewed` trailer: 138

## Metrics

### cycle-time [days]

```json
{
  "medianDays": 20.6,
  "p90Days": 56.5,
  "medianByPath": {
    "unknown": 10.2,
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
      "blockers": 16,
      "suggestions": 58
    },
    "verifier": {
      "blockers": 1,
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
    "shipped": 4,
    "skipped": 12,
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
    "meanDurationMs": 846103
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
  "clone-detector-flags-chained-builder-schemas": 64136,
  "fd-command-rot-needs-an-ignore-marker": 102520,
  "architecture-module-advisory-fires-on-generated-trees": 50209,
  "kind-less-cr-aggregate-re-reds-on-a-stale-addressed-spec-sink": 81078,
  "size-aware-iteration-timeout-for-the-drain-runner": 21561
}
```

formula: Sum of agent-event tokens.total per slug. Tokens are read verbatim from runner usage records (claude-jsonl / codex-session / opencode-session); events without trustworthy usage carry no tokens.
blind spots: null = no usage data, not zero usage: operator-driven interactive sessions and runners without locatable usage records are invisible. | Only spawn-captured agents count; epoch-limited to when token capture shipped.

## Gap details

### Done features missing introduced

- `abstraction-cost-ratchet` — Abstraction-Cost Ratchet is phase=done but introduced is unset (release script should fill on next pnpm release)
- `auto-open-design-artifacts` — Auto-Open Design Artifacts is phase=done but introduced is unset (release script should fill on next pnpm release)

### Stale backlog entries (>90 days)

- `Real-Codex Integration Smoke Test` — Real-Codex Integration Smoke Test (tooling) has been in backlog for 115 days since 2026-05-10

### Code files not referenced by any feature

- `src/checks/check-install-freshness.ts` — src/checks/check-install-freshness.ts is not referenced by any feature MD links.code — probable owner: make-noldor-agent-agnostic, noldor
- `src/checks/check-push-gates.ts` — src/checks/check-push-gates.ts is not referenced by any feature MD links.code
- `src/core/blob-id.ts` — src/core/blob-id.ts is not referenced by any feature MD links.code — probable owner: ui-design-review-lane, acceptance-verify-lane, de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/core/receipt-store.ts` — src/core/receipt-store.ts is not referenced by any feature MD links.code — probable owner: de-superpowers-vendor-spec-plan-and-worktree-flows, pendev-ui-design-phase
- `src/core/structural-context-contract.ts` — src/core/structural-context-contract.ts is not referenced by any feature MD links.code — probable owner: outcome-telemetry-and-effectiveness-metrics, consumer-architecture-doc-surface, graphify-plan-of-edges-nodes-for-plans-specs
- `src/graphify/enrich-doc-nodes.ts` — src/graphify/enrich-doc-nodes.ts is not referenced by any feature MD links.code
- `src/utils/word-count.ts` — src/utils/word-count.ts is not referenced by any feature MD links.code — probable owner: framework-auto-split-suggestion-for-big-features-and-plans

### Tests with incomplete co-tag

- `src/metrics/__tests__/cr-and-override.test.ts` — imports files owned by FDs missing from @tests: tag — add: ui-design-review-lane
- `src/design/__tests__/ui-capture.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/design/__tests__/archive-resolve.test.ts` — imports files owned by FDs missing from @tests: tag — add: autonomous-plan-to-pr-merge, de-superpowers-vendor-spec-plan-and-worktree-flows, pendev-ui-design-phase, release-script-self-provisions-its-own-session-marker, release-sweep-process-hardening, rules-cascade-v1
- `src/design/__tests__/ui-sync.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/design/__tests__/graph-context-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/design/__tests__/ledger.test.ts` — imports files owned by FDs missing from @tests: tag — add: unvalidated-slug-path-traversal-across-cli-entry-points
- `src/design/__tests__/open-artifact.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/design/__tests__/archive-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows, pendev-ui-design-phase
- `src/design/__tests__/cli-fields.test.ts` — imports files owned by FDs missing from @tests: tag — add: unvalidated-slug-path-traversal-across-cli-entry-points
- `src/design/__tests__/render-digest.test.ts` — imports files owned by FDs missing from @tests: tag — add: unvalidated-slug-path-traversal-across-cli-entry-points
- `src/design/__tests__/editor-launch.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/design/__tests__/ledger-fields.test.ts` — imports files owned by FDs missing from @tests: tag — add: unvalidated-slug-path-traversal-across-cli-entry-points
- `src/design/__tests__/open-artifact-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/design/__tests__/graph-context.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows, rules-cascade-v1
- `src/design/__tests__/pen-bridge.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/design/__tests__/render.test.ts` — imports files owned by FDs missing from @tests: tag — add: unvalidated-slug-path-traversal-across-cli-entry-points
- `src/design/__tests__/design-approval.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/migrations/__tests__/chain.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-script-test-migration-cleanup
- `src/migrations/__tests__/0.5.0.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-script-test-migration-cleanup, prefix-skills-with-noldor
- `src/migrations/__tests__/0.6.0.test.ts` — imports files owned by FDs missing from @tests: tag — add: prefix-skills-with-noldor
- `src/migrations/__tests__/0.7.0.test.ts` — imports files owned by FDs missing from @tests: tag — add: version-aware-upgrade-and-migration-chain
- `src/prep/__tests__/formats.test.ts` — imports files owned by FDs missing from @tests: tag — add: pr-summary-body-enforcement
- `src/prep/__tests__/scaffold.test.ts` — imports files owned by FDs missing from @tests: tag — add: consumer-architecture-doc-surface
- `src/core/__tests__/cli-entry.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/core/__tests__/feature-schema.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase
- `src/core/__tests__/review-profile.test.ts` — imports files owned by FDs missing from @tests: tag — add: code-reviewer-20
- `src/core/__tests__/feature-schema-since.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase
- `src/core/__tests__/consumer-config.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase, self-boundaries-declaration-and-cycle-break, trailer-scope-alias-map, ui-design-review-lane
- `src/core/__tests__/branch-added.test.ts` — imports files owned by FDs missing from @tests: tag — add: rules-cascade-v1
- `src/core/__tests__/lanes.test.ts` — imports files owned by FDs missing from @tests: tag — add: ui-design-review-lane
- `src/core/__tests__/slug-paths.test.ts` — imports files owned by FDs missing from @tests: tag — add: dashboard-roadmap-drag-drop, noldor, state-file-fail-open-hardening
- `src/core/__tests__/split-suggestion.test.ts` — imports files owned by FDs missing from @tests: tag — add: dashboard-roadmap-drag-drop, replace-roadmap-buckets-with-flat-priority-order, roadmap-priority-ordering
- `src/core/__tests__/framework-version.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase, self-boundaries-declaration-and-cycle-break, trailer-scope-alias-map, ui-design-review-lane
- `src/core/__tests__/extract-touches.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/core/__tests__/release-markers.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-script-test-migration-cleanup
- `src/core/__tests__/repo-paths.test.ts` — imports files owned by FDs missing from @tests: tag — add: code-clone-detector, dynamic-fd-file-pointers-via-frontmatter, feature-md-links-overhaul
- `src/core/__tests__/slug-guards.test.ts` — imports files owned by FDs missing from @tests: tag — add: gate-flow-rework, noldor
- `src/core/__tests__/consumer-config-boundaries.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, pendev-ui-design-phase, trailer-scope-alias-map, ui-design-review-lane, version-aware-upgrade-and-migration-chain
- `src/core/__tests__/atomic-write.test.ts` — imports files owned by FDs missing from @tests: tag — add: dashboard-roadmap-drag-drop
- `src/core/__tests__/session.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase, rules-cascade-v1
- `src/core/__tests__/allowlist.test.ts` — imports files owned by FDs missing from @tests: tag — add: prefix-skills-with-noldor
- `src/core/__tests__/pr-flow-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor, pendev-ui-design-phase, rules-cascade-v1
- `src/core/__tests__/config.test.ts` — imports files owned by FDs missing from @tests: tag — add: code-clone-detector, code-reviewer-20, registry-distribution-for-the-noldor-package, release-bypass-retirement, ui-design-review-lane
- `src/core/__tests__/doc-roots.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-script-test-migration-cleanup, pendev-ui-design-phase, unvalidated-slug-path-traversal-across-cli-entry-points
- `src/core/__tests__/pr-flow.test.ts` — imports files owned by FDs missing from @tests: tag — add: pr-summary-body-enforcement
- `src/core/rules/__tests__/session-injected.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase, rules-cascade-v1
- `src/core/agent-runner/__tests__/types.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, ui-design-review-lane
- `src/core/agent-runner/__tests__/bounded-capture.test.ts` — imports files owned by FDs missing from @tests: tag — add: make-noldor-agent-agnostic
- `src/core/agent-runner/__tests__/registry-logsink.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, drain-startup-reconciliation-of-a-prior-dead-run, make-noldor-agent-agnostic
- `src/core/agent-runner/__tests__/doctor-runners.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, ui-design-review-lane
- `src/core/agent-runner/__tests__/registry.test.ts` — imports files owned by FDs missing from @tests: tag — add: dashboard-broken-pages-audit, ui-design-review-lane
- `src/garden/__tests__/garden-receipt.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-bypass-retirement, release-sweep-process-hardening
- `src/garden/__tests__/garden-detect.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase, release-bypass-retirement
- `src/garden/__tests__/graph-fd-lookup.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase, sdd-detector-5-idea-merge-semantic-similarity
- `src/garden/__tests__/sdd-report.test.ts` — imports files owned by FDs missing from @tests: tag — add: code-clone-detector, framework-script-test-migration-cleanup, pendev-ui-design-phase, release-bypass-retirement, sdd-detector-5-idea-merge-semantic-similarity
- `src/garden/__tests__/malformed-fd.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/skill-code-drift.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/override-audit.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-bypass-retirement
- `src/garden/detectors/__tests__/adr.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/fd-command-rot.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/trailer-scope-mismatch.test.ts` — imports files owned by FDs missing from @tests: tag — add: trailer-scope-alias-map
- `src/garden/detectors/__tests__/fd-link-rot.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/fd-diagram.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/structural-context.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/architecture.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/circular-blocked-by.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/checks/__tests__/check-push-gates.test.ts` — imports files owned by FDs missing from @tests: tag — add: rules-cascade-v1
- `src/checks/__tests__/check-feature-slug-scope.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/cr/__tests__/autofix-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, ui-design-review-lane
- `src/cr/__tests__/overwrite-guard.test.ts` — imports files owned by FDs missing from @tests: tag — add: ui-design-review-lane
- `src/cr/__tests__/orchestrate.integration.test.ts` — imports files owned by FDs missing from @tests: tag — add: ui-design-review-lane
- `src/cr/__tests__/filename.test.ts` — imports files owned by FDs missing from @tests: tag — add: ui-design-review-lane, unvalidated-slug-path-traversal-across-cli-entry-points
- `src/cr/__tests__/autofix-ledger.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, ui-design-review-lane
- `src/cr/__tests__/bootstrap-immunity.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-bypass-retirement
- `src/cr/__tests__/autofix.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/delta.test.ts` — imports files owned by FDs missing from @tests: tag — add: ui-design-review-lane
- `src/cr/__tests__/run-codex.test.ts` — imports files owned by FDs missing from @tests: tag — add: specs-cr-gate-multi-reviewer
- `src/cr/__tests__/codex-failure.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/expected-lanes-guard.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, noldor
- `src/cr/__tests__/findings-schema.test.ts` — imports files owned by FDs missing from @tests: tag — add: ui-design-review-lane
- `src/cr/__tests__/orchestrate.test.ts` — imports files owned by FDs missing from @tests: tag — add: ui-design-review-lane
- `src/cr/__tests__/finding-class.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/prior-review.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, autonomous-plan-to-pr-merge, rules-cascade-v1, ui-design-review-lane
- `src/cr/__tests__/codex.test.ts` — imports files owned by FDs missing from @tests: tag — add: ui-design-review-lane
- `src/cr/__tests__/lanes/render-compare-core.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/lanes/subagent-dispatch.test.ts` — imports files owned by FDs missing from @tests: tag — add: code-clone-detector, code-reviewer-20, continuous-drain-daemon-and-escalation-inbox, registry-distribution-for-the-noldor-package, release-bypass-retirement, ui-design-review-lane
- `src/cr/__tests__/lanes/ui-review.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, specs-cr-gate-multi-reviewer
- `src/cr/__tests__/lanes/verify-dispatch.test.ts` — imports files owned by FDs missing from @tests: tag — add: code-clone-detector, code-reviewer-20, continuous-drain-daemon-and-escalation-inbox, registry-distribution-for-the-noldor-package, release-bypass-retirement, specs-cr-gate-multi-reviewer, ui-design-review-lane
- `src/cr/__tests__/lanes/subagent.test.ts` — imports files owned by FDs missing from @tests: tag — add: rules-cascade-v1
- `src/cr/__tests__/lanes/render-compare.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, specs-cr-gate-multi-reviewer
- `src/cr/__tests__/lanes/ui-review-dispatch.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/lanes/codex.test.ts` — imports files owned by FDs missing from @tests: tag — add: code-clone-detector, code-reviewer-20, continuous-drain-daemon-and-escalation-inbox, registry-distribution-for-the-noldor-package, release-bypass-retirement, ui-design-review-lane
- `src/cr/__tests__/geometry/geometry-diff-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/geometry/geometry-compare-core.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/geometry/geometry-doc.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/geometry/geometry-validate-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/features/__tests__/feature-milestone.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase
- `src/features/__tests__/validate-features.test.ts` — imports files owned by FDs missing from @tests: tag — add: bootstrap-immunity-for-self-gating-features, pendev-ui-design-phase
- `src/features/__tests__/fill-links-code-gaps.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor, pendev-ui-design-phase
- `src/invariants/__tests__/rule-conflicts.test.ts` — imports files owned by FDs missing from @tests: tag — add: architecture-invariants
- `src/invariants/__tests__/boundaries.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, architecture-invariants, pendev-ui-design-phase, self-boundaries-declaration-and-cycle-break, trailer-scope-alias-map, ui-design-review-lane, version-aware-upgrade-and-migration-chain
- `src/release/__tests__/release-session.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor, pendev-ui-design-phase, rules-cascade-v1
- `src/release/__tests__/release-cr-gate-e2e.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-bypass-retirement
- `src/release/__tests__/preflight-probes.test.ts` — imports files owned by FDs missing from @tests: tag — add: autonomous-plan-to-pr-merge, outcome-telemetry-and-effectiveness-metrics, pendev-ui-design-phase, pnpm-release-resume, release-bypass-retirement, release-script-self-provisions-its-own-session-marker, rules-cascade-v1
- `src/release/__tests__/release-cr-gate.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-bypass-retirement
- `src/release/__tests__/release-config-flow.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase, self-boundaries-declaration-and-cycle-break, trailer-scope-alias-map, ui-design-review-lane
- `src/release/__tests__/release-resume.test.ts` — imports files owned by FDs missing from @tests: tag — add: dynamic-fd-changelog, framework-pr-flow-agent-auto-merge, registry-distribution-for-the-noldor-package, release-bypass-retirement, release-script-sddreport-skip-if-only-count-line-changed, release-script-self-provisions-its-own-session-marker, release-sweep-process-hardening
- `src/release/__tests__/preflight-render.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-script-sddreport-skip-if-only-count-line-changed
- `src/release/__tests__/preflight.test.ts` — imports files owned by FDs missing from @tests: tag — add: autonomous-plan-to-pr-merge, outcome-telemetry-and-effectiveness-metrics, pendev-ui-design-phase, pnpm-release-resume, release-bypass-retirement, release-script-self-provisions-its-own-session-marker, rules-cascade-v1
- `src/release/__tests__/release-commits.test.ts` — imports files owned by FDs missing from @tests: tag — add: dynamic-fd-changelog
- `src/release/__tests__/ui-design-freshness.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows, release-sweep-process-hardening
- `src/triage/__tests__/remove-block-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/triage/__tests__/has-block.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/triage/__tests__/triage-list-untriaged.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-script-test-migration-cleanup
- `src/cli/__tests__/validate-script-catalog.test.ts` — imports files owned by FDs missing from @tests: tag — add: abstraction-cost-ratchet, bootstrap-immunity-for-self-gating-features, code-clone-detector, continuous-drain-daemon-and-escalation-inbox, framework-auto-split-suggestion-for-big-features-and-plans, noldor-package-lift, outcome-telemetry-and-effectiveness-metrics, parallel-agent-dispatch-for-research-jobs, plan-runner, pnpm-release-resume, registry-distribution-for-the-noldor-package, scripts-reorganization-by-feature-area, sdd-detector-5-idea-merge-semantic-similarity, version-aware-upgrade-and-migration-chain
- `src/cli/__tests__/runtime-parity.test.ts` — imports files owned by FDs missing from @tests: tag — add: abstraction-cost-ratchet, bootstrap-immunity-for-self-gating-features, code-clone-detector, continuous-drain-daemon-and-escalation-inbox, framework-auto-split-suggestion-for-big-features-and-plans, outcome-telemetry-and-effectiveness-metrics, parallel-agent-dispatch-for-research-jobs, plan-runner, pnpm-release-resume, registry-distribution-for-the-noldor-package, scripts-reorganization-by-feature-area, sdd-detector-5-idea-merge-semantic-similarity, version-aware-upgrade-and-migration-chain
- `src/dashboard/__tests__/route-sweep.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, consumer-architecture-doc-surface, dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics, project-tracking-dashboard
- `src/dashboard/__tests__/dashboard-status.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/dashboard-layout-style-polish.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/dashboard-views.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-blocked-by-graph-view
- `src/dashboard/__tests__/dashboard-worktrees.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-blocked-by-graph-view, dashboard-broken-pages-audit
- `src/dashboard/__tests__/host.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/dashboard-agents.test.ts` — imports files owned by FDs missing from @tests: tag — add: dashboard-blocked-by-graph-view, dashboard-broken-pages-audit, dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, dynamic-fd-changelog, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics, project-tracking-dashboard, replace-roadmap-buckets-with-flat-priority-order, roadmap-priority-ordering
- `src/dashboard/__tests__/dashboard-mermaid.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-blocked-by-graph-view
- `src/dashboard/__tests__/dashboard-test-pyramid.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-blocked-by-graph-view
- `src/dashboard/__tests__/dashboard-ensure.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-broken-pages-audit
- `src/dashboard/__tests__/milestones-view.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-blocked-by-graph-view, decouple-milestones-from-semver, unvalidated-slug-path-traversal-across-cli-entry-points
- `src/dashboard/__tests__/dashboard-skills.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-blocked-by-graph-view
- `src/dashboard/__tests__/dashboard-repo-brand.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/metrics-view.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-blocked-by-graph-view
- `src/dashboard/__tests__/dashboard-graph-health.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-blocked-by-graph-view
- `src/dashboard/__tests__/api-blocks.test.ts` — imports files owned by FDs missing from @tests: tag — add: state-file-fail-open-hardening
- `src/dashboard/__tests__/dashboard-release-notes.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-blocked-by-graph-view
- `src/dashboard/__tests__/dashboard-render-markdown.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-blocked-by-graph-view
- `src/dashboard/__tests__/dashboard-layout-body-styles.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/dashboard-server.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-broken-pages-audit
- `src/dashboard/__tests__/server-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-blocked-by-graph-view, dashboard-broken-pages-audit, dynamic-fd-changelog, replace-roadmap-buckets-with-flat-priority-order, roadmap-priority-ordering
- `src/dashboard/__tests__/dashboard-doc-surfaces.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-blocked-by-graph-view
- `src/dashboard/__tests__/blocked-by.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, dynamic-fd-changelog, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics, project-tracking-dashboard, replace-roadmap-buckets-with-flat-priority-order, roadmap-priority-ordering
- `src/dashboard/__tests__/dashboard-data.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, code-clone-detector, dashboard-blocked-by-graph-view, scan-roots-repo-paths-provider
- `src/dashboard/__tests__/dashboard-identity.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-broken-pages-audit, dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
- `src/testing/__tests__/consumer-fixture.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-broken-pages-audit, pendev-ui-design-phase, self-boundaries-declaration-and-cycle-break, trailer-scope-alias-map, ui-design-review-lane
- `src/testing/__tests__/drain-e2e.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase, rules-cascade-v1
- `src/testing/__tests__/stub-runner.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, ui-design-review-lane
- `src/hooks/__tests__/noldor-open-artifact.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows, pendev-ui-design-phase
- `src/hooks/__tests__/noldor-validate-trailer.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-doc-extraction
- `src/worktrees/__tests__/create-worktree.test.ts` — imports files owned by FDs missing from @tests: tag — add: unvalidated-slug-path-traversal-across-cli-entry-points
- `src/worktrees/__tests__/down-worktree-traversal.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/worktrees/__tests__/down-worktree.test.ts` — imports files owned by FDs missing from @tests: tag — add: unvalidated-slug-path-traversal-across-cli-entry-points
- `src/worktrees/__tests__/dev-surfaces.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor, unvalidated-slug-path-traversal-across-cli-entry-points
- `src/worktrees/__tests__/up-worktree.test.ts` — imports files owned by FDs missing from @tests: tag — add: unvalidated-slug-path-traversal-across-cli-entry-points
- `src/milestones/__tests__/lib.test.ts` — imports files owned by FDs missing from @tests: tag — add: unvalidated-slug-path-traversal-across-cli-entry-points
- `src/templates/__tests__/templates.test.ts` — imports files owned by FDs missing from @tests: tag — add: make-noldor-agent-agnostic, noldor
- `src/autonomous/__tests__/drain-reconcile.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/autonomous/__tests__/build-pool.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/autonomous/__tests__/phase-events.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness, drain-startup-reconciliation-of-a-prior-dead-run, parallel-drain
- `src/autonomous/__tests__/drain-branch-state.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, agent-events-phase-tracking-run-ids-and-agents-dashboard-page, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox, parallel-drain-roadmapmd-conflict-auto-resolution
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
- `src/sync/__tests__/sync-spec-links.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/sync/__tests__/sync-fd-resources.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase
- `src/sync/__tests__/sync-doc-links.test.ts` — imports files owned by FDs missing from @tests: tag — add: feature-md-links-overhaul
