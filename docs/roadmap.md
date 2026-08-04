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
