---
noldor-page: metrics
introduced: 0.5.0
---

# Metrics

Effectiveness metrics derived reproducibly from repo history + `.noldor/` artifacts. Derive-on-demand: git is the store, computation is the cache — no persistent aggregate file. Honesty rails: **no metric without a documented formula**; the collectors' `formula` / `blindSpots` fields (`src/metrics/collect/*.ts`) are canonical and this page mirrors them. A unit test (`src/metrics/__tests__/compute.test.ts`) rejects any collector with an empty formula or blind-spot list.

Surfaces: `pnpm noldor metrics compute` (stdout table + `metrics.json`, gitignored), dashboard `/metrics`, and the `## Metrics` section of `docs/sdd-report.md` at release cut (fail-open — compute failure renders a labeled unavailable line, never blocks release).

## cycle-time

- **Formula:** days(intake → release): intake = FD frontmatter `since` else roadmap-history recovery; release = creator date of tag `v<introduced>`. Median + p90 over FDs with both endpoints.
- **Sources:** `docs/features/*.md` frontmatter (`since`, `introduced`), roadmap/backlog git history (`intake[]` recovery), git tags.
- **Blind spots:** FDs with unrecoverable intake or an `introduced` version without a matching v-tag are excluded (tallied, not silent). Provenance segmentation approximates: autonomous = any agent-event for the slug; pre-event-log autonomous ships read as operator/unknown. Pre-`Noldor-Path` commits segment as `unknown`.
- **Epoch limits:** intake recovery covers all roadmap/backlog history; `since` frontmatter starts 2026-06-12 (promote copies it forward from then on).

## routing-accuracy

- **Formula:** `sizeToPath(intake.size, intake.parent != null)` vs first `Noldor-Path` trailer of the FD's commits, over the last 10 shipped FDs (by release-tag date).
- **Sources:** roadmap-history recovery (`size`, `parent`), commit trailers, git tags.
- **Blind spots:** entries whose roadmap size/parent could not be recovered, or whose commits predate the `Noldor-Path` trailer, are excluded (counted). First-trailer-wins: mixed-path features are judged by their first commit path.

## cr-effectiveness

- **Formula:** per-lane blockers+suggestions from `.noldor/cr` LaneFindings vs `fix:`/`revert:` commits carrying the same `Noldor-FD` within 14 days after the FD's release-tag date.
- **Sources:** `.noldor/cr/*.json` (+ `archive/`), commit subjects + trailers, git tags.
- **Blind spots:** approximation — corrective commits are attributed by trailer + subject prefix; refactors that silently fix, or fixes without the FD trailer, are invisible. CR sinks are operator-local and pruned/archived — historical lanes may be missing entirely.

## drain-reliability

- **Formula:** lastRun: shipped/skip/retries from `.noldor/drain-state.json` (live snapshot, overwritten per run). history: salvaged = agent-events `kind=salvaged`; escalated = `escalations.jsonl` counts (total/per-slug — rows carry no run id); mean duration over all agent-events.
- **Sources:** `.noldor/drain-state.json`, `.noldor/agent-events.jsonl`, `.noldor/escalations.jsonl`.
- **Blind spots:** `drain-state.json` is the LATEST run only — it cannot yield per-run history or trends. Event/escalation history starts at the event-log epoch (2026-06-12). `EscalationRow` has no run identifier — per-run escalation grouping is not derivable (run-id is out of v1 scope).

## override-pressure

- **Formula:** count of commits carrying a Noldor-Override-prefixed trailer, grouped by trailer key and by release window (first tag dated >= commit date; after last tag → unreleased).
- **Sources:** commit trailers, git tags.
- **Blind spots:** only trailer-carrying overrides count; env-var bypasses (the release-skip env flags) leave no commit trace. Rising counts can mean a stricter gate OR more violations — the metric flags friction, not fault.

## tokens-per-feature

- **Formula:** sum of agent-event `tokens.total` per slug. Tokens are read verbatim from runner usage records (`claude-jsonl` / `codex-session` / `opencode-session`); events without trustworthy usage carry no tokens.
- **Sources:** `.noldor/agent-events.jsonl` `tokens` field, filled at spawn time by per-runner usage adapters (`src/core/agent-runner/usage/`).
- **Blind spots:** `null` = no usage data, not zero usage — operator-driven interactive sessions and runners without locatable usage records are invisible. Only spawn-captured agents count; epoch-limited to when token capture shipped (2026-06-12).

### Tokens: hard rules

Raw counts only — **never cost**, no currency anywhere in the pipeline. Adapters return numbers read verbatim from the runner's own usage records (Claude Code session JSONL `usage` fields; codex session-store `token_count` records; opencode message-store `tokens`). No estimation, no tokenizer fallback, no text-length heuristics: an unlocatable or unparseable record yields `null`. Measuring nothing beats hallucinating something.
