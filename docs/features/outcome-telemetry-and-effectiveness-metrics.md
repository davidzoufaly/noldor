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
    - src/core/__tests__/feature-schema-since.test.ts
    - src/core/agent-runner/usage/__tests__/adapters.test.ts
    - src/dashboard/__tests__/api-blocks.test.ts
    - src/dashboard/__tests__/dashboard-data.test.ts
    - src/dashboard/__tests__/dashboard-doc-surfaces.test.ts
    - src/dashboard/__tests__/dashboard-ensure.test.ts
    - src/dashboard/__tests__/dashboard-graph-health.test.ts
    - src/dashboard/__tests__/dashboard-layout-body-styles.test.ts
    - src/dashboard/__tests__/dashboard-layout-style-polish.test.ts
    - src/dashboard/__tests__/dashboard-mermaid.test.ts
    - src/dashboard/__tests__/dashboard-release-notes.test.ts
    - src/dashboard/__tests__/dashboard-render-markdown.test.ts
    - src/dashboard/__tests__/dashboard-server.test.ts
    - src/dashboard/__tests__/dashboard-skills.test.ts
    - src/dashboard/__tests__/dashboard-test-pyramid.test.ts
    - src/dashboard/__tests__/dashboard-views.test.ts
    - src/dashboard/__tests__/dashboard-worktrees.test.ts
    - src/dashboard/__tests__/edge-scroll.test.ts
    - src/dashboard/__tests__/metrics-view.test.ts
    - src/dashboard/__tests__/milestones-view.test.ts
    - src/dashboard/__tests__/server-cli.test.ts
    - src/features/__tests__/propose-pointers.test.ts
    - src/garden/__tests__/backlog-demote.test.ts
    - src/garden/__tests__/garden-detect-runner.test.ts
    - src/garden/__tests__/garden-detect.test.ts
    - src/garden/__tests__/garden-receipt.test.ts
    - src/garden/__tests__/graph-fd-lookup.test.ts
    - src/garden/__tests__/plan-resolution.test.ts
    - src/garden/__tests__/sdd-report-metrics.test.ts
    - src/garden/__tests__/sdd-report.test.ts
    - src/garden/detectors/__tests__/allowlist-drift.test.ts
    - src/garden/detectors/__tests__/bootstrap-override-audit.test.ts
    - src/garden/detectors/__tests__/branch-protection.test.ts
    - src/garden/detectors/__tests__/code-links-drift.test.ts
    - src/garden/detectors/__tests__/codex-cr-override-audit.test.ts
    - src/garden/detectors/__tests__/fd-without-plan.test.ts
    - src/garden/detectors/__tests__/migration-coverage.test.ts
    - src/garden/detectors/__tests__/milestone-shipped-incomplete.test.ts
    - src/garden/detectors/__tests__/override-audit.test.ts
    - src/garden/detectors/__tests__/plan-without-fd.test.ts
    - src/garden/detectors/__tests__/tier-mismatch.test.ts
    - src/garden/detectors/__tests__/trailer-scope-mismatch.test.ts
    - src/metrics/__tests__/compute-cli.test.ts
    - src/metrics/__tests__/compute.test.ts
    - src/metrics/__tests__/cr-and-override.test.ts
    - src/metrics/__tests__/cycle-time.test.ts
    - src/metrics/__tests__/drain-and-tokens.test.ts
    - src/metrics/__tests__/facts.test.ts
    - src/metrics/__tests__/routing-accuracy.test.ts
    - src/release/__tests__/sdd-report-diff.test.ts
    - src/worktrees/__tests__/worktree-conflicts.test.ts
  spec: >-
    docs/superpowers/specs/archive/2026-06-12-outcome-telemetry-and-effectiveness-metrics-design.md
  plan: >-
    docs/superpowers/plans/archive/2026-06-12-outcome-telemetry-and-effectiveness-metrics.md
name: Outcome Telemetry and Effectiveness Metrics
packages:
  - scripts
phase: done
since: '2026-06-11'
noldor-tier: full
introduced: 0.4.0
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
2. Open `http://localhost:4321/metrics` — headline counter-strip (median/p90 cycle time, autonomous share, drain shipped last run), metric cards grouped Delivery / Quality / Autonomy (bar tables, counters, confusion matrix), formula + blind-spots expander per card, labeled "no data yet" empty-states; unknown metric ids degrade to a generic JSON card under Other.

**Release**

- `sdd-report.md` gains a Metrics section automatically at each release cut; compute failure degrades to a labeled unavailable-line.

## PRs

<!-- @prs-since-last-release: outcome-telemetry-and-effectiveness-metrics -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-06-12-outcome-telemetry-and-effectiveness-metrics-design.md`](../../docs/superpowers/specs/archive/2026-06-12-outcome-telemetry-and-effectiveness-metrics-design.md)
- **Plan:**
  - [`docs/superpowers/plans/archive/2026-06-12-outcome-telemetry-and-effectiveness-metrics.md`](../../docs/superpowers/plans/archive/2026-06-12-outcome-telemetry-and-effectiveness-metrics.md)
- **Code:**
  - [`src/metrics/`](../../src/metrics/)
  - [`src/cli/manifest.ts`](../../src/cli/manifest.ts)
  - [`src/dashboard/`](../../src/dashboard/)
  - [`src/garden/`](../../src/garden/)
  - [`docs/noldor/metrics.md`](../../docs/noldor/metrics.md)
  - [`docs/noldor/script-catalog.md`](../../docs/noldor/script-catalog.md)
- **Tests:**
  - [`src/core/__tests__/feature-schema-since.test.ts`](../../src/core/__tests__/feature-schema-since.test.ts)
  - [`src/core/agent-runner/usage/__tests__/adapters.test.ts`](../../src/core/agent-runner/usage/__tests__/adapters.test.ts)
  - [`src/dashboard/__tests__/api-blocks.test.ts`](../../src/dashboard/__tests__/api-blocks.test.ts)
  - [`src/dashboard/__tests__/dashboard-data.test.ts`](../../src/dashboard/__tests__/dashboard-data.test.ts)
  - [`src/dashboard/__tests__/dashboard-doc-surfaces.test.ts`](../../src/dashboard/__tests__/dashboard-doc-surfaces.test.ts)
  - [`src/dashboard/__tests__/dashboard-ensure.test.ts`](../../src/dashboard/__tests__/dashboard-ensure.test.ts)
  - [`src/dashboard/__tests__/dashboard-graph-health.test.ts`](../../src/dashboard/__tests__/dashboard-graph-health.test.ts)
  - [`src/dashboard/__tests__/dashboard-layout-body-styles.test.ts`](../../src/dashboard/__tests__/dashboard-layout-body-styles.test.ts)
  - [`src/dashboard/__tests__/dashboard-layout-style-polish.test.ts`](../../src/dashboard/__tests__/dashboard-layout-style-polish.test.ts)
  - [`src/dashboard/__tests__/dashboard-mermaid.test.ts`](../../src/dashboard/__tests__/dashboard-mermaid.test.ts)
  - [`src/dashboard/__tests__/dashboard-release-notes.test.ts`](../../src/dashboard/__tests__/dashboard-release-notes.test.ts)
  - [`src/dashboard/__tests__/dashboard-render-markdown.test.ts`](../../src/dashboard/__tests__/dashboard-render-markdown.test.ts)
  - [`src/dashboard/__tests__/dashboard-server.test.ts`](../../src/dashboard/__tests__/dashboard-server.test.ts)
  - [`src/dashboard/__tests__/dashboard-skills.test.ts`](../../src/dashboard/__tests__/dashboard-skills.test.ts)
  - [`src/dashboard/__tests__/dashboard-test-pyramid.test.ts`](../../src/dashboard/__tests__/dashboard-test-pyramid.test.ts)
  - [`src/dashboard/__tests__/dashboard-views.test.ts`](../../src/dashboard/__tests__/dashboard-views.test.ts)
  - [`src/dashboard/__tests__/dashboard-worktrees.test.ts`](../../src/dashboard/__tests__/dashboard-worktrees.test.ts)
  - [`src/dashboard/__tests__/edge-scroll.test.ts`](../../src/dashboard/__tests__/edge-scroll.test.ts)
  - [`src/dashboard/__tests__/metrics-view.test.ts`](../../src/dashboard/__tests__/metrics-view.test.ts)
  - [`src/dashboard/__tests__/milestones-view.test.ts`](../../src/dashboard/__tests__/milestones-view.test.ts)
  - [`src/dashboard/__tests__/server-cli.test.ts`](../../src/dashboard/__tests__/server-cli.test.ts)
  - [`src/features/__tests__/propose-pointers.test.ts`](../../src/features/__tests__/propose-pointers.test.ts)
  - [`src/garden/__tests__/backlog-demote.test.ts`](../../src/garden/__tests__/backlog-demote.test.ts)
  - [`src/garden/__tests__/garden-detect-runner.test.ts`](../../src/garden/__tests__/garden-detect-runner.test.ts)
  - [`src/garden/__tests__/garden-detect.test.ts`](../../src/garden/__tests__/garden-detect.test.ts)
  - [`src/garden/__tests__/garden-receipt.test.ts`](../../src/garden/__tests__/garden-receipt.test.ts)
  - [`src/garden/__tests__/graph-fd-lookup.test.ts`](../../src/garden/__tests__/graph-fd-lookup.test.ts)
  - [`src/garden/__tests__/plan-resolution.test.ts`](../../src/garden/__tests__/plan-resolution.test.ts)
  - [`src/garden/__tests__/sdd-report-metrics.test.ts`](../../src/garden/__tests__/sdd-report-metrics.test.ts)
  - [`src/garden/__tests__/sdd-report.test.ts`](../../src/garden/__tests__/sdd-report.test.ts)
  - [`src/garden/detectors/__tests__/allowlist-drift.test.ts`](../../src/garden/detectors/__tests__/allowlist-drift.test.ts)
  - [`src/garden/detectors/__tests__/bootstrap-override-audit.test.ts`](../../src/garden/detectors/__tests__/bootstrap-override-audit.test.ts)
  - [`src/garden/detectors/__tests__/branch-protection.test.ts`](../../src/garden/detectors/__tests__/branch-protection.test.ts)
  - [`src/garden/detectors/__tests__/code-links-drift.test.ts`](../../src/garden/detectors/__tests__/code-links-drift.test.ts)
  - [`src/garden/detectors/__tests__/codex-cr-override-audit.test.ts`](../../src/garden/detectors/__tests__/codex-cr-override-audit.test.ts)
  - [`src/garden/detectors/__tests__/fd-without-plan.test.ts`](../../src/garden/detectors/__tests__/fd-without-plan.test.ts)
  - [`src/garden/detectors/__tests__/migration-coverage.test.ts`](../../src/garden/detectors/__tests__/migration-coverage.test.ts)
  - [`src/garden/detectors/__tests__/milestone-shipped-incomplete.test.ts`](../../src/garden/detectors/__tests__/milestone-shipped-incomplete.test.ts)
  - [`src/garden/detectors/__tests__/override-audit.test.ts`](../../src/garden/detectors/__tests__/override-audit.test.ts)
  - [`src/garden/detectors/__tests__/plan-without-fd.test.ts`](../../src/garden/detectors/__tests__/plan-without-fd.test.ts)
  - [`src/garden/detectors/__tests__/tier-mismatch.test.ts`](../../src/garden/detectors/__tests__/tier-mismatch.test.ts)
  - [`src/garden/detectors/__tests__/trailer-scope-mismatch.test.ts`](../../src/garden/detectors/__tests__/trailer-scope-mismatch.test.ts)
  - [`src/metrics/__tests__/compute-cli.test.ts`](../../src/metrics/__tests__/compute-cli.test.ts)
  - [`src/metrics/__tests__/compute.test.ts`](../../src/metrics/__tests__/compute.test.ts)
  - [`src/metrics/__tests__/cr-and-override.test.ts`](../../src/metrics/__tests__/cr-and-override.test.ts)
  - [`src/metrics/__tests__/cycle-time.test.ts`](../../src/metrics/__tests__/cycle-time.test.ts)
  - [`src/metrics/__tests__/drain-and-tokens.test.ts`](../../src/metrics/__tests__/drain-and-tokens.test.ts)
  - [`src/metrics/__tests__/facts.test.ts`](../../src/metrics/__tests__/facts.test.ts)
  - [`src/metrics/__tests__/routing-accuracy.test.ts`](../../src/metrics/__tests__/routing-accuracy.test.ts)
  - [`src/release/__tests__/sdd-report-diff.test.ts`](../../src/release/__tests__/sdd-report-diff.test.ts)
  - [`src/worktrees/__tests__/worktree-conflicts.test.ts`](../../src/worktrees/__tests__/worktree-conflicts.test.ts)

<!-- /generated: resources -->
