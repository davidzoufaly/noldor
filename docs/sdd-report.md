<!-- generated: do-not-edit -->

# SDD Report

Generated: 2026-07-13 by `pnpm sdd:report`.

Pre-MVP done features (`introduced` < `0.2.0`) are
grandfathered from `links.spec` / `links.code` checks.
Bump `MIN_ENFORCED_VERSION` in `scripts/garden/sdd-report.ts` once backfill is done.

## Summary

- Total features: 71
- Untriaged ideas: 0
- Backlog entries: 4
- Gap categories with issues: 7 / 14

## Code clones

- 236 clone group(s), 13.75% duplicated tokens across 283 file(s)
- src/garden/garden-detect.ts:97-203 and src/garden/garden-detect.ts:220-326 (388 tokens)
- src/dashboard/views.ts:748-799 and src/dashboard/views.ts:826-925 (269 tokens)
- src/dashboard/data.ts:1058-1089 and src/garden/sdd-report.ts:908-943 (259 tokens)
- src/dashboard/views.ts:667-676 and src/dashboard/views.ts:935-944 (252 tokens)
- src/sync/sync-code-links.ts:13-59 and src/sync/sync-test-links.ts:8-56 (227 tokens)

## Metrics

### cycle-time [days]

```json
{
  "medianDays": 25.8,
  "p90Days": 57.5,
  "medianByPath": {
    "unknown": 26.5,
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
    "subagent": {
      "blockers": 16,
      "suggestions": 31
    },
    "verify": {
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
  "lastRun": null,
  "history": {
    "salvaged": 0,
    "escalatedTotal": 0,
    "escalatedBySlug": {},
    "meanDurationMs": 149460
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
{}
```

formula: Sum of agent-event tokens.total per slug. Tokens are read verbatim from runner usage records (claude-jsonl / codex-session / opencode-session); events without trustworthy usage carry no tokens.
blind spots: null = no usage data, not zero usage: operator-driven interactive sessions and runners without locatable usage records are invisible. | Only spawn-captured agents count; epoch-limited to when token capture shipped.

## Gap details

### Done features without tests

- `memory-intake-lessons-learned-pipeline` — Memory-Intake / Lessons-Learned Pipeline (tooling) has no tests in links.tests
- `trailer-scope-alias-map` — Trailer Scope-Alias Map (tooling) has no tests in links.tests

### Done features without docs

- `continuous-drain-daemon-and-escalation-inbox` — Continuous Drain Daemon and Escalation Inbox (tooling) has no entries in links.docs
- `make-noldor-agent-agnostic` — Make Noldor Agent-Agnostic (tooling) has no entries in links.docs

### Done features missing introduced

- `code-clone-detector` — Code-Clone Detector is phase=done but introduced is unset (release script should fill on next pnpm release)
- `dashboard-blocked-by-graph-view` — Dashboard Blocked-By Graph View is phase=done but introduced is unset (release script should fill on next pnpm release)
- `dashboard-broken-pages-audit` — Dashboard Broken-Pages Audit is phase=done but introduced is unset (release script should fill on next pnpm release)
- `memory-intake-lessons-learned-pipeline` — Memory-Intake / Lessons-Learned Pipeline is phase=done but introduced is unset (release script should fill on next pnpm release)
- `skill-vs-code-drift-detector` — Skill-vs-Code Drift Detector is phase=done but introduced is unset (release script should fill on next pnpm release)

### Plans without matching spec

- `docs/superpowers/plans/2026-06-07-end-of-flow-ergonomics.md` — docs/superpowers/plans/2026-06-07-end-of-flow-ergonomics.md has slug "end-of-flow-ergonomics" with no matching spec under docs/superpowers/specs/

### Code files not referenced by any feature

- `src/core/fmt-guard-cli.ts` — src/core/fmt-guard-cli.ts is not referenced by any feature MD links.code
- `src/core/fmt-guard.ts` — src/core/fmt-guard.ts is not referenced by any feature MD links.code
- `src/core/init-gitignore.ts` — src/core/init-gitignore.ts is not referenced by any feature MD links.code
- `src/core/lanes.ts` — src/core/lanes.ts is not referenced by any feature MD links.code
- `src/core/prerequisites.ts` — src/core/prerequisites.ts is not referenced by any feature MD links.code
- `src/core/prompt-stdin.ts` — src/core/prompt-stdin.ts is not referenced by any feature MD links.code
- `src/core/review-profile.ts` — src/core/review-profile.ts is not referenced by any feature MD links.code
- `src/invariants/rule-pairs.ts` — src/invariants/rule-pairs.ts is not referenced by any feature MD links.code
- `src/release/clean-tree.ts` — src/release/clean-tree.ts is not referenced by any feature MD links.code

### Tests with incomplete co-tag

- `graphify-out/graph.json` — Co-tag detector ran in degraded mode: graphify-out/graph.json regen 2026-07-13, latest source mtime 2026-07-13. Run /graphify + pnpm toon (preferred) or perform a manual co-tag audit: for each .test.ts file under packages/ or apps/src/, grep imports → check which FDs own those files via links.code → propose missing co-tags.

### Done features without code

- `dashboard-blocked-by-graph-view` — Dashboard Blocked-By Graph View (tooling) has no entries in links.code
- `dashboard-broken-pages-audit` — Dashboard Broken-Pages Audit (tooling) has no entries in links.code
- `memory-intake-lessons-learned-pipeline` — Memory-Intake / Lessons-Learned Pipeline (tooling) has no entries in links.code
- `noldor-package-lift` — Noldor Package Lift (tooling) has no entries in links.code
- `scripts-reorganization-by-feature-area` — Scripts Reorganization By Feature/Area (tooling) has no entries in links.code
- `self-boundaries-declaration-and-cycle-break` — Self-Boundaries Declaration and Cycle Break (tooling) has no entries in links.code
- `skill-vs-code-drift-detector` — Skill-vs-Code Drift Detector (tooling) has no entries in links.code
- `trailer-scope-alias-map` — Trailer Scope-Alias Map (tooling) has no entries in links.code
