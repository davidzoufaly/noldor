<!-- generated: do-not-edit -->

# SDD Report

Generated: 2026-09-29 by `pnpm sdd:report`.

Pre-MVP done features (`introduced` < `0.2.0`) are
grandfathered from `links.spec` / `links.code` checks.
Bump `MIN_ENFORCED_VERSION` in `scripts/garden/sdd-report.ts` once backfill is done.

## Summary

- Total features: 100
- Untriaged ideas: 0
- Backlog entries: 41
- Gap categories with issues: 4 / 15

## Code clones

- 215 clone group(s), 5.91% duplicated tokens across 474 file(s)
- src/dashboard/views.ts:758-767 and src/dashboard/views.ts:1023-1032 (252 tokens)
- src/features/phase-flip-done-cli.ts:13-46 and src/features/phase-revert-cli.ts:13-46 (230 tokens)
- src/dashboard/views.ts:887-910 and src/dashboard/views.ts:1061-1136 (176 tokens)
- src/features/validate-features.ts:196-232 and src/features/validate-features.ts:353-389 (171 tokens)
- src/core/prefix-skills-codemod.ts:66-96 and src/core/rename-plan-only-tier.ts:84-115 (170 tokens)

## Gate compliance

### Tier distribution

- `full` (brainstorm + spec + plan): 44
- `specs-only` (no brainstorm): 56

### Override usage (last 30 days)

- `0cd1c62` — ci-graph-refresh machine-written graph regeneration
- `566340a` — ci-graph-refresh machine-written graph regeneration
- `d05aede` — ci-graph-refresh machine-written graph regeneration
- `90d6212` — ci-graph-refresh machine-written graph regeneration
- `37bcbfb` — ci-graph-refresh machine-written graph regeneration
- `37a9bb7` — ci-graph-refresh machine-written graph regeneration
- `03a2cef` — ci-graph-refresh machine-written graph regeneration
- `dec9b7c` — ci-graph-refresh machine-written graph regeneration
- `e73558f` — ci-graph-refresh machine-written graph regeneration
- `5d9030b` — ci-graph-refresh machine-written graph regeneration
- `cdc6ca4` — ci-graph-refresh machine-written graph regeneration
- `5a45a08` — ci-graph-refresh machine-written graph regeneration
- `806c258` — ci-graph-refresh machine-written graph regeneration
- `c77c85c` — ci-graph-refresh machine-written graph regeneration
- `9fb2e9b` — ci-graph-refresh machine-written graph regeneration
- `2fbe80a` — ci-graph-refresh machine-written graph regeneration
- `9e25821` — ci-graph-refresh machine-written graph regeneration
- `f53aacb` — ci-graph-refresh machine-written graph regeneration
- `b576a45` — ci-graph-refresh machine-written graph regeneration
- `4f80236` — ci-graph-refresh machine-written graph regeneration
- `c3d3add` — ci-graph-refresh machine-written graph regeneration
- `b1404d8` — ci-graph-refresh machine-written graph regeneration
- `317c980` — ci-graph-refresh machine-written graph regeneration
- `c4656fa` — ci-graph-refresh machine-written graph regeneration
- `28a1e38` — ci-graph-refresh machine-written graph regeneration
- `0625126` — ci-graph-refresh machine-written graph regeneration
- `8416e4a` — ci-graph-refresh machine-written graph regeneration
- `35337ee` — ci-graph-refresh machine-written graph regeneration
- `d1d0b57` — ci-graph-refresh machine-written graph regeneration
- `16c9888` — ci-graph-refresh machine-written graph regeneration
- `c55d43e` — ci-graph-refresh machine-written graph regeneration
- `b790f51` — ci-graph-refresh machine-written graph regeneration
- `6d954a5` — cr-arbitration 816390057a77 — codex raised a new format nit each round (Shows column, FINAL colon spacing, table placement); all three rejected as outside the check's contract; reviewer and verifier approved every round
- `33cca57` — ci-graph-refresh machine-written graph regeneration
- `26665b4` — ci-graph-refresh machine-written graph regeneration
- `519e461` — ci-graph-refresh machine-written graph regeneration
- `e5b13ed` — ci-graph-refresh machine-written graph regeneration
- `3227322` — ci-graph-refresh machine-written graph regeneration
- `5149890` — ci-graph-refresh machine-written graph regeneration
- `1d67e69` — ci-graph-refresh machine-written graph regeneration
- `582f7c9` — ci-graph-refresh machine-written graph regeneration
- `55ec54e` — ci-graph-refresh machine-written graph regeneration
- `616ff8e` — ci-graph-refresh machine-written graph regeneration
- `66bd1c3` — ci-graph-refresh machine-written graph regeneration
- `2f8149b` — ci-graph-refresh machine-written graph regeneration
- `e5c425e` — ci-graph-refresh machine-written graph regeneration
- `3a4eb75` — ci-graph-refresh machine-written graph regeneration
- `852b456` — ci-graph-refresh machine-written graph regeneration
- `e90a965` — ci-graph-refresh machine-written graph regeneration
- `13493d6` — ci-graph-refresh machine-written graph regeneration
- `31e45f8` — ci-graph-refresh machine-written graph regeneration
- `52d3c41` — ci-graph-refresh machine-written graph regeneration
- `819687b` — ci-graph-refresh machine-written graph regeneration
- `9871788` — ci-graph-refresh machine-written graph regeneration
- `891f9ca` — ci-graph-refresh machine-written graph regeneration
- `48415a0` — ci-graph-refresh machine-written graph regeneration
- `0ebf246` — ci-graph-refresh machine-written graph regeneration
- `0b02051` — ci-graph-refresh machine-written graph regeneration
- `c9fc9bf` — ci-graph-refresh machine-written graph regeneration
- `5ebbcdd` — ci-graph-refresh machine-written graph regeneration
- `7eb72fc` — ci-graph-refresh machine-written graph regeneration
- `7279156` — cr-arbitration c48c29a83430 — reviewer lane returned approve with zero blockers; the one codex finding is fixed in this tip
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

### Review-skip count (last 30 days)

Gated commits missing `Noldor-Reviewed` trailer: 159

## Metrics

### cycle-time [days]

```json
{
  "medianDays": 20.6,
  "p90Days": 52.6,
  "medianByPath": {
    "unknown": 9.9,
    "full-new": 20.6,
    "specs-only-new": 25.8
  },
  "excluded": {
    "noIntake": 34,
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
    "shipped": 3,
    "skipped": 0,
    "retried": 0
  },
  "history": {
    "salvaged": 2,
    "escalatedTotal": 19,
    "escalatedBySlug": {
      "trailer-scope-alias-map": 2,
      "prefix-skills-with-noldor": 2,
      "framework-script-test-migration-cleanup": 3,
      "scope-sibling-trailer-for-doc-sync-commits": 1,
      "-": 3,
      "diff-scoped-clone-gate-flags-mere-adjacency": 2,
      "queue-drain-selection-and-staleness-guards": 1,
      "roadmap-has-block-predicate": 1,
      "spec-lint-prior-art-requirement": 1,
      "mandatory-codex-review-round": 1,
      "clones-ratchet-and-clone-group-check-disagree-on-attribution": 2
    },
    "meanDurationMs": 636242
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
  "duplicate-pr-id-in-the-changelog": null,
  "framework-only-rules-leak-into-consumer-review-context": 25547,
  "stale-base-two-dot-diffs-hand-cr-lanes-foreign-changes": 20188,
  "noldor-commit-sigkilled-on-a-long-message-body": 36854,
  "gate-prose-should-pre-empt-the-sibling-scope-trailer": 49376,
  "heading-slugifier-drops-non-ascii-letters": 25993,
  "fill-links-code-gaps-emits-zero-candidates": 44147,
  "cr-re-round-cap-overrun": 43017,
  "pen-bridge-check-does-not-count-editor-windows": 34047,
  "hand-edited-code-links-drift-against-fd-tags": 32737,
  "spec-lint-prior-art-requirement": 64975,
  "bugfix-lane-in-the-priority-suggestions": 25974,
  "autonomous-address-blockers-without-an-operator-confirm": 40903,
  "parent-feature-opt-in-check-before-sizing": 53559,
  "release-sweep-refactor-pass-needs-a-precondition": 48661,
  "self-explanatory-code-over-comments-rule": 12789,
  "rules-must-not-snapshot-another-modules-shape": 10306,
  "milestones-have-no-explicit-order": 19426,
  "always-read-capability-index-for-agents": 39358,
  "pnpm-flattens-cli-exit-codes-the-skills-branch-on": 37345,
  "spec-stage-adr-commit-breaks-the-cr-range-and-the-pr-summary": 29917,
  "spec-structural-read-leaves-a-regenerated-graph-on-the-branch": 17665,
  "verify-lane-leaves-a-registered-worktree-behind": 218784,
  "code-stage-command-skips-the-configured-verifier": 161337,
  "fd-resources-hook-skips-flat-feature-docs": 27000,
  "registry-logsink-test-waits-for-the-flush": 10601,
  "gate-skill-leftovers-from-q-0192": 1141344,
  "doctor-flags-a-broken-claude-import": 16704,
  "cr-lane-prompts-stop-calling-a-pen-encrypted": 11061,
  "graph-workflow-publish-step-hardening": 23434,
  "pin-every-localecompare-to-a-fixed-locale": 58347,
  "design-verdict-check-edge-cases": 17604,
  "verify-whether-subagents-load-claudemd": 1527185,
  "design-context-section-matching-without-backticks": 29542,
  "codex-skips-fd-scaffold-stubs-at-plan-and-code": 27083,
  "release-npm-wait-bypasses-the-registry-cache": 14793,
  "step-0-lists-in-progress-worktree-sessions": 31985,
  "design-links-open-from-a-terminal": 20998,
  "upgrade-restarts-the-dashboard": 30585,
  "graph-freshness-reads-git-not-mtime": 38577,
  "suite-lock-follow-ups": 40339,
  "drain-child-waits-for-its-background-tasks": 13069,
  "design-log-section-resolves-on-decide-and-open": 17668,
  "gate-skill-rebase-base-sha-qualifier": 8464,
  "sync-fd-resources-honours-slug": 16386,
  "module-map-drops-arrows-no-import-backs": 12498,
  "validate-flags-a-queue-id-carried-twice": 29368,
  "unknown-command-message-echoes-its-argv": 14709,
  "resync-sdd-co-tag-detector-resources": 602829,
  "drain-lock-readers-share-readholder": 11102,
  "load-timeout-tests-in-dashboard-and-sdd-report": 30834,
  "design-archive-repoints-a-folded-linksspec": 13578,
  "lane-error-rounds-and-the-round-cap": 45654,
  "gate-exit-11-record-prose-misstates-deferred": 13933,
  "graph-freshness-remedies-ignore-uncommitted-edits": 49511,
  "release-pipeline-stamps-template-twins": 23993,
  "render-compare-checks-the-canvas-on-disk": 40719,
  "next-priority-holds-in-progress-blockers": 29157,
  "promote-does-not-retire-the-entry-id": 13854,
  "test-links-sync-restages-the-fd": 31459,
  "drain-prompt-points-at-drain-mode": 15296,
  "blockers-md-onblockers-default-prose": 14061,
  "fd-headers-for-five-ownerless-files": 14054,
  "gitignore-cache-backfill-backups": 24228,
  "seed-missing-test-co-tags": 20716
}
```

formula: Sum of agent-event tokens.total per slug. Tokens are read verbatim from runner usage records (claude-jsonl / codex-session / opencode-session); events without trustworthy usage carry no tokens.
blind spots: null = no usage data, not zero usage: operator-driven interactive sessions and runners without locatable usage records are invisible. | Only spawn-captured agents count; epoch-limited to when token capture shipped.

## Gap details

### Done features missing introduced

- `sdd-report-honours-ownerless-on-purpose` — SDD Report Honours Ownerless On Purpose is phase=done but introduced is unset (release script should fill on next pnpm release)

### Stale backlog entries (>90 days)

- `Does SQL in a Framework Make Sense?` — Does SQL in a Framework Make Sense? (tooling) has been in backlog for 109 days since 2026-06-12

### Code files not referenced by any feature

- `src/cr/cut-scan.ts` — src/cr/cut-scan.ts is not referenced by any feature MD links.code — probable owner: specs-cr-gate-multi-reviewer, ui-design-review-lane, cr-re-round-cap-enforcement-and-oscillation-detector
- `src/cr/geometry/geometry-export-cli.ts` — src/cr/geometry/geometry-export-cli.ts is not referenced by any feature MD links.code — probable owner: ui-design-review-lane
- `src/cr/lanes/geometry-extract-dispatch.ts` — src/cr/lanes/geometry-extract-dispatch.ts is not referenced by any feature MD links.code — probable owner: cr-lane-verdicts-blocked-by-serialization-not-substance, ui-design-review-lane, acceptance-verify-lane
- `src/design/arch-draw.ts` — src/design/arch-draw.ts is not referenced by any feature MD links.code — probable owner: architecture-design-phase
- `src/release/index.ts` — src/release/index.ts is not referenced by any feature MD links.code — probable owner: dynamic-fd-changelog, noldor, framework-script-test-migration-cleanup

### Tests with incomplete co-tag

- `src/features/__tests__/seed-test-tags.test.ts` — imports files owned by FDs missing from @tests: tag — add: sdd-report-honours-ownerless-on-purpose
