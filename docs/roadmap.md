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

### Dashboard UI Polish (from ideas.md 2026-07-14)

Five operator-facing dashboard refinements captured from a live dogfood pass. All are self-host `src/dashboard/` tweaks with design decisions already settled with the operator (recorded per entry). Item 1 + the action-column item are one surface (roadmap/backlog table chrome) so they ride one entry.

### Phase 2 — Enforcement Honesty

### Phase 3 — Adoption Chain

### Phase 4 — Consumer-Layout Correctness

### Phase 5 — Autonomy Observability

### Phase 6 — Structural

### Promoted from Backlog

### Framework Self-Ownership

#### Archive Spec/Plan at Done-Flip, Not Release-Sweep

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

### Drain Batch — Backlog Hardening (moved from backlog 2026-07-11)

### Trigger-Parked (revisit when the named trigger fires)
