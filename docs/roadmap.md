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

### README Rewrite — Consumer-Journey Order

- id: Q-0043
- area: tooling
- type: docs
- since: 2026-07-13
- size: M
- impact: med
- confidence: high
- parent: noldor

Deep-audit finding (batch `.noldor/research/2026-07-13-184850`, `readme-quality.findings.md` has the proposed outline): README is not wrong post-PR#126 but covers only 5 of 34 CLI command groups, omits gate/drain/upgrade/`init --adopt`, never links the adoption guide, and enumerates a stale config field set. Rewrite in consumer-journey order (install from GH Packages → init/adopt → gate workflow → dashboard → drain → upgrade), link the adoption guide instead of duplicating it, stop enumerating config fields. Same pass: fix `docs/noldor/README.md` index staleness — it still calls the adoption guide a "stub — WIP" (it's a full 105-line guide with live consumers) and omits 4 existing pages (incl. agent-runtimes.md).

### Dashboard UI Polish (from ideas.md 2026-07-14)

Five operator-facing dashboard refinements captured from a live dogfood pass. All are self-host `src/dashboard/` tweaks with design decisions already settled with the operator (recorded per entry). Item 1 + the action-column item are one surface (roadmap/backlog table chrome) so they ride one entry.

### Fd-Command-Rot Garden Detector

- id: Q-0050
- area: tooling
- type: feat
- since: 2026-07-14
- size: S
- impact: med
- confidence: med
- recovered: 2026-07-14
- parent: noldor

Garden detector in the FD-link-rot family: verify that CLI commands documented in done FDs still exist against the live CLI manifest. Today done-FDs reference 4 phantom commands (`pnpm docs:build` among them) and nothing checks FD-documented commands, so they rot silently. Recovered from the `validate-script-catalog-gate` (Q-0042) source block ("consider an `fd-command-rot` garden detector alongside").

### Phase 2 — Enforcement Honesty

### Phase 3 — Adoption Chain

### Phase 4 — Consumer-Layout Correctness

### Phase 5 — Autonomy Observability

### Phase 6 — Structural

### Promoted from Backlog

### Framework Self-Ownership

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
