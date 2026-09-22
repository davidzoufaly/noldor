<!-- generated: do-not-edit -->

# SDD Report

Generated: 2026-09-22 by `pnpm sdd:report`.

Pre-MVP done features (`introduced` < `0.2.0`) are
grandfathered from `links.spec` / `links.code` checks.
Bump `MIN_ENFORCED_VERSION` in `scripts/garden/sdd-report.ts` once backfill is done.

## Summary

- Total features: 88
- Untriaged ideas: 8
- Backlog entries: 28
- Gap categories with issues: 4 / 15

## Code clones

- 227 clone group(s), 7.65% duplicated tokens across 425 file(s)
- src/dashboard/views.ts:750-759 and src/dashboard/views.ts:1015-1024 (252 tokens)
- src/features/phase-flip-done-cli.ts:12-45 and src/features/phase-revert-cli.ts:12-45 (233 tokens)
- src/cli/manifest.ts:210-265 and src/cli/manifest.ts:342-394 (185 tokens)
- src/dashboard/views.ts:879-902 and src/dashboard/views.ts:1053-1128 (176 tokens)
- src/features/validate-features.ts:187-223 and src/features/validate-features.ts:344-380 (171 tokens)

## Gate compliance

### Tier distribution

- `full` (brainstorm + spec + plan): 40
- `specs-only` (no brainstorm): 48

### Override usage (last 30 days)

- `7576ab1` — verify lane malformed-output (Q-0137 class), not a code defect — reviewer lane approved; the verifier ran the acceptance set against a fake consumer and against real charuy (exit 0, zero non-portable rows) and emitted a pass verdict, but its evidence strings embed fenced code blocks (this change is about fenced blocks), which broke the fence parser in both rounds. Receipt withheld only because orchestrate exits non-zero on any red lane.
- `00aabcd` — cr-arbitration c3e915b25538 — round cap spent after 4 red rounds; the one standing blocker was correct and is fixed in this commit, arbitrated as accepted with the fix unreviewed
- `683b356` — cr-arbitration f523dc86756e — reviewer approved and verifier verified; both remaining codex blockers were fixed in this commit, not carried, and the round cap is spent
- `5377b5d` — cr-arbitration 2613fe542270 — all 5 blockers accepted and fixed in this tree; the sinks predate it and every flagged sentence is grep-absent
- `4b85199` — cr-arbitration cbda7d58035b — reviewer lane approved and verifier was green every round; both remaining blockers are accepted and already fixed in this tree (win32 test literals skipIf-guarded, second-spelling decision recorded in the FD and Q-0221 as the reviewer proposed); the round cap refuses a further dispatch to confirm it
- `3b8ad2f` — cr-arbitration a90e58f1bf62 — the sole open blocker (a mirror test row) is applied in this tree at detect.test.ts:473-476 and passing; the 4-round cap refuses the dispatch that would observe it. codex: no actionable issues; verifier: verified.
- `43f7a46` — cr-arbitration 3 blockers — 2 already fixed at 42d0263 (the sink is stale round-4 output), 1 declined as pre-existing and out of scope; codex green, verifier verified, suite 5461 green, push-gates green
- `5c6da4d` — code-stage CR stopped at 2 red rounds — the mandatory codex lane never reviewed (OpenAI workspace spend cap), so no round can go green; both reviewer rounds' blockers are fixed but the round-2 fixes are not themselves re-reviewed
- `87b6c12` — code CR arbitrated after 6 rounds without convergence. Every finding was applied, none waived (~30 findings, ~11 high); verifier lane passed all 6 rounds. Rounds 5 and 6 each reversed a round-3 decision, and every round found defects in the prior round's fix — the documented no-fixed-point shape, since each fix is fresh surface. The cap fired correctly on its own review at round 4 and marked it terminal; rounds 5-6 ran only after an operator-authorised ledger reset, preserved at .noldor/cr/autofix/<slug>-code.json.forced-reset. Residual risk is asymmetric: a round is marked terminal only when a lane that ran that round filed a real non-integrity finding, so every degraded path (crashed lane, corrupt sink, stale sink, nothing resolved) is non-terminal and an undiscovered bug of this family under-enforces rather than wedging. Harder half carved to Q-0209. tests 5259, lint, typecheck, template-sync and push-gates all green.
- `86ed29a` — operator-waived review receipt at the CR re-round cap after 3 rounds and 23 fixed findings; all mechanical gates green
- `c601952` — reviewer approve + codex clean at round 7; verify lane red is infra-only (own transcript reports success, then a dispatch timeout) — receipt could not be amended on a red aggregate
- `4d506ad` — eight code-stage CR rounds without convergence; remaining findings carved to Q-0197; mechanical gates green at this tip
- `f311816` — code-stage CR closed after 7 rounds — verifier green throughout, reviewer approve at round 5, rounds 5-7 self-fed on symlink hardening of an advisory heuristic; all findings reproduced and fixed, sinks in .noldor/cr
- `366cb50` — cr-non-convergence after 8 rounds; rounds 7/8 mutually contradictory on skipIf(root) and the chmod fixture; all security findings through round 7 fixed and probe-verified; residue recorded in the FD Changelog
- `5a1b323` — review-loop-converged-on-prose
- `58e9539` — micro-chore lane omits `.noldor/config.json`, and the CR-gate exemption this release needs can only live there. Diff is README + ideas + one config entry; zero source files.
- `57134eb` — micro-chore lane rejects `.noldor/id-counter.json` — `MICRO_CHORE_GLOBS` omits the counter that `triage mint-id` bumps, so the framework bookkeeping this commit carries cannot land through its own lane (precedent: #346, #335). Diff is docs + queue bookkeeping only, zero source files.

### Review-skip count (last 30 days)

Gated commits missing `Noldor-Reviewed` trailer: 84

## Metrics

### cycle-time [days]

```json
{
  "medianDays": 20.6,
  "p90Days": 52.6,
  "medianByPath": {
    "unknown": 18.8,
    "full-new": 20.6,
    "specs-only-new": 25.8
  },
  "excluded": {
    "noIntake": 32,
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
    "shipped": 1,
    "skipped": 0,
    "retried": 0
  },
  "history": {
    "salvaged": 2,
    "escalatedTotal": 18,
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
      "mandatory-codex-review-round": 1,
      "clones-ratchet-and-clone-group-check-disagree-on-attribution": 2
    },
    "meanDurationMs": 806504
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
  "size-aware-iteration-timeout-for-the-drain-runner": 21561,
  "pr-body-lists-only-one-plan-part": 31301,
  "task-id-as-the-first-scope-bullet-in-a-pr-summary": 189201,
  "stale-specs-detector-is-blind-to-attach-flow-orphan-specs": 67559,
  "garden-skill-checklist-enumerates-a-fixed-section-list": 38724,
  "clones-ratchet-and-clone-group-check-disagree-on-attribution": 24183,
  "oscillation-detector-r3-fires-on-every-greenfield-finding": 35367,
  "clones-check-wont-name-the-files-that-moved-the-token-total": 60566,
  "roadmap-entry-show-more-not-rendered": 193163,
  "duplicate-pr-id-in-the-changelog": null
}
```

formula: Sum of agent-event tokens.total per slug. Tokens are read verbatim from runner usage records (claude-jsonl / codex-session / opencode-session); events without trustworthy usage carry no tokens.
blind spots: null = no usage data, not zero usage: operator-driven interactive sessions and runners without locatable usage records are invisible. | Only spawn-captured agents count; epoch-limited to when token capture shipped.

## Gap details

### Untriaged ideas in ideas.md

- `ideas.md:51` — claude ran 4 rounds of review when there is limit for 2
- `ideas.md:52` — update cr by CR tool to make it more reliable -> hard to get green check
- `ideas.md:53` — claude supports agents.md -> bake it into noldor so no claude.md is created when initating the noldor in project + propagate it to Charuy
- `ideas.md:54` — screen id's to framework -> UI naming in .pen + elements ID -> hiearchy naming -> each button, label, input has ID
- `ideas.md:55` — agent didn't know capabilities of the milestones features, there might be more blind sposts -> shouldn't we have some short md file -> read always rule so agent has list of noldor features always in context window?
- `ideas.md:56` — Sort milestones by chronological order instead of by name (`milestones show`, the `/milestones` dashboard page, `buildMilestoneGroupBases`). Needs a date to sort on: milestone frontmatter has none, and git birth date is not enough — in charuy `public-release` was born 2026-05-13 and the other four all on 2026-07-11, so git order puts milestone 2 first and leaves a four-way tie. Cheapest shape: `/noldor-milestone draft` stamps `since: <YYYY-MM-DD>` (the roadmap block field), `show` sorts by it within each status, and a missing `since` falls back to name. See the `after:` bullet in the lessons section above for the explicit-order alternative; `since` is the zero-thought default, `after` is for when the ladder disagrees with the calendar.
- `ideas.md:57` — zbavit se claude.md anthropic podporuje agents.md
- `ideas.md:58` — `sortEntries` in `src/dashboard/views.ts` has two red tests on `main` (`dashboard-views.test.ts` > sortEntries > "defaults to name-asc when sort mode is empty" and "falls back to name-asc for unknown sort key"): the expected 4-element order differs from the actual. Pre-existing since at least PR #480; every dashboard-touching branch inherits the red and has to prove it is not theirs. Either the fallback or the fixture is wrong — decide which and fix. (found 2026-09-19 shipping Q-0231)

### Stale backlog entries (>90 days)

- `Does SQL in a Framework Make Sense?` — Does SQL in a Framework Make Sense? (tooling) has been in backlog for 102 days since 2026-06-12

### Code files not referenced by any feature

- `src/checks/check-install-freshness.ts` — src/checks/check-install-freshness.ts is not referenced by any feature MD links.code — probable owner: make-noldor-agent-agnostic, noldor
- `src/checks/check-oxfmt-ignores.ts` — src/checks/check-oxfmt-ignores.ts is not referenced by any feature MD links.code — probable owner: make-noldor-agent-agnostic, noldor
- `src/checks/check-push-gates.ts` — src/checks/check-push-gates.ts is not referenced by any feature MD links.code
- `src/core/blob-id.ts` — src/core/blob-id.ts is not referenced by any feature MD links.code — probable owner: de-superpowers-vendor-spec-plan-and-worktree-flows, pendev-ui-design-phase
- `src/core/config-waiver-guard.ts` — src/core/config-waiver-guard.ts is not referenced by any feature MD links.code
- `src/core/init-vscode-settings.ts` — src/core/init-vscode-settings.ts is not referenced by any feature MD links.code — probable owner: abstraction-cost-ratchet, state-file-fail-open-hardening
- `src/core/receipt-store.ts` — src/core/receipt-store.ts is not referenced by any feature MD links.code — probable owner: de-superpowers-vendor-spec-plan-and-worktree-flows, pendev-ui-design-phase
- `src/features/attach-milestone-cli.ts` — src/features/attach-milestone-cli.ts is not referenced by any feature MD links.code — probable owner: outcome-telemetry-and-effectiveness-metrics, dashboard-roadmap-drag-drop, sdd-detector-5-idea-merge-semantic-similarity
- `src/features/attach-milestone.ts` — src/features/attach-milestone.ts is not referenced by any feature MD links.code — probable owner: outcome-telemetry-and-effectiveness-metrics, dashboard-roadmap-drag-drop, sdd-detector-5-idea-merge-semantic-similarity
- `src/graphify/enrich-doc-nodes.ts` — src/graphify/enrich-doc-nodes.ts is not referenced by any feature MD links.code — probable owner: acceptance-verify-lane, ui-design-review-lane
- `src/hooks/noldor-enforce-arbitration.ts` — src/hooks/noldor-enforce-arbitration.ts is not referenced by any feature MD links.code — probable owner: acceptance-verify-lane
- `src/milestones/show-cli.ts` — src/milestones/show-cli.ts is not referenced by any feature MD links.code — probable owner: decouple-milestones-from-semver, unvalidated-slug-path-traversal-across-cli-entry-points
- `src/utils/word-count.ts` — src/utils/word-count.ts is not referenced by any feature MD links.code — probable owner: framework-auto-split-suggestion-for-big-features-and-plans, noldor

### Tests with incomplete co-tag

- `src/metrics/__tests__/cr-and-override.test.ts` — imports files owned by FDs missing from @tests: tag — add: cr-re-round-cap-enforcement-and-oscillation-detector, ui-design-review-lane
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
- `src/prep/__tests__/formats.test.ts` — imports files owned by FDs missing from @tests: tag — add: cr-re-round-cap-enforcement-and-oscillation-detector, pr-summary-body-enforcement
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
- `src/garden/detectors/__tests__/structural-context.test.ts` — imports files owned by FDs missing from @tests: tag — add: cr-re-round-cap-enforcement-and-oscillation-detector, outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/architecture.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/garden/detectors/__tests__/circular-blocked-by.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/checks/__tests__/check-pen-bridge.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows
- `src/checks/__tests__/check-push-gates.test.ts` — imports files owned by FDs missing from @tests: tag — add: rules-cascade-v1
- `src/checks/__tests__/check-feature-slug-scope.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/cr/__tests__/autofix-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, cr-re-round-cap-enforcement-and-oscillation-detector, ui-design-review-lane
- `src/cr/__tests__/locations.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/overwrite-guard.test.ts` — imports files owned by FDs missing from @tests: tag — add: cr-re-round-cap-enforcement-and-oscillation-detector, ui-design-review-lane
- `src/cr/__tests__/orchestrate.integration.test.ts` — imports files owned by FDs missing from @tests: tag — add: cr-re-round-cap-enforcement-and-oscillation-detector, ui-design-review-lane
- `src/cr/__tests__/filename.test.ts` — imports files owned by FDs missing from @tests: tag — add: ui-design-review-lane, unvalidated-slug-path-traversal-across-cli-entry-points
- `src/cr/__tests__/cut-scan.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, cr-re-round-cap-enforcement-and-oscillation-detector
- `src/cr/__tests__/autofix-ledger.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, cr-re-round-cap-enforcement-and-oscillation-detector, ui-design-review-lane
- `src/cr/__tests__/bootstrap-immunity.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-bypass-retirement
- `src/cr/__tests__/autofix.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, cr-re-round-cap-enforcement-and-oscillation-detector
- `src/cr/__tests__/delta.test.ts` — imports files owned by FDs missing from @tests: tag — add: cr-re-round-cap-enforcement-and-oscillation-detector, ui-design-review-lane
- `src/cr/__tests__/run-codex.test.ts` — imports files owned by FDs missing from @tests: tag — add: cr-re-round-cap-enforcement-and-oscillation-detector, specs-cr-gate-multi-reviewer
- `src/cr/__tests__/codex-failure.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/arbitration-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, noldor, unvalidated-slug-path-traversal-across-cli-entry-points
- `src/cr/__tests__/expected-lanes-guard.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, noldor
- `src/cr/__tests__/findings-schema.test.ts` — imports files owned by FDs missing from @tests: tag — add: cr-re-round-cap-enforcement-and-oscillation-detector, ui-design-review-lane
- `src/cr/__tests__/orchestrate.test.ts` — imports files owned by FDs missing from @tests: tag — add: cr-re-round-cap-enforcement-and-oscillation-detector, rules-cascade-v1, ui-design-review-lane
- `src/cr/__tests__/aggregate.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor, unvalidated-slug-path-traversal-across-cli-entry-points
- `src/cr/__tests__/reflag.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/arbitration.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, noldor, unvalidated-slug-path-traversal-across-cli-entry-points
- `src/cr/__tests__/finding-class.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/prior-review.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, autonomous-plan-to-pr-merge, cr-re-round-cap-enforcement-and-oscillation-detector, rules-cascade-v1, ui-design-review-lane
- `src/cr/__tests__/codex.test.ts` — imports files owned by FDs missing from @tests: tag — add: cr-re-round-cap-enforcement-and-oscillation-detector, ui-design-review-lane
- `src/cr/__tests__/lanes/render-compare-core.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane
- `src/cr/__tests__/lanes/subagent-dispatch.test.ts` — imports files owned by FDs missing from @tests: tag — add: code-clone-detector, code-reviewer-20, continuous-drain-daemon-and-escalation-inbox, cr-re-round-cap-enforcement-and-oscillation-detector, registry-distribution-for-the-noldor-package, release-bypass-retirement, ui-design-review-lane
- `src/cr/__tests__/lanes/ui-review.test.ts` — imports files owned by FDs missing from @tests: tag — add: acceptance-verify-lane, specs-cr-gate-multi-reviewer
- `src/cr/__tests__/lanes/verify-dispatch.test.ts` — imports files owned by FDs missing from @tests: tag — add: code-clone-detector, code-reviewer-20, continuous-drain-daemon-and-escalation-inbox, registry-distribution-for-the-noldor-package, release-bypass-retirement, specs-cr-gate-multi-reviewer, ui-design-review-lane
- `src/cr/__tests__/lanes/subagent.test.ts` — imports files owned by FDs missing from @tests: tag — add: cr-re-round-cap-enforcement-and-oscillation-detector, rules-cascade-v1
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
- `src/release/__tests__/release-cr-gate.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-bypass-retirement, test-suites-read-live-repo-state-shifting-full-suite-failures
- `src/release/__tests__/release-config-flow.test.ts` — imports files owned by FDs missing from @tests: tag — add: pendev-ui-design-phase, self-boundaries-declaration-and-cycle-break, trailer-scope-alias-map, ui-design-review-lane
- `src/release/__tests__/release-resume.test.ts` — imports files owned by FDs missing from @tests: tag — add: dynamic-fd-changelog, framework-pr-flow-agent-auto-merge, registry-distribution-for-the-noldor-package, release-bypass-retirement, release-script-sddreport-skip-if-only-count-line-changed, release-script-self-provisions-its-own-session-marker, release-sweep-process-hardening
- `src/release/__tests__/preflight-render.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-script-sddreport-skip-if-only-count-line-changed
- `src/release/__tests__/preflight.test.ts` — imports files owned by FDs missing from @tests: tag — add: autonomous-plan-to-pr-merge, outcome-telemetry-and-effectiveness-metrics, pendev-ui-design-phase, pnpm-release-resume, release-bypass-retirement, release-script-self-provisions-its-own-session-marker, rules-cascade-v1, test-suites-read-live-repo-state-shifting-full-suite-failures
- `src/release/__tests__/release-commits.test.ts` — imports files owned by FDs missing from @tests: tag — add: dynamic-fd-changelog
- `src/release/__tests__/run-command.test.ts` — imports files owned by FDs missing from @tests: tag — add: release-sweep-process-hardening
- `src/release/__tests__/ui-design-freshness.test.ts` — imports files owned by FDs missing from @tests: tag — add: de-superpowers-vendor-spec-plan-and-worktree-flows, release-sweep-process-hardening
- `src/triage/__tests__/remove-block-cli.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/triage/__tests__/has-block.test.ts` — imports files owned by FDs missing from @tests: tag — add: noldor
- `src/triage/__tests__/triage-list-untriaged.test.ts` — imports files owned by FDs missing from @tests: tag — add: framework-script-test-migration-cleanup
- `src/docs/__tests__/adr-structural-context.test.ts` — imports files owned by FDs missing from @tests: tag — add: cr-re-round-cap-enforcement-and-oscillation-detector
- `src/cli/__tests__/validate-script-catalog.test.ts` — imports files owned by FDs missing from @tests: tag — add: abstraction-cost-ratchet, bootstrap-immunity-for-self-gating-features, code-clone-detector, continuous-drain-daemon-and-escalation-inbox, framework-auto-split-suggestion-for-big-features-and-plans, noldor-package-lift, outcome-telemetry-and-effectiveness-metrics, parallel-agent-dispatch-for-research-jobs, plan-runner, pnpm-release-resume, registry-distribution-for-the-noldor-package, scripts-reorganization-by-feature-area, sdd-detector-5-idea-merge-semantic-similarity, version-aware-upgrade-and-migration-chain
- `src/cli/__tests__/runtime-parity.test.ts` — imports files owned by FDs missing from @tests: tag — add: abstraction-cost-ratchet, bootstrap-immunity-for-self-gating-features, code-clone-detector, continuous-drain-daemon-and-escalation-inbox, framework-auto-split-suggestion-for-big-features-and-plans, outcome-telemetry-and-effectiveness-metrics, parallel-agent-dispatch-for-research-jobs, plan-runner, pnpm-release-resume, registry-distribution-for-the-noldor-package, scripts-reorganization-by-feature-area, sdd-detector-5-idea-merge-semantic-similarity, version-aware-upgrade-and-migration-chain
- `src/dashboard/__tests__/route-sweep.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, consumer-architecture-doc-surface, dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics, project-tracking-dashboard
- `src/dashboard/__tests__/dashboard-status.test.ts` — imports files owned by FDs missing from @tests: tag — add: outcome-telemetry-and-effectiveness-metrics
- `src/dashboard/__tests__/dashboard-layout-style-polish.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
- `src/dashboard/__tests__/dashboard-stale-install.test.ts` — imports files owned by FDs missing from @tests: tag — add: agent-events-phase-tracking-run-ids-and-agents-dashboard-page, dashboard-broken-pages-audit, dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
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
- `src/milestones/__tests__/show.test.ts` — imports files owned by FDs missing from @tests: tag — add: unvalidated-slug-path-traversal-across-cli-entry-points
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
