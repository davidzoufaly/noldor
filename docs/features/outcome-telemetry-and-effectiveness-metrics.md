---
area: tooling
category: Tooling
deps:
  - agent-events-log-and-agents-dashboard-page
links:
  code:
    - src/metrics/
    - src/cli/manifest.ts
    - src/dashboard/
    - src/garden/
    - docs/noldor/metrics.md
    - docs/noldor/script-catalog.md
  tests:
    - src/core/agent-runner/usage/__tests__/adapters.test.ts
    - src/dashboard/__tests__/metrics-view.test.ts
    - src/features/__tests__/feature-schema-since.test.ts
    - src/garden/__tests__/sdd-report-metrics.test.ts
    - src/metrics/__tests__/compute-cli.test.ts
    - src/metrics/__tests__/compute.test.ts
    - src/metrics/__tests__/cr-and-override.test.ts
    - src/metrics/__tests__/cycle-time.test.ts
    - src/metrics/__tests__/drain-and-tokens.test.ts
    - src/metrics/__tests__/facts.test.ts
    - src/metrics/__tests__/routing-accuracy.test.ts
  spec: >-
    docs/superpowers/specs/2026-06-12-outcome-telemetry-and-effectiveness-metrics-design.md
  plan: >-
    docs/superpowers/plans/2026-06-12-outcome-telemetry-and-effectiveness-metrics.md
name: Outcome Telemetry and Effectiveness Metrics
packages:
  - scripts
phase: done
since: '2026-06-11'
noldor-tier: full
---
## Summary

The framework enforces process and never measures whether the process works. Every tuning decision (gate strictness, size-routing thresholds, CR lane composition, drain retry caps) is currently vibes. The raw data already exists — git trailers, FD frontmatter (`since` / `introduced` / `phase`), PR history, drain logs, and (once shipped) agent-events. Build the derivation layer.

**What to do:**

- Metric set v1, each derived reproducibly from repo history + `.noldor/` artifacts:
  - **Cycle time** — `since:` (roadmap intake) → `introduced:` (release) per FD; segmented by path (`Noldor-Path:` trailer) and by autonomous vs operator-driven.
  - **Size-routing accuracy** — `sizeToPath()` suggestion vs actual: diff stats + path taken per shipped entry; surfaces systematic over/under-sizing at triage.
  - **CR effectiveness** — findings per lane (from `.noldor/cr/` artifacts) vs post-merge corrective commits (`fix:` touching same FD within N days) and reverts; approximates catch-rate vs noise.
  - **Drain reliability** — per-run: shipped / skipped / retried / escalated / salvaged counts, retry distribution, mean time per feature (from agent-events once shipped; dep `agent-events-log-and-agents-dashboard-page` is unshipped — v1 derives what it can from existing drain logs and labels the rest pending).
  - **Override pressure** — trailer-override usage by detector over time (extends the existing override-audit data); rising overrides = a gate that fights the team.
  - **Tokens per feature** — raw token counts, not cost. Include only where reliably measurable (real usage data from the runner, never estimated/hallucinated) across all runner modes: Claude Code, codex, opencode. Schema reserves the field; runners without trustworthy usage data emit no value.
- `noldor metrics compute` CLI: scans history, emits `metrics.json` (derive-on-demand; no persistent aggregate store in v1 — git is the store, computation is the cache).
- Dashboard `/metrics` page: headline cards (median cycle time, autonomous-ship share, drain success rate), per-path breakdown table, trend over releases. Reuses the `/agents` data plumbing.
- Release integration: `sdd-report.md` gains a metrics section per release cut, so every release answers "is the framework getting faster/safer or just heavier".
- Honesty rails: every metric documents its derivation + known blind spots in `docs/noldor/` (e.g. CR catch-rate is an approximation); no metric without a documented formula — this framework audits itself, the metrics must be auditable too.

**What it enables:** gate tuning with data (e.g. "fast-track reverts ≈ full-path reverts → loosen routing"); a testable version of the vision claim "agents ship production-quality changes unsupervised"; the adoption pitch for other projects becomes numbers ("N features, X% fully autonomous, median 2 days intake→release") instead of assertion.

**Open questions:** token source per runner (Claude Code transcript JSONL? codex/opencode equivalents? drain could record usage per spawn into agent-events); how far back to backfill (pre-event-log history supports cycle-time + routing metrics only — fine, label it); metric stability across the consumer/self-host split (compute per-repo, never blended).

**Acceptance sketch:** `noldor metrics compute` on this repo emits cycle-time for every `introduced:` FD + routing-accuracy table for the last 10 shipped entries; `/metrics` renders headline cards; sdd-report section appears at next release.

## User Story

As an operator tuning an agent-driven repo, I want every framework-effectiveness claim derived reproducibly from repo history — cycle time, routing accuracy, CR catch-rate, drain reliability, override pressure, raw tokens per feature — so that gate and autonomy tuning decisions (and the adoption pitch) rest on auditable numbers instead of vibes.

## Usage

**CLI**

```bash
# derive all metrics from repo history + .noldor artifacts
pnpm noldor metrics compute            # human table + metrics.json
pnpm noldor metrics compute --json out.json
pnpm noldor metrics compute --metric cycle-time
```

**Dashboard**

1. Run `pnpm noldor dashboard server`.
2. Open `http://localhost:4321/metrics` — headline cards, per-path breakdown, per-release trend, formula + blind-spots expander per metric.

**Release**

- `sdd-report.md` gains a Metrics section automatically at each release cut; compute failure degrades to a labeled unavailable-line.

## PRs

<!-- @prs-since-last-release: outcome-telemetry-and-effectiveness-metrics -->

## Changelog
