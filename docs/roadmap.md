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

### Drain Batch — Backlog Hardening (moved from backlog 2026-07-11)

#### PR-Flow Fallback Merges On Red CI

- id: Q-0021
- area: tooling
- type: fix
- since: 2026-07-07
- size: S
- impact: med
- parent: noldor
- confidence: high

`mergePrWithFallback` (`src/core/pr-flow.ts:363-369`) runs a direct `gh pr merge --squash --delete-branch` when `--auto` fails (repo has auto-merge disabled) with **no** CI-check polling, so a PR can land on red when there is no branch protection to stop it. The `--auto` path polls `mergeStateStatus`; the fallback path does not. Harden the fallback to poll checks (or query `mergeStateStatus`/`statusCheckRollup`) before the synchronous merge and refuse to merge a failing PR. Verified against live code 2026-07-07.

#### Plans-Source Drain Deps Gating

- id: Q-0019
- area: tooling
- type: fix
- since: 2026-07-07
- size: S
- impact: med
- parent: noldor
- confidence: high

`plansSource` in `src/autonomous/drain-source.ts` gates eligibility only on spec+plan file existence (`r.date !== null && r.spec`), so the plans-source drain can spawn an in-progress FD whose `blocked-by:`/`deps:` are still unshipped — the deps-in-queue guard added in PR #83 lives only in `roadmapSource` (lines 91-93). Mirror that guard into `plansSource`: mark an FD ineligible when any of its deps still names an unshipped/queued entry, with a precise skip reason. Optionally extend both sources beyond direct-deps to catch transitive/`feat/`-branch deps that currently read as absent-therefore-shipped. Verified against live code 2026-07-07.

#### Test-Tag Presence On src/ Layout

- id: Q-0020
- area: tooling
- type: fix
- since: 2026-07-07
- size: S
- impact: med
- parent: noldor
- confidence: high

`validateTestTagPresence` hardcodes `TEST_WALK_ROOTS = ['apps', 'packages']` (`src/features/validate-features.ts:65`), so the `// @tests: <slug>` presence check never fires on standalone / self-host `src/` layouts even though `docs/noldor/feature-md-schema.md` documents it as enforced (a doc lie for src-layout repos). Route the walk through the shipped `scanRoots()` / consumer `scanPaths` provider (`src/core/repo-paths.ts`) so presence enforcement works on src-layout consumers — same consumer-layout class as the shipped scan-roots provider. Verified against live code 2026-07-07.

#### Verify-Lane Bake-In: Blocking Mode + PR Evidence

- id: Q-0022
- area: tooling
- type: feat
- since: 2026-07-07
- size: S
- impact: low
- parent: noldor
- confidence: med

The acceptance verify lane shipped in advisory mode (PR #74); `autonomous.verifyMode` still defaults to `advisory` (`src/core/config.ts`). Two intended bake-in follow-ups were never tracked: (1) flip the self-host `autonomous.verifyMode` from `advisory` → `blocking` now that the lane has baked for several releases; (2) implement spec item D3 — attach the verify lane's evidence array (command/observed pairs) to the PR body so reviewers see behavioral proof. Both are low-risk hardening of an already-shipped lane.

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
