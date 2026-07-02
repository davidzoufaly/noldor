# Backlog

### Does SQL in a Framework Make Sense?

- area: tooling
- type: feat
- since: 2026-06-12
- size: M
- impact: low
- confidence: low

Open question — does it make sense to introduce SQL into the framework? Explore use cases (dashboard queries, metrics, entry indexing) before committing.

### Idempotent Drain Delivery Guard

- area: tooling
- type: fix
- since: 2026-06-12
- size: S
- impact: med
- confidence: low

A triage commit that lived un-pushed on local `main` got delivered twice — once by a concurrent process and once by the operator (PRs #76 + #77, identical content) — because nothing detected that the local commit was already mirrored on `origin` under a different sha. Add an idempotency guard before re-delivering: when about to push/PR a local commit, check whether its tree/content already landed on `origin/main` (e.g. patch-id match) and skip the redundant delivery. Niche trigger (requires a concurrent delivery race), hence parked.

### Prefix Skills with noldor-

- area: tooling
- type: refactor
- since: 2026-06-12
- size: L
- impact: low
- confidence: med

Prefix the framework's skill names with `noldor-` to namespace them and avoid collisions with consumer-side or vendored skills. Parked 2026-07-02, re-sized S→L: a 2026-06-13 drain attempt revealed this is a self-referential mega-rename — 9 unprefixed skills (`gate`, `garden`, `triage`, `promote`, `milestone`, `new-feature`, `draft-feature-md`, `refactor`, `release-sweep`) plus template twins, the drain's `gatePrompt` in `src/autonomous/drain-source.ts`, and back-compat aliases for consumer repos that already vendored the old names. Only `noldor-spec` / `noldor-plan` / `noldor-research` were born prefixed. Needs the full spec+plan path if picked up; never fast-track.

### Noldor-Native Wait Primitive

- area: tooling
- type: feat
- since: 2026-07-02
- size: M
- impact: low
- confidence: med

Runner-agnostic alternative to the harness `Monitor` tool, consumer side only: `noldor wait <state-file> --until <terminal-cond> [--emit <jsonpath>]` that polls until a job reaches a terminal state and surfaces progress. Do NOT invent a new progress format — reuse the existing producer-side state files (`.noldor/drain-state.json` heartbeat, `.noldor/cr/<slug>-<kind>-<lane>.json` sinks). The "write one side / read other" channel already exists; the gap is a portable wait/poll the controller calls instead of the host harness's Monitor (which can be blocked + isn't cross-runner). Parked: background-task completion notifications already cover most waiting. Touches: `src/autonomous/` (watch shares the poll loop), a `noldor wait` CLI.

### Graph-Freshness / Fmt-Collision Follow-Ups

- area: tooling
- type: fix
- since: 2026-07-01
- size: S
- impact: low
- confidence: med

The v0.4.0 near-miss (`pnpm release` hard-gates on committed-fresh `graphify-out/graph.json`, but the fmt lefthook step fed oxfmt an all-ignored file set for a graph-only commit → hard error → couldn't commit the graph) was fixed immediately in PR #114 (`exclude: 'graphify-out/'`). Parked design follow-ups: (a) a broader guard so any all-ignored fmt invocation no-ops instead of erroring; (b) have the release-sweep own the graph commit end-to-end so the two gates can't deadlock; (c) reconsider whether `graph.json` should be tracked at all vs regenerated in a release-time step. Pick up only if the collision class recurs.
