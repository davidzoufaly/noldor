# Metrics Page UI Improvements — Design

**Slug:** metrics-page-ui (enhancement on `outcome-telemetry-and-effectiveness-metrics`)
**FD:** docs/features/outcome-telemetry-and-effectiveness-metrics.md
**Date:** 2026-07-13
**Tier:** specs-only (attach)
**Deps:** none

## Problem

The `/metrics` dashboard page renders every metric as a raw `JSON.stringify` dump inside a `<pre>` (`renderMetrics`, `src/dashboard/views.ts:1697`). The parent FD promised "headline cards (median cycle time, autonomous-ship share, drain success rate), per-path breakdown table" — none of that shipped as actual UI. Six metrics (`cycle-time`, `routing-accuracy`, `cr-effectiveness`, `drain-reliability`, `override-pressure`, `tokens-per-feature`) each have a stable, known value shape (see `src/metrics/collect/*.ts`), yet the page shows undifferentiated JSON. Empty metrics render as `{}` — indistinguishable from broken.

## Goals

- Page-top headline counter-strip: median cycle time, p90 cycle time, autonomous-ship share, drain last-run shipped count.
- Per-metric bespoke renderers for all 6 metric ids — tables, bar rows, and counters instead of JSON dumps.
- Metrics grouped into three titled sections: **Delivery** (cycle-time, routing-accuracy), **Quality** (cr-effectiveness, override-pressure), **Autonomy** (drain-reliability, tokens-per-feature).
- Explicit, labeled empty-state per metric ("no data yet — …hint…") instead of `{}` / `null` dumps.
- Keep the formula + blind-spots `<details>` expander on every metric card (honesty rail — existing test contract).
- Unknown/future metric ids render via the current generic JSON fallback — the page never breaks on a new collector.
- Zero new dependencies; reuse existing dashboard primitives (`counter-strip`/`counter`, `.bar` rows, `card`, `muted`, tables) already used by `/velocity` (`renderVelocity`, `src/dashboard/views.ts:1127`) and `/agents`.

## Non-goals

- No collector/compute changes — `src/metrics/collect/*` and `MetricsReport`/`MetricResult` types stay untouched. View-layer only.
- No trend-over-releases section (needs per-release data the cycle-time samples don't carry; deferred until a collector change is on the table).
- No client-side JS, no chart library, no new static assets.
- No route/API changes — `handleMetrics` (`src/dashboard/server.ts:793`, route-map registration at `server.ts:134`) and `data.ts` plumbing unchanged.
- No changes to `noldor metrics compute` CLI output.

## Design

All changes live in `src/dashboard/views.ts` (plus its test file). `renderMetrics(report: MetricsReport | null): string` keeps its exact signature — `server.ts` and `data.ts` are untouched.

### Unit 1 — `renderMetricsHeadline(report: MetricsReport): string`

Counter-strip (same markup idiom as `renderVelocity`'s `counter-strip`): four counters derived read-only from the report:

- **median cycle (d)** — `cycle-time` `value.medianDays`.
- **p90 cycle (d)** — `cycle-time` `value.p90Days`.
- **autonomous share** — % of `cycle-time` `samples` with `provenance === 'autonomous'` (shape per `Row` in `src/metrics/collect/cycle-time.ts`); `—` when zero samples.
- **drain shipped (last run)** — `drain-reliability` `value.lastRun.shipped`; `—` when `lastRun === null`.

Any missing metric id or malformed value → `—` for that counter (never throws). Median/p90 counters also render `—` when `samples.length === 0`: `percentile([])` returns `0`, and a literal "0 d" would be indistinguishable from a genuine zero-day median.

### Unit 2 — per-metric renderers + dispatch

`const METRIC_RENDERERS: Record<string, (m: MetricResult) => string>` keyed by metric id. `renderMetrics` walks a fixed group layout `[['Delivery', ['cycle-time','routing-accuracy']], ['Quality', ['cr-effectiveness','override-pressure']], ['Autonomy', ['drain-reliability','tokens-per-feature']]]`, rendering `<h2>` per group and a `card` per metric present in the report. Metrics in the report but not in the layout render in a trailing **Other** group via `renderGenericMetric` (the current `<pre>` JSON body). Each renderer body is wrapped in a try/catch: value shapes are `unknown` at the type level, so a shape mismatch (collector drift) falls back to `renderGenericMetric` instead of a 500.

Per-metric bodies (shapes verified against `src/metrics/collect/*.ts`):

- **cycle-time** — inline counters (median / p90 days, excluded tally `noIntake`/`noTag` as a muted line) + `medianByPath` bar table + samples table (slug / days / path / provenance) inside the details expander alongside formula.
- **routing-accuracy** — headline `matches/total (last <window> shipped)` + confusion matrix table: rows = suggested path, columns = actual path, cell = count (from `value.table`); muted excluded count. Empty when `total === 0`.
- **cr-effectiveness** — per-lane table (lane / blockers / suggestions with bar on blockers) from `value.perLane` + corrective-commits table (slug / count) from `value.correctiveBySlug`, captioned with `windowDays`.
- **drain-reliability** — last-run counters (shipped / skipped / retried) or empty-state when `lastRun === null`; history block (salvaged, escalatedTotal, mean duration via existing `formatAgentDuration`) + `escalatedBySlug` table, or empty-state when `history === null`.
- **override-pressure** — table: rows = release window in bucket-insertion order (commit-iteration order per `collectOverridePressure` — deliberately NOT relabeled as chronological), columns = trailer keys, cell = count; per-window total bar. Empty when no buckets.
- **tokens-per-feature** — bar table of per-slug totals (numeric entries only), plus a muted list of slugs with `null` ("no usage data"). Empty when object is empty.

### Unit 3 — shared `barTable` helper

`renderVelocity` has a local `bars(title, data)` closure (`src/dashboard/views.ts:1136`). Lift it to a module-level `barTable(title: string, data: Record<string, number>): string` and reuse from both `renderVelocity` and the new metric renderers — identical markup (`<table>` rows with `.bar` divs, right-aligned counts), no behavior change for `/velocity`.

### Escaping contract (all new markup)

Every repo-derived string interpolated by the new renderers — slugs, `Noldor-Path` values, CR lane names, override trailer keys, provenance labels, sample-row fields, empty-state hints containing data — passes through the existing `escapeHtml` helper before entering markup, matching the current `renderMetrics`/`renderVelocity` posture (`escapeHtml` is used on every interpolation in `src/dashboard/views.ts`). Only compile-time string literals and formatted numbers may be interpolated raw. A dedicated test feeds a report containing a `<script>`-bearing slug and lane name and asserts the output contains the escaped form and not the raw tag.

### Unit 4 — empty-state helper

`metricEmpty(hint: string): string` → `<p class="muted">no data yet — ${hint}</p>`. Hints name the data source, e.g. cr-effectiveness: "no `.noldor/cr` lane findings in this checkout"; tokens-per-feature: "no agent-events with usage records".

### Data flow (unchanged)

`handleMetrics` (`src/dashboard/server.ts`) → `data.ts` `compute` (`src/metrics/compute.js`) → `renderMetrics(report)`. Null report keeps the existing degraded card ("metrics unavailable: compute failed…").

### Error handling

- `report === null` → unchanged degraded card (existing test).
- Renderer throw (value-shape drift) → per-metric generic JSON fallback; page still renders.
- Missing metric for a headline counter → `—`.

### Testing

Extend `src/dashboard/__tests__/metrics-view.test.ts` (carries `// @tests:` tag header per self-host rule):

- headline strip renders median/p90/autonomous-share/drain counters from a populated report; `—` fallbacks on missing metrics.
- one populated-body assertion per metric renderer (e.g. cycle-time bar table contains path label; routing confusion matrix contains suggested path; override table contains trailer key).
- empty-value report (`{}` / `null` / zero totals) → labeled empty-states, no `{}` in output; zero-sample cycle-time → `—` headline counters.
- escaping: `<`-bearing slug/lane in a populated report renders escaped (`&lt;`), raw tag absent.
- unknown metric id → generic `<pre>` fallback under Other group.
- existing tests stay green (formula + blind-spots text still present; null-report degraded state unchanged).
- `barTable` extraction: `/velocity` snapshot-ish assertions in `dashboard-views.test.ts` still pass unchanged.

## Acceptance criteria

- `/metrics` shows a page-top counter-strip with median cycle, p90, autonomous share, drain last-run shipped; `—` for unavailable values.
- No metric renders raw `JSON.stringify` when its value matches the known collector shape; all 6 ids have bespoke bodies grouped under Delivery / Quality / Autonomy.
- Every metric card retains the formula + blind-spots expander.
- All repo-derived strings in new markup are `escapeHtml`-escaped (escaping test green).
- Empty metrics render a labeled "no data yet" line — the string `{}` appears nowhere on the page.
- A metric id absent from the layout map still renders (generic fallback, Other group).
- `pnpm vitest run src/dashboard/__tests__/metrics-view.test.ts` green; full dashboard test suite green; `/velocity` output unchanged.

## Risks / trade-offs

- **Collector drift risk:** bespoke renderers hard-code value shapes; a collector change could silently degrade a card to the JSON fallback. Mitigated by try/catch fallback (page never breaks) and by tests importing the same shapes.
- **Headline duplication:** autonomous share is derived in the view from cycle-time samples rather than computed by a collector — a second derivation site. Accepted for view-only scope; noted for a future collector-owned headline block.
- **No trend view:** the FD's "trend over releases" promise stays unmet in this pass (deferred, needs collector data).

## User Story

As an operator reviewing framework effectiveness, I want the `/metrics` page to render each metric as purpose-built cards, tables, and bars grouped by theme, so that I can read cycle time, routing accuracy, CR effectiveness, and drain reliability at a glance instead of parsing raw JSON dumps.

## Usage

1. Run `pnpm noldor dashboard server`.
2. Open `http://localhost:4321/metrics`.
3. Read the headline counter-strip (median/p90 cycle time, autonomous share, drain last-run shipped), then the Delivery / Quality / Autonomy sections; expand "formula + blind spots" on any card for the derivation; empty metrics state their missing data source.

## Open questions (resolved)

1. *Where does "drain success rate" (FD headline promise) come from when `drain-state.json` has no denominator for a rate?*
   -> (D1) Render "drain shipped (last run)" count instead of a rate — `lastRun.shipped` is the only honest number available without a collector change; a rate would require inventing a denominator in the view.
2. *Should the samples tables (cycle-time rows, escalation rows) be visible by default?*
   -> (D2) No — inside the `<details>` expander with the formula. Samples are audit data; the card face stays scannable.
3. *Group placement for a future/unknown metric id?*
   -> (D3) Trailing "Other" group with the generic renderer — keeps the layout map authoritative without blocking new collectors.
4. *Extract `bars()` from `renderVelocity` or duplicate?*
   -> (D4) Extract to module-level `barTable` — same file, two call sites, zero markup change; duplication would drift.
