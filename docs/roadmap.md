# Roadmap

Flat priority-ordered list (file order = priority); H3 headings group related entries.

Each entry carries a `- id: Q-NNNN` bullet — a stable ID minted at triage and never rewritten; it survives heading renames and roadmap ↔ backlog moves, so `blocked-by:` references target it, not the rename-fragile slug (the slug is a human-readable alias). See [triage.md → Stable entry IDs](noldor/triage.md#stable-entry-ids).

An entry may declare dependencies with a `- blocked-by: <slug|Q-id, …>` bullet (comma-separated) — the entries this work waits on. It feeds dependency-weight scoring, and `validate:triage` flags refs that resolve to no known entry (`unknown-blocked-by-ref`; advisory, error under `--strict`) while `/noldor-garden` flags circular chains. `- deps:` is the legacy alias, still accepted during the migration window and unioned with `blocked-by:`; prefer `blocked-by:` in new entries.

> **Routing policy — prep scales with `size:`. Don't spec the small ones.**
>
> - **XS / S** → no spec, no plan. `/noldor-gate` routes these to `fast-track` (code) or `micro-chore` (pure-doc) and retires the entry on ship — the drain-runner's bread and butter.
> - **M** → `specs-only` (spec, no plan).
> - **L / XL** → `full` (spec + plan), and only when there's real design risk — a mechanical L can still fast-track.
>
> Encoded once in [`sizeToPath()`](../src/core/size-routing.ts); `/noldor-gate` Step 0 surfaces the verdict as each entry's `suggestedPath`. Full matrix in [complexity-gating.md](noldor/complexity-gating.md).
>
> Section order = execution phases from the 2026-07-02 queue verification. Retired that day: `fd-complexity-tier-field` (shipped as `noldor-tier`), `runtime-architecture-invariant-expansion` + `dashboard-reference-api-subtree` (Charuy-only premises), `dispatch-next-priority-via-agent-window` (covered by `noldor autonomous run --max-features 1` + `/noldor-gate` Step 0 priority pickup). `prefix-skills-with-noldor` re-sized S→L and parked in backlog.

### Dashboard Actions Row Full Height

- id: Q-0035
- area: tooling
- type: fix
- since: 2026-07-13
- size: XS
- impact: low
- confidence: high
- parent: dashboard-entry-move-to-top-bottom-actions

Actions row on the roadmap / backlog dashboard pages lost its full row height — it renders shorter than the other cells and the four action controls are not aligned vertically. Restore full-height rendering and vertical alignment of the action buttons.

### Dashboard Merge Hot Zones Into WIP Age

- id: Q-0036
- area: tooling
- type: refactor
- since: 2026-07-13
- size: S
- impact: med
- confidence: med

Merge the hot-zones dashboard page into the WIP-age dashboard page — one consolidated view instead of two overlapping activity/staleness pages.

### Dashboard Merge Skills Into Framework

- id: Q-0037
- area: tooling
- type: refactor
- since: 2026-07-13
- size: S
- impact: low
- confidence: med

Merge the skills dashboard page into the framework dashboard page — skills are framework surface; a separate page splits related signal.

### Metrics Page UI Improvements

- id: Q-0038
- area: tooling
- type: feat
- since: 2026-07-13
- size: M
- impact: med
- confidence: low
- parent: metrics

Better UI for the /metrics dashboard page. Fuzzy one-liner — needs a short design pass to define what "better" means (layout, charts, grouping) before implementation.

### Code-Clone Detector

- id: Q-0033
- area: tooling
- type: feat
- since: 2026-07-11
- size: L
- impact: med
- confidence: med

Token/AST-based Type-1/2/3 clone detection (copy-paste dups, à la `jscpd`). Deterministic corpus over `scanPaths`, no LLM. Surface duplicate blocks as a new signal in `sdd-report` + feed `/refactor`; optional CR-gate block above a configurable clone threshold. Fits the "deterministic detector + optional LLM triage" pattern (same shape as detector-5 idea-merge). Distinct from existing pieces: `/refactor` finds consolidation opportunities from god-nodes/cohesion but doesn't do line/token clone matching; `graphify` AST graph has structural similarity signal but no clone report. Semantic (Type-4) clones out of scope — that's the embeddings-infra entry.

### Non-Claude Runner Parity Follow-Ups

- id: Q-0025
- area: tooling
- type: feat
- since: 2026-07-07
- size: M
- impact: low
- parent: noldor
- confidence: med

Three deferred pieces from the make-noldor-agent-agnostic decision (PR #71, three peer runtimes: Claude Code / Codex / opencode): (a) deep skill parity for non-Claude implementers; (b) opencode `--format json` event parsing (today reserved, treated as prose v1); (c) `crLanes` → role-ref vocabulary migration. Elective — pick up only when a non-Claude implementer runtime is actually exercised end-to-end.

### Agent-Events Log Rotation

- id: Q-0031
- area: tooling
- type: chore
- since: 2026-07-11
- size: S
- impact: low
- confidence: med

`.noldor/agent-events.jsonl` grows without bound (phase rows add ~4 lines per slug per run). Deferred from the /agents entry (spec D5): rotation adds file-swap complexity to a fail-open writer, so design size-or-age-based rotation (keep last N runs readable for the /agents timeline) as its own piece. Touches `src/core/agent-events.ts` and `src/dashboard/data.ts` readers.

### Phase 2 — Enforcement Honesty

### Phase 3 — Adoption Chain

### Phase 4 — Consumer-Layout Correctness

### Phase 5 — Autonomy Observability

### Phase 6 — Structural

### Promoted from Backlog

#### Dashboard Blocked-By Graph View

- id: Q-0018
- area: tooling
- type: feat
- since: 2026-07-05
- size: M
- impact: low
- confidence: med
- parent: noldor

Surface the roadmap+backlog `blocked-by` graph as a visual dependency view on the tracking dashboard (nodes = entries, edges = blocked-by; highlight cycles flagged by the `circular-blocked-by` garden detector). Split out of the shipped `first-class-blocked-by-field` entry — the data model, validation, and cycle detector landed; the dashboard visualization was deferred as its own larger piece.

### Framework Self-Ownership

#### Skill-vs-Code Drift Detector

- id: Q-0030
- area: tooling
- type: feat
- since: 2026-07-11
- size: M
- impact: med
- confidence: med

Skills reference CLI commands, `package.json` scripts, and `src/` paths that rot after reorgs (release-sweep needed a full path audit, PR #124; the gate skill body carried the same class of drift). Add a garden detector that scans `.claude/skills/**/SKILL.md` + `templates/.claude/skills/**` for `pnpm <script>` invocations not in `package.json` scripts, `noldor <sub>` commands not in the CLI manifest, and repo-relative paths that don't exist. Carried out of the drained release-sweep-skill-path-audit roadmap entry.

### Drain Batch — Backlog Hardening (moved from backlog 2026-07-11)

### Trigger-Parked (revisit when the named trigger fires)

#### Graph-Freshness / Fmt-Collision Follow-Ups

- id: Q-0011
- area: tooling
- type: fix
- since: 2026-07-01
- size: S
- impact: low
- confidence: med
- parent: noldor

Residual design follow-ups from the v0.4.0 near-miss (`pnpm release` hard-gates on committed-fresh `graphify-out/graph.json` vs fmt lefthook erroring on an all-ignored file set; immediate fix PR #114, broader all-ignored no-op guard shipped as `noldor fmt` in PR #184). Trigger: pick up only if the fmt/graph gate collision class recurs despite the PR #184 guard.

- (b) have the release-sweep own the graph commit end-to-end so the two gates can't deadlock.
- (c) reconsider whether `graph.json` should be tracked at all vs regenerated in a release-time step.

#### Real-Codex Integration Smoke Test

- id: Q-0005
- area: tooling
- type: test
- since: 2026-05-10
- size: M
- impact: low
- parent: noldor

`src/cr/__tests__/codex.test.ts` mocks the `Spawn` function, so all CI runs of the codex lane validate the wiring without ever invoking the real `codex` binary. The first real-codex run will surface integration bugs the mocked tests can't catch (codex CLI flag drift, JSON schema variance, stdin-pipe encoding edge cases). Add a manual / opt-in smoke test (`pnpm noldor cr codex --dry-run` against a fixture worktree, gated behind `NOLDOR_RUN_REAL_CODEX=1`) plus a documented operator-side pre-release dogfood step in `docs/noldor/cr-pipeline.md`. Trigger: when codex CLI grows a stable `cr --json` subcommand (currently absent).

#### Path Rename: docs/superpowers to docs/design

- id: Q-0006
- area: tooling
- type: refactor
- since: 2026-06-11
- size: S
- impact: med
- parent: noldor
- recovered: 2026-06-11

Separable last step split out of `de-superpowers-vendor-spec-plan-and-worktree-flows` at its promotion: rename `docs/superpowers/` → `docs/design/{specs,plans}`. `src/core/doc-roots.ts:30-31` is the single code seam; everything else is prose/links. Ship as a migration (via the shipped `noldor upgrade` chain) that moves files and rewrites links; keep a transition alias in doc-roots for one release. Trigger: bundle with the next migration-bearing release rather than shipping alone — the rename is cheap but touches every spec/plan link, so ride a release that already asks consumers to run `noldor upgrade`.

- Still using the superpowers worktree path → move specs/plan out of the `superpowers/` folder as part of this rename.

### Claude Memories One-Time Migration

- id: Q-0039
- area: tooling
- type: chore
- since: 2026-07-13
- size: M
- impact: med
- confidence: med
- parent: memory-intake-lessons-learned-pipeline

One-time migration of the existing Claude assistant memories (~90 files under the per-project memory dir) into the framework via the `/noldor-absorb` loop — fold live-value gotchas/feedback into `docs/noldor/` runbooks, classify shipped-historical markers as `drop`, report which memories are redundant (no source deletion). Split out of `memory-intake-lessons-learned-pipeline` (Q-0026), which shipped the mechanism only.
