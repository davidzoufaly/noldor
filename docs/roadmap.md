# Roadmap

Flat priority-ordered list (file order = priority); H3 headings group related entries.

Each entry carries a `- id: Q-NNNN` bullet — a stable ID minted at triage and never rewritten; it survives heading renames and roadmap ↔ backlog moves, so `blocked-by:` references target it, not the rename-fragile slug (the slug is a human-readable alias). See [triage.md → Stable entry IDs](noldor/triage.md#stable-entry-ids).

An entry may declare dependencies with a `- blocked-by: <slug|Q-id, …>` bullet (comma-separated) — the entries this work waits on. It feeds dependency-weight scoring, and `validate:triage` flags refs that resolve to no known entry (`unknown-blocked-by-ref`; advisory, error under `--strict`) while `/garden` flags circular chains. `- deps:` is the legacy alias, still accepted during the migration window and unioned with `blocked-by:`; prefer `blocked-by:` in new entries.

> **Routing policy — prep scales with `size:`. Don't spec the small ones.**
>
> - **XS / S** → no spec, no plan. `/gate` routes these to `fast-track` (code) or `micro-chore` (pure-doc) and retires the entry on ship — the drain-runner's bread and butter.
> - **M** → `specs-only` (spec, no plan).
> - **L / XL** → `full` (spec + plan), and only when there's real design risk — a mechanical L can still fast-track.
>
> Encoded once in [`sizeToPath()`](../src/core/size-routing.ts); `/gate` Step 0 surfaces the verdict as each entry's `suggestedPath`. Full matrix in [complexity-gating.md](noldor/complexity-gating.md).
>
> Section order = execution phases from the 2026-07-02 queue verification. Retired that day: `fd-complexity-tier-field` (shipped as `noldor-tier`), `runtime-architecture-invariant-expansion` + `dashboard-reference-api-subtree` (Charuy-only premises), `dispatch-next-priority-via-agent-window` (covered by `noldor autonomous run --max-features 1` + `/gate` Step 0 priority pickup). `prefix-skills-with-noldor` re-sized S→L and parked in backlog.

### Phase 2 — Enforcement Honesty

### Phase 3 — Adoption Chain

### Phase 4 — Consumer-Layout Correctness

### Phase 5 — Autonomy Observability

### Phase 6 — Structural

### Promoted from Backlog

#### Idempotent Drain Delivery Guard

- id: Q-0008
- area: tooling
- type: fix
- since: 2026-06-12
- size: S
- impact: med
- confidence: low
- parent: noldor

A triage commit that lived un-pushed on local `main` got delivered twice — once by a concurrent process and once by the operator (PRs #76 + #77, identical content) — because nothing detected that the local commit was already mirrored on `origin` under a different sha. Add an idempotency guard before re-delivering: when about to push/PR a local commit, check whether its tree/content already landed on `origin/main` (e.g. patch-id match) and skip the redundant delivery. Niche trigger (requires a concurrent delivery race), hence parked.

#### Prefix Skills with noldor-

- id: Q-0009
- area: tooling
- type: refactor
- since: 2026-06-12
- size: L
- impact: low
- confidence: med
- parent: noldor

Prefix the framework's skill names with `noldor-` to namespace them and avoid collisions with consumer-side or vendored skills. Parked 2026-07-02, re-sized S→L: a 2026-06-13 drain attempt revealed this is a self-referential mega-rename — 9 unprefixed skills (`gate`, `garden`, `triage`, `promote`, `milestone`, `new-feature`, `draft-feature-md`, `refactor`, `release-sweep`) plus template twins, the drain's `gatePrompt` in `src/autonomous/drain-source.ts`, and back-compat aliases for consumer repos that already vendored the old names. Only `noldor-spec` / `noldor-plan` / `noldor-research` were born prefixed. Needs the full spec+plan path if picked up; never fast-track.

#### Noldor-Native Wait Primitive

- id: Q-0010
- area: tooling
- type: feat
- since: 2026-07-02
- size: M
- impact: low
- confidence: med
- parent: noldor

Runner-agnostic alternative to the harness `Monitor` tool, consumer side only: `noldor wait <state-file> --until <terminal-cond> [--emit <jsonpath>]` that polls until a job reaches a terminal state and surfaces progress. Do NOT invent a new progress format — reuse the existing producer-side state files (`.noldor/drain-state.json` heartbeat, `.noldor/cr/<slug>-<kind>-<lane>.json` sinks). The "write one side / read other" channel already exists; the gap is a portable wait/poll the controller calls instead of the host harness's Monitor (which can be blocked + isn't cross-runner). Parked: background-task completion notifications already cover most waiting. Touches: `src/autonomous/` (watch shares the poll loop), a `noldor wait` CLI.

#### Graph-Freshness / Fmt-Collision Follow-Ups

- id: Q-0011
- area: tooling
- type: fix
- since: 2026-07-01
- size: S
- impact: low
- confidence: med
- parent: noldor

The v0.4.0 near-miss (`pnpm release` hard-gates on committed-fresh `graphify-out/graph.json`, but the fmt lefthook step fed oxfmt an all-ignored file set for a graph-only commit → hard error → couldn't commit the graph) was fixed immediately in PR #114 (`exclude: 'graphify-out/'`). Parked design follow-ups: (a) a broader guard so any all-ignored fmt invocation no-ops instead of erroring; (b) have the release-sweep own the graph commit end-to-end so the two gates can't deadlock; (c) reconsider whether `graph.json` should be tracked at all vs regenerated in a release-time step. Pick up only if the collision class recurs.

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

#### Add templates/docs To Micro-Chore And Release-Sweep Allowlists

- id: Q-0023
- area: tooling
- type: fix
- since: 2026-07-07
- size: XS
- impact: med
- parent: noldor

Frontmatter/doc twin edits under `templates/docs/noldor/**` (and `templates/docs/**`) match no allowlist in `src/core/allowlist.ts`, so the `docs/noldor` ↔ `templates/docs/noldor` twin syncs that `check-template-sync` forces cannot land via micro-chore or release-sweep — they require a fast-track PR with a `Noldor-Path-Override:` trailer, which needlessly spins the acceptance-verify (dashboard-boot) CR lane for a pure frontmatter mirror. This drift is hit every release when `release-markers` adds `introduced:` to `docs/noldor/*.md` but not its template twin. Add `templates/docs/**/*.md` to `MICRO_CHORE_GLOBS` (mirroring the existing `templates/.claude/**` carve-out) and to `RELEASE_SWEEP_GLOBS` (mirroring `docs/noldor/**/*.md`), with `allowlist.test.ts` coverage.

### Trigger-Parked (revisit when the named trigger fires)

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
