<!-- generated: do-not-edit -->

# SDD Report

Generated: 2026-08-23 by `pnpm sdd:report`.

Pre-MVP done features (`introduced` < `0.2.0`) are
grandfathered from `links.spec` / `links.code` checks.
Bump `MIN_ENFORCED_VERSION` in `scripts/garden/sdd-report.ts` once backfill is done.

## Summary

- Total features: 82
- Untriaged ideas: 0
- Backlog entries: 22
- Gap categories with issues: 2 / 15

## Code clones

- 282 clone group(s), 9.80% duplicated tokens across 370 file(s)
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

Gated commits missing `Noldor-Reviewed` trailer: 97

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
      "blockers": 13,
      "suggestions": 49
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
    "meanDurationMs": 912858
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

### Stale backlog entries (>90 days)

- `Real-Codex Integration Smoke Test` — Real-Codex Integration Smoke Test (tooling) has been in backlog for 105 days since 2026-05-10

### Tests with incomplete co-tag

- `graphify-out/graph.json` — Co-tag detector ran in degraded mode: graphify-out/graph.json regen 2026-08-20, latest source mtime 2026-08-22. Run /graphify + pnpm toon (preferred) or perform a manual co-tag audit: for each .test.ts file under packages/ or apps/src/, grep imports → check which FDs own those files via links.code → propose missing co-tags.
