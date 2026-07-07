<!-- generated: do-not-edit -->

# SDD Report

Generated: 2026-07-07 by `pnpm sdd:report`.

Pre-MVP done features (`introduced` < `0.2.0`) are
grandfathered from `links.spec` / `links.code` checks.
Bump `MIN_ENFORCED_VERSION` in `scripts/garden/sdd-report.ts` once backfill is done.

## Summary

- Total features: 64
- Untriaged ideas: 0
- Backlog entries: 6
- Gap categories with issues: 7 / 14

## Gate compliance

### Tier distribution

- `full` (brainstorm + spec + plan): 35
- `specs-only` (no brainstorm): 29

### Override usage (last 30 days)

- `a890954` — prep-promote batch (drafts operator-approved at artifact stage)
- `d015f16` — prep-promote batch (drafts operator-approved at artifact stage)
- `7001d1e` — prep-promote batch (drafts operator-approved at artifact stage)
- `cfb750a` — prep-promote batch (drafts operator-approved at artifact stage)
- `4404525` — prep-promote batch (drafts operator-approved at artifact stage)
- `ec7bf0b` — cr-red override acceptance-verify-lane - operator accepted residual med risk-notes after 5 CR rounds; 4 substantive fixes landed; verify lane pass
- `1f08bd2` — fast-track framework chore, no FD; spans gate SKILL.md twins + docs/noldor + docs/features so no single conventional scope fits. Controller-reviewed; /garden audits the override.
- `211e3ae` — fast-track framework chore, no FD; cr:orchestrate is slug-based so no review-receipt path fits; allowlist + doc changes controller-reviewed, /garden audits the override.

### Review-skip count (last 30 days)

Gated commits missing `Noldor-Reviewed` trailer: 112

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
    "noIntake": 20,
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
    "meanDurationMs": 1533278
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
  "init-scaffold-noldor-scope-allowlist": 1076721
}
```

formula: Sum of agent-event tokens.total per slug. Tokens are read verbatim from runner usage records (claude-jsonl / codex-session / opencode-session); events without trustworthy usage carry no tokens.
blind spots: null = no usage data, not zero usage: operator-driven interactive sessions and runners without locatable usage records are invisible. | Only spawn-captured agents count; epoch-limited to when token capture shipped.

## Gap details

### Done features without tests

- `trailer-scope-alias-map` — Trailer Scope-Alias Map (tooling) has no tests in links.tests

### Done features without docs

- `continuous-drain-daemon-and-escalation-inbox` — Continuous Drain Daemon and Escalation Inbox (tooling) has no entries in links.docs
- `make-noldor-agent-agnostic` — Make Noldor Agent-Agnostic (tooling) has no entries in links.docs

### Done features missing introduced

- `agent-events-phase-tracking-run-ids-and-agents-dashboard-page` — Agent-Events Phase Tracking, Run IDs and `/agents` Dashboard Page is phase=done but introduced is unset (release script should fill on next pnpm release)
- `framework-auto-split-suggestion-for-big-features-and-plans` — Framework Auto-Split Suggestion for Big Features and Plans is phase=done but introduced is unset (release script should fill on next pnpm release)
- `framework-script-test-migration-cleanup` — Framework Script + Test Migration Cleanup is phase=done but introduced is unset (release script should fill on next pnpm release)
- `parallel-agent-dispatch-for-research-jobs` — Parallel-Agent Dispatch for Research Jobs is phase=done but introduced is unset (release script should fill on next pnpm release)
- `pnpm-release-resume` — `pnpm release --resume` is phase=done but introduced is unset (release script should fill on next pnpm release)
- `portable-gate-entrypoint-for-non-claude-runners` — Portable Gate Entrypoint for Non-Claude Runners is phase=done but introduced is unset (release script should fill on next pnpm release)
- `registry-distribution-for-the-noldor-package` — Registry Distribution for the Noldor Package is phase=done but introduced is unset (release script should fill on next pnpm release)
- `release-bypass-retirement` — Release Bypass Retirement is phase=done but introduced is unset (release script should fill on next pnpm release)
- `scan-roots-repo-paths-provider` — Scan-Roots Repo-Paths Provider is phase=done but introduced is unset (release script should fill on next pnpm release)
- `scope-sibling-trailer-for-doc-sync-commits` — Scope Sibling Trailer for Doc-Sync Commits is phase=done but introduced is unset (release script should fill on next pnpm release)
- `sdd-detector-5-idea-merge-semantic-similarity` — SDD Detector 5 — Idea-Merge Semantic Similarity is phase=done but introduced is unset (release script should fill on next pnpm release)
- `self-boundaries-declaration-and-cycle-break` — Self-Boundaries Declaration and Cycle Break is phase=done but introduced is unset (release script should fill on next pnpm release)
- `stable-entry-ids-for-roadmap-backlog` — Stable Entry IDs for Roadmap + Backlog is phase=done but introduced is unset (release script should fill on next pnpm release)

### Plans without matching spec

- `docs/superpowers/plans/2026-06-07-end-of-flow-ergonomics.md` — docs/superpowers/plans/2026-06-07-end-of-flow-ergonomics.md has slug "end-of-flow-ergonomics" with no matching spec under docs/superpowers/specs/

### Code files not referenced by any feature

- `src/core/config.ts` — src/core/config.ts is not referenced by any feature MD links.code
- `src/core/init-gitignore.ts` — src/core/init-gitignore.ts is not referenced by any feature MD links.code
- `src/core/lanes.ts` — src/core/lanes.ts is not referenced by any feature MD links.code
- `src/core/prerequisites.ts` — src/core/prerequisites.ts is not referenced by any feature MD links.code
- `src/core/prompt-stdin.ts` — src/core/prompt-stdin.ts is not referenced by any feature MD links.code
- `src/core/review-profile.ts` — src/core/review-profile.ts is not referenced by any feature MD links.code
- `src/invariants/rule-pairs.ts` — src/invariants/rule-pairs.ts is not referenced by any feature MD links.code
- `src/release/clean-tree.ts` — src/release/clean-tree.ts is not referenced by any feature MD links.code

### Test files without @tests: tag

- `src/core/__tests__/init-gitignore.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/core/__tests__/prerequisites.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)
- `src/garden/detectors/__tests__/circular-blocked-by.test.ts` — missing required `// @tests: <slug>` tag (validator hard-fails on this)

### Done features without code

- `noldor-package-lift` — Noldor Package Lift (tooling) has no entries in links.code
- `scripts-reorganization-by-feature-area` — Scripts Reorganization By Feature/Area (tooling) has no entries in links.code
- `self-boundaries-declaration-and-cycle-break` — Self-Boundaries Declaration and Cycle Break (tooling) has no entries in links.code
- `trailer-scope-alias-map` — Trailer Scope-Alias Map (tooling) has no entries in links.code
