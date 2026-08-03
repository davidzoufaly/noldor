# Roadmap

Flat priority-ordered list (file order = priority). Every entry is a `### <Entry Name>` heading — **one fixed level, no grouping categories**. Writers (`/noldor-triage`, `/noldor-promote` residue, the dashboard add API) may never mint an `### <Category>` container with `#### <Entry>` children; a group heading carrying no entry is a `validate:triage` error (`empty-group-heading`).

Each entry carries a `- id: Q-NNNN` bullet — a stable ID minted at triage and never rewritten; it survives heading renames and roadmap ↔ backlog moves, so `blocked-by:` references target it, not the rename-fragile slug (the slug is a human-readable alias). See [triage.md → Stable entry IDs](noldor/triage.md#stable-entry-ids).

An entry may declare dependencies with a `- blocked-by: <slug|Q-id, …>` bullet (comma-separated) — the entries this work waits on. It feeds dependency-weight scoring, and `validate:triage` flags refs that resolve to no known entry (`unknown-blocked-by-ref`; advisory, error under `--strict`) while `/noldor-garden` flags circular chains. `- deps:` is the legacy alias, still accepted during the migration window and unioned with `blocked-by:`; prefer `blocked-by:` in new entries.

> **Routing policy — prep scales with `size:`. Don't spec the small ones.**
>
> - **XS / S** → no spec, no plan. `/noldor-gate` routes these to `fast-track` (code) or `micro-chore` (pure-doc) and retires the entry on ship — the drain-runner's bread and butter.
> - **M** → `specs-only` (spec, no plan).
> - **L / XL** → `full` (spec + plan), and only when there's real design risk — a mechanical L can still fast-track.
>
> Encoded once in [`sizeToPath()`](../src/core/size-routing.ts); `/noldor-gate` Step 0 surfaces the verdict as each entry's `suggestedPath`. Full matrix in [complexity-gating.md](noldor/complexity-gating.md).

### Freeze Roadmap/Backlog File Format — Stop Minting H3 Categories

- id: Q-0056
- area: tooling
- type: fix
- since: 2026-07-25
- size: S
- impact: med
- confidence: high
- parent: noldor

`docs/roadmap.md` and `docs/backlog.md` shape drifts on every write. Each triage / absorb / dashboard-add run is free to invent a new H3 grouping heading, so the roadmap now carries eight of them — `Dashboard UI Polish (from ideas.md 2026-07-14)`, `Phase 2 — Enforcement Honesty`, `Phase 3 — Adoption Chain`, `Phase 4 — Consumer-Layout Correctness`, `Phase 5 — Autonomy Observability`, `Phase 6 — Structural`, `Promoted from Backlog`, `Drain Batch — Backlog Hardening (moved from backlog 2026-07-11)` — every one of them **empty**: the entries they grouped drained long ago and the heading stayed. The batch-provenance names (`from ideas.md <date>`, `moved from backlog <date>`) are worse than useless once drained, since git history already records provenance. Result: the priority-ordered list a reader (and the gate's Step 0 pickup) is supposed to scan is buried in dead structure, and `#### <Entry>` vs `### <Entry>` nesting depth now depends on which run happened to create a category.

Want the file format **fixed and untouched by writers**: a flat priority-ordered list of entries at one heading level, with no new H3 categories minted by `/noldor-triage`, `/noldor-absorb`, or the dashboard add API. Fix: (a) drop the "if the entry slots under an existing H3 category … else render `### <Entry Name>`" branch from `.claude/skills/noldor-triage/SKILL.md` §88 (and its twin) in favour of one fixed level; (b) prune the eight empty H3 groups from `docs/roadmap.md` plus any in `docs/backlog.md`; (c) add a `validate:triage` rule that errors on a group heading with no entry block under it, so a drained category can't linger; (d) keep `src/triage/entry-id.ts` heading parsing accepting both depths for back-compat while the surviving categories are retired. Mechanical — the only judgement call is whether the handful of *non-empty* categories (`Framework Self-Ownership`, `Design-Loop Ergonomics`, `Gotcha Root-Fixes`, `Trigger-Parked`) are flattened too or grandfathered; `Trigger-Parked` carries real semantics (parked-until-trigger) and probably becomes a per-entry field instead of a heading.

### Archive Spec/Plan at Done-Flip, Not Release-Sweep

- id: Q-0052
- area: tooling
- type: fix
- since: 2026-07-24
- size: M
- impact: med
- confidence: high
- parent: noldor

When a feature flips `phase: in-progress → done`, its owning spec (`docs/design/specs/<date>-<slug>-design.md`) and plan are left in place. Gate Step 4 end-of-flow (`.claude/skills/noldor-gate/SKILL.md` §167-181) runs `/noldor-draft-feature-md --refresh` + `phase-flip-done.ts`, but neither archives the design artifacts. Archival is deferred entirely to the garden/release-sweep pass, where `detectStaleSpecs`/`detectStalePlans` (`src/garden/garden-detect.ts:146`) flag every `feature-done` spec still outside `archive/` and batch-move them. Net effect: every release dumps the accumulated spec/plan archival of all features shipped since the last sweep at once (v1.1.0 sweep archived 10). Archival should ride the done-flip commit so it lands atomically in the feature PR and garden only ever catches genuine exceptions (orphans, age-outs).

Fix: lift the spec/plan slug→file resolution the detector already implements into `phase-flip-done.ts` (or gate Step 4), and `git mv` the owning spec+plan into `archive/` in the same commit that writes `phase: done`. Design risk lives in the attach-path case — a parent FD that stays `done` across multiple `*-attach` enhancements must not prematurely archive a still-relevant spec — which is why this is spec-sized (M), not a mechanical fast-track. Spec should settle: does each attach enhancement's own dated spec archive on its own ship, keyed on what signal?

### Show Running Design Context Inline During Spec/Plan Dialogue

- id: Q-0053
- area: tooling
- type: feat
- since: 2026-07-24
- size: M
- impact: high
- confidence: med
- parent: noldor

The question-first spec (`/noldor-spec`) and plan (`/noldor-plan`) design loops pose design questions with no surrounding context. The operator answers blind — no view of what's been decided so far, what the feature covers, what the framework already supports / what's in scope, or which threads are still open. Situational awareness is terrible: a design question arrives with none of the state that makes it answerable, so the operator has to reconstruct "where do we stand" from memory each turn.

Want: every time a design question is posed, render the running design state directly and in detail **inline in the chat** — decisions settled so far, open questions still to resolve, and the relevant existing support / constraints the answer must fit. Must be **agent-agnostic**: plain inline chat text, not dependent on any single runner's rich UI, so it reads identically across `claude` / `codex` / `opencode`.

Needs a spec to settle: what the context block contains and how it's ordered; where the running state lives (in-progress spec draft vs. session scratch); how it stays fresh across turns without the operator re-reading the whole draft; and how to keep it detailed without drowning the actual question in noise. Spec-sized (M) for that reason — the value is entirely in getting the inline format and freshness right.

### Mask Volatile Metrics in the sdd-report Release Gate

- id: Q-0054
- area: tooling
- type: fix
- since: 2026-07-25
- size: S
- impact: med
- confidence: high
- parent: noldor

`docs/sdd-report.md` is non-idempotent across environments: it embeds CR/drain metrics (`perLane` blockers/suggestions, escalation `history`, `lastRun`) read from local untracked `.noldor/cr/` + drain-state. Regenerating it in a git worktree sees a fresh empty `.noldor/` → commits empty metrics → the release regen (main workspace, real metrics) drifts → the sdd-report gate aborts. The gate only tolerates the review-skip *count* line (`onlyReviewSkipCountChanged`), not the metrics block. Fix: mask the volatile metrics block in the gate diff like the count line, or source the metrics deterministically. Interim doc lives at `docs/noldor/gotchas.md` → Release & publish — delete that entry when this ships. (surfaced v1.0.2 release)

### Missing Session Marker Should Fail With a Hint

- id: Q-0055
- area: tooling
- type: fix
- since: 2026-07-25
- size: XS
- impact: med
- confidence: high
- parent: noldor

Manually driving a fast-track/sweep in a worktree, it is easy to forget writing `.noldor/session.json` first — the commit then fails at the trailer-inject/validate stage with no obvious "missing session" hint. Fix: the failure should say `no .noldor/session.json — did you skip the gate scaffold?`; optionally `worktrees create` scaffolds a session-marker stub. Interim doc lives at `docs/noldor/worktree-discipline.md` → Split-brain traps — delete that entry when this ships. (surfaced PRs #234, #236)

### Dashboard Port Collision Detection Across Projects

- id: Q-0057
- area: dashboard
- type: feat
- since: 2026-07-25
- size: S
- impact: high
- confidence: high
- parent: noldor

Multi-project dev setups (the framework repo plus consumer repos like charuy) each run their own `noldor dashboard server`, all defaulting to port 4321. The second server dies with `EADDRINUSE` and gives no signal whether the occupying process is *this* project's dashboard (safe to reuse) or a *different* project's (needs another port) — the agent has to `lsof -i :4321` and inspect the process cwd by hand to tell them apart. Fix: `dashboard server` / `dashboard ensure` probe the target port on startup, fetch a small identity payload from the running server (project root path or name), and compare against the current repo root. Match → treat as already running, no-op with a reuse message. Mismatch → auto-pick the next free port (4322, 4323, …) instead of crashing, and print which project owns the conflicting one. Also worth a `noldor dashboard status` that reports port + owning project without trying to bind.
