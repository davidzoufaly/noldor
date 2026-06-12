# Outcome Telemetry and Effectiveness Metrics — Design

**Slug:** outcome-telemetry-and-effectiveness-metrics
**FD:** docs/features/outcome-telemetry-and-effectiveness-metrics.md
**Date:** 2026-06-12
**Tier:** full
**Deps:** agent-events-log-and-agents-dashboard-page (unshipped — scoped around, see D1)

## Problem

The framework enforces process and never measures whether the process works. Every tuning decision — gate strictness, size-routing thresholds (`sizeToPath()` in `src/core/size-routing.ts`), CR lane composition (`crLanesConfigSchema` field on `noldorConfigSchema`, `src/cr/config.ts`), drain retry caps — is currently vibes. The raw data already exists: git trailers (`Noldor-FD`, `Noldor-Path`, override trailers), FD frontmatter (`since` / `introduced` / `phase` in `docs/features/*.md`), PR history, `.noldor/cr/*.json` lane findings, `.noldor/drain-state.json`, and `.noldor/agent-events.jsonl` (writer `appendAgentEvent` in `src/core/agent-events.ts`, shipped with continuous-drain PR #72). Nothing derives metrics from it.

## Goals

- Metric set v1, each derived reproducibly from repo history + `.noldor/` artifacts: cycle time, size-routing accuracy, CR effectiveness, drain reliability, override pressure, tokens per feature.
- `noldor metrics compute` CLI emitting `metrics.json` — derive-on-demand; git is the store, computation is the cache.
- Dashboard `/metrics` page: headline cards + per-path breakdown + trend over releases. Standalone — no `/agents` page dependency (D2).
- `sdd-report.md` gains a metrics section per release cut.
- Honesty rails: no metric without a machine-carried formula + blind-spots list.
- Tokens: **raw token counts only, never cost.** Recorded only where the runner emits real usage numbers (Claude Code, codex, opencode adapters) — never estimated, never derived from text length. Missing data → `null`, labeled.

## Non-goals

- No persistent aggregate store / cache file in v1 (entry's explicit constraint).
- No `/agents` dashboard page (separate roadmap entry survives untouched).
- No token **cost** (currency) anywhere — operator directive 2026-06-12.
- No token capture for operator-driven interactive sessions in v1 (capturable surface is spawned agents).
- No cross-repo / blended consumer+self-host metrics — compute per-repo only.
- No backfill synthesis: pre-event-log history yields cycle-time + routing metrics only; event-derived metrics start at event-log epoch and say so.

## Design

### Unit 1 — `src/metrics/facts.ts` (single extraction pass)

One function `extractFacts(cwd): Promise<RepoFacts>` reads every source once:

| Fact | Source | Mechanism |
| --- | --- | --- |
| `commits[]` | `git log` on current branch (main at compute time) | one `git log --format` call with `%(trailers)`; parse `Noldor-FD`, `Noldor-Path`, `Noldor-Override*` trailers; subject + date + diff-stat (`--shortstat`) |
| `features[]` | `docs/features/*.md` frontmatter | reuse the gray-matter-style loader pattern already used by `src/core/release-markers.ts` / `src/core/next-priority.ts`; fields `since` (new optional frontmatter field, see D7), `introduced`, `phase`, `noldor-tier`, `name` |
| `intake[]` | git history of `docs/roadmap.md` / `docs/backlog.md` | recover `since:` + `parent:` per promoted entry from the entry's residue in history (`git log -S'<slug heading>'`-style scan) — fallback for FDs without frontmatter `since` (D7); same mechanism routing-accuracy uses for `size` |
| `laneFindings[]` | `.noldor/cr/*.json` (+ `archive/`) | JSON parse per file against `LaneFindings` (`src/cr/findings-schema.ts`): per-lane `blockers[]` + `suggestions[]` (there is no flat `findings` field); slug/kind/lane from `src/cr/filename.ts` convention |
| `agentEvents[]` | `.noldor/agent-events.jsonl` | line-parse; schema = `AgentEvent` from `src/core/agent-events.ts` (incl. `kind: 'salvaged'` rows written by `src/autonomous/salvage.ts`) |
| `escalations[]` | `.noldor/escalations.jsonl` | line-parse; schema = `EscalationRow` from `src/autonomous/escalations.ts` |
| `drainState` | `.noldor/drain-state.json` | JSON parse; `DrainState` (`src/autonomous/drain-state.ts`): `shipped`, `skip[]`, `retries` |
| `releases[]` | `git tag -l 'v*'` + tag dates | one `git for-each-ref` call |
| `overrides[]` | same trailer source as `src/garden/detectors/override-audit.ts` | reuse the exported `auditOverrides()` (`src/garden/detectors/override-audit.ts`) and `parseTrailers` (`src/core/trailers.ts`) — both already public, no new export needed |

Every source is fail-open **per source**: absent file → empty list + entry in `facts.warnings[]`; malformed JSONL line → skipped + counted. `extractFacts` never throws on missing/dirty data; only a non-git cwd is fatal.

### Unit 1.5 — `since` becomes FD frontmatter (D7)

`since:` today lives only in roadmap/backlog entries, which promotion deletes — `FeatureFrontmatterSchema` (`src/features/feature-schema.ts`) has no `since` field and no FD carries it (0 of 39 as of 2026-06-12), so cycle-time's intake timestamp has no forward-looking home. Fix in this slice:

- Add optional `since?: string` (ISO date) to `FeatureFrontmatterSchema`.
- The promote skill (`.claude/skills/promote/SKILL.md` step 6 + template twin) copies the source block's `- since:` into the new FD's frontmatter.
- Backfill is NOT bulk-applied: historical FDs resolve via `intake[]` recovery (Unit 1); this feature's own FD gets `since: 2026-06-11` as the first carrier.

### Unit 2 — metric collectors (`src/metrics/collect/<metric>.ts`)

Each metric is a pure module: `collect(facts: RepoFacts): MetricResult`.

```ts
interface MetricResult {
  id: string;            // 'cycle-time', 'routing-accuracy', ...
  value: unknown;        // metric-shaped payload (see per-metric below)
  unit: string;
  formula: string;       // human-readable derivation, REQUIRED
  blindSpots: string[];  // REQUIRED, may not be empty — every metric has at least one
  samples: unknown[];    // the underlying rows, for audit
}
```

`formula` + non-empty `blindSpots` are enforced by the type + a unit test over all collectors — the honesty rail lives in code, not docs discipline.

Per-metric derivations (v1):

1. **`cycle-time`** — per FD with a recoverable intake date (`since` frontmatter, else `intake[]` recovery — D7) and `introduced`: days between intake date and the **release date of `introduced`** — `introduced` is a semver string (`semver.optional()`, `src/features/feature-schema.ts:42`), so the endpoint is derived by joining `introduced` → `releases[]` tag `v<introduced>` → tag date. An `introduced` version with no matching tag → FD excluded + blind-spot tally. Segments: by `Noldor-Path` trailer of the FD's commits (majority path wins; mixed → 'mixed'), by autonomous vs operator (autonomous = any commit in the FD's set carries drain/plan-runner provenance — `Noldor-Path: fast-track` from a drain run is identified via agent-events `slug` match when available, else labeled 'unknown-provenance' — blind spot recorded). Value: median + p90 + per-segment table. FDs with no recoverable intake are excluded and counted in a blind-spot tally.
2. **`routing-accuracy`** — for shipped entries where roadmap `size` and `parent` are recoverable from `intake[]`: `sizeToPath(size, hasParent)` (actual signature, `src/core/size-routing.ts:64` — `hasParent` from the entry's `parent:` field) vs actual `Noldor-Path` taken. Value: confusion table suggestion×actual over last N shipped (default 10). Blind spot: entries promoted before `Noldor-Path` trailer existed are excluded.
3. **`cr-effectiveness`** — per lane: findings count = `blockers.length + suggestions.length` per `LaneFindings` sink vs post-merge corrective commits = commits with `fix:`/`revert:` subject carrying the same `Noldor-FD` slug within 14 days (D3) after the FD's ship commit. Value: per-lane `{blockers, suggestions, correctiveCommits}`. Explicitly labeled approximation.
4. **`drain-reliability`** — two explicitly-separated layers. (a) *Last-run snapshot:* shipped / skipped / retried from `drain-state.json` (`shipped`, `skip[]`, `retries`) — this file is a live snapshot overwritten by each run (`src/autonomous/drain-state.ts:27`), so it can never yield history; labeled "latest run only", mandatory blind spot. (b) *History:* salvaged = count of `agentEvents[]` rows with `kind: 'salvaged'`; escalated = `escalations[]` counts total / per-slug / per-time-bucket — `EscalationRow` has no run identifier, so per-run grouping is NOT derivable (run-id is out of v1 scope, noted as blind spot); retry distribution + mean wall-clock per feature (`durationMs`) from `agentEvents[]`. All history parts are epoch-limited: absent or sparse files → those parts `value: null` with labeled blind spot (D4). Dashboard trend rows for drain metrics start at the event-log epoch.
5. **`override-pressure`** — override-trailer usage grouped by detector over time buckets (per release window). Extends override-audit's extraction; rising trend = gate friction.
6. **`tokens-per-feature`** — sum of `tokens.total` over agent-events rows for the FD's slug. Only present where events carry the new optional `tokens` field (Unit 3). Cost is NEVER computed. Features with zero token-bearing events → `null` + 'no usage data'.

### Unit 3 — token capture at spawn (`src/core/agent-events.ts` + `src/core/agent-runner/`)

- `AgentEvent` gains optional `tokens?: { input: number; output: number; total: number; source: string }` — `source` names the artifact the numbers came from (e.g. `claude-jsonl`, `codex-session`, `opencode-session`).
- Per-runner usage adapters in `src/core/agent-runner/usage/<runner>.ts`, wired where the registry (`src/core/agent-runner/registry.ts`) already emits events after a spawn exits:
  - **claude**: parse the session transcript JSONL the CLI writes (locate via the spawn's project dir); sum native `usage` fields from assistant message records.
  - **codex** / **opencode**: parse their native session stores / final-output usage records. Each adapter returns `tokens | null`.
- Hard rule, enforced in adapter tests: an adapter returns numbers **only** read verbatim from runner-emitted usage records. No estimation, no tokenizer fallback, no text-length heuristics. Can't find the record → `null`, event written without `tokens`.
- Fail-open like the rest of `appendAgentEvent`: adapter errors never break a spawn.

### Unit 4 — `src/metrics/compute.ts` + CLI

- `compute(cwd): Promise<MetricsReport>` — `extractFacts` → run all collectors → `{ generatedAt, head, factsWarnings, metrics: MetricResult[] }`.
- `src/metrics/compute-cli.ts` — `noldor metrics compute [--json <path>] [--metric <id>]`; default prints a human table + writes `metrics.json` to cwd root (gitignored — `.gitignore` entry added). Registered in `src/cli/manifest.ts` as new group `metrics`.
- Exit codes: 0 = computed (even with warnings); 1 = fatal (not a git repo / collector crash).

### Unit 5 — dashboard `/metrics` page

- New GET route in `src/dashboard/server.ts` route table (`matchRoute` pattern, like existing pages) + view fn in `src/dashboard/views.ts` + data fn in `src/dashboard/data.ts` calling `compute()`.
- Content: headline cards (median cycle time, autonomous-ship share, drain success rate, total tokens last release), per-path breakdown table, per-release trend rows, and a per-metric "formula + blind spots" expander — the audit trail is user-visible, not buried.

### Unit 6 — sdd-report integration

- `src/garden/sdd-report.ts` gains a metrics section: calls `compute()`, renders headline numbers + formulas via a formatter in `src/garden/sdd-report-format.ts` (same pattern as `reviewSkipCountLine`). Release cut therefore snapshots metrics into `sdd-report.md`.
- Fail-open: compute failure renders a "metrics unavailable: <reason>" line, never blocks release.

### Unit 7 — docs

- `docs/noldor/metrics.md` — one section per metric: formula, sources, blind spots, epoch limits. The collectors' `formula`/`blindSpots` strings are the canonical text; doc page states they must match (drift-checkable later, not v1).
- `docs/noldor/script-catalog.md` — add `metrics compute` row.

### Testing

- Collectors: pure-fn unit tests with fixture `RepoFacts` (hand-built objects, no git needed) — happy path + absent-source `null` path per metric.
- `facts.ts`: integration test against a scratch git repo fixture (pattern exists in `src/core/__tests__/`) + malformed-JSONL tolerance test.
- Usage adapters: fixture transcript/session files per runner; assert exact numbers and the no-estimation rule (unparseable → `null`).
- Honesty-rail test: iterate all registered collectors, assert non-empty `formula` and `blindSpots`.
- CLI: spawn test asserting exit codes + `metrics.json` shape (pattern from existing CLI tests).

## Acceptance criteria

- `noldor metrics compute` on this repo emits cycle-time (intake date → `v<introduced>` tag date) for every FD with `introduced:` set, a matching release tag, and a recoverable intake date (frontmatter `since` or roadmap-history recovery); FDs with unrecoverable intake or unmatched tag appear in a blind-spot tally, not silently dropped. Routing-accuracy table covers the last 10 shipped entries.
- Every emitted metric carries non-empty `formula` and `blindSpots`; a unit test enforces it for all collectors.
- Deleting `.noldor/agent-events.jsonl` and re-running compute → exit 0, drain/tokens metrics `value: null` with labeled blind spot — no throw.
- A spawn through the agent-runner registry with the claude runner records a `tokens` field read from the session JSONL; a runner with no locatable usage record writes the event without `tokens` (adapter test per runner: claude, codex, opencode).
- No code path anywhere multiplies tokens by a price or emits a currency value.
- `/metrics` renders headline cards + breakdown table from live repo data.
- `sdd-report.md` regenerated at release contains the metrics section; compute failure degrades to a labeled unavailable-line.

## Risks / trade-offs

- **Approximation honesty:** CR catch-rate and autonomous-provenance segmentation are approximations; mitigated by mandatory formula/blind-spot fields surfaced in CLI, dashboard, and docs.
- **Token adapter fragility:** runner session formats are external and may change; adapters are isolated per runner, fail to `null`, and never break spawns — worst case is missing token data, never wrong token data.
- **Compute latency on big history:** one full `git log` pass per compute; acceptable for this repo size, revisit with a cache only if a consumer hits pain (store deliberately out of v1).
- **Dep scoped around:** drain-reliability is partially blind until the `/agents` entry formalizes event vocabulary; v1 reads the shipped minimal `AgentEvent` shape and labels gaps.

## User Story

As an operator tuning an agent-driven repo, I want every framework-effectiveness claim derived reproducibly from repo history — cycle time, routing accuracy, CR catch-rate, drain reliability, override pressure, raw tokens per feature — so that gate and autonomy tuning decisions (and the adoption pitch) rest on auditable numbers instead of vibes.

## Usage

```bash
# derive all metrics from repo history + .noldor artifacts
pnpm noldor metrics compute            # human table + metrics.json
pnpm noldor metrics compute --json out.json
pnpm noldor metrics compute --metric cycle-time

# dashboard
pnpm noldor dashboard server           # → http://localhost:4321/metrics

# release: sdd-report.md now contains a Metrics section automatically
```

## Open questions (resolved)

1. _Dep `agent-events-log-and-agents-dashboard-page` is unshipped — block on it?_ -> No; the minimal `AgentEvent` writer already shipped (PR #72). v1 consumes what exists, labels event-epoch gaps, and the `/agents` entry stays independent. (D1: operator-ratified at gate pickup.)
2. _`/metrics` reuse of `/agents` plumbing when `/agents` doesn't exist?_ -> Build `/metrics` standalone on the existing dashboard server/data/views plumbing. (D2: operator-ratified.)
3. _Corrective-commit window for CR effectiveness?_ -> 14 days, constant in the collector, named in the formula string. Long enough to catch follow-up fixes, short enough to avoid attributing unrelated work. (D3)
4. _How far back to backfill?_ -> No synthesis. Trailer/frontmatter metrics cover all history they exist in; event-derived metrics start at the event-log epoch (2026-06-12) and the blind-spot field says so. (D4)
5. _Token source per runner?_ -> Native usage records only: Claude Code session JSONL `usage` fields; codex/opencode native session stores. Adapter returns `null` when not found verbatim — measuring nothing beats hallucinating something. Raw counts only, cost permanently out of scope. (D5: operator directive 2026-06-12.)
6. _Where does `metrics.json` live?_ -> Repo root, gitignored — it's a derived artifact; git history is the store. (D6)
7. _`since` is not FD frontmatter — where does cycle-time's intake date come from?_ -> Two-track: add optional `since` to `FeatureFrontmatterSchema` + promote copies it forward (Unit 1.5); historical FDs recover intake from roadmap/backlog git history (`intake[]` facts source). No bulk backfill — recovery covers history, frontmatter covers the future. (D7: from spec-CR blocker, 2026-06-12.)
