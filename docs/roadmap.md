# Roadmap

Flat priority-ordered list (file order = priority). Every entry is a `### <Entry Name>` heading — **one fixed level, no grouping categories**. Writers (`/noldor-triage`, `/noldor-promote` residue, the dashboard add API) may never mint an `### <Category>` container with `#### <Entry>` children; a group heading carrying no entry is a `validate:triage` error (`empty-group-heading`).

Each entry carries a `- id: Q-NNNN` bullet — a stable ID minted at triage and never rewritten; it survives heading renames and roadmap ↔ backlog moves, so `blocked-by:` references target it, not the rename-fragile slug (the slug is a human-readable alias). See [triage.md → Stable entry IDs](noldor/triage.md#stable-entry-ids).

File order tracks the **`pnpm noldor triage score`** ranking, not the raw `impact:` label. `effort` divides in that formula, so a cheap low-impact entry can outrank an expensive high-impact one — `XS/low/med` scores 150 against `M/med/med`'s 75. The score guides the insert position rather than enforcing it (nothing in `validate:triage` checks order, and the operator may override), so read a file-order question against the score before calling it an inversion. Weights, formula and range are documented once in [triage.md → Scoring rubric](noldor/triage.md#scoring-rubric); the implementation is [`scoreEntry()`](../src/triage/score.ts).

An entry may declare dependencies with a `- blocked-by: <slug|Q-id, …>` bullet (comma-separated) — the entries this work waits on. It feeds dependency-weight scoring, and `validate:triage` flags refs that resolve to no known entry (`unknown-blocked-by-ref`; advisory, error under `--strict` or the refs-only `--strict-refs`) while `/noldor-garden` flags circular chains. Retired entries stay resolvable: promotion carries `- id:` into the FD's `entry-id:`, and the no-FD paths (fast-track, attach) forward it via `.noldor/retired-entry-ids.json`, maintained by `roadmap remove-block`. `- deps:` is the legacy alias, still accepted during the migration window and unioned with `blocked-by:`; prefer `blocked-by:` in new entries.

> **Routing policy — prep scales with `size:`. Don't spec the small ones.**
>
> - **XS / S** → no spec, no plan. `/noldor-gate` routes these to `fast-track` (code) or `micro-chore` (pure-doc) and retires the entry on ship — the drain-runner's bread and butter.
> - **M** → `specs-only` (spec, no plan).
> - **L / XL** → `full` (spec + plan), and only when there's real design risk — a mechanical L can still fast-track.
>
> Encoded once in [`sizeToPath()`](../src/core/size-routing.ts); `/noldor-gate` Step 0 surfaces the verdict as each entry's `suggestedPath`. Full matrix in [complexity-gating.md](noldor/complexity-gating.md).

### Session Retro Auto-Capture

- id: Q-0340
- area: tooling
- type: feat
- since: 2026-10-07
- size: M
- impact: high
- confidence: med
- parent: memory-intake-lessons-learned-pipeline

Today nothing makes an agent write what it learned. The `## Lessons` + `/noldor-absorb` loop only fires when someone asks, so lessons leak into the assistant's private memory instead (charuy, Q-0321, PR #346: the `Why:`-vs-`Why —` PR-summary trap went to memory, three follow-ups only reached `ideas.md` on request). Add a gate step after merge (Step 4.11, before the Step 5 handoff), on every path: the agent appends (1) follow-ups and unfixed findings — verifier notes, deferred review lows, spec drift, unpriced or skipped bits — as raw bullets under `## Not groomed`, and (2) traps that cost a debugging cycle under `## Lessons`, each with slug + PR + date, and never names the next roadmap entry (always-clear stays intact). Open: (a) scaffold `## Lessons` when a consumer's `ideas.md` lacks it (charuy's has none); (b) `ideas.md` is gitignored in some consumers (charuy) and tracked in others (noldor), so the step writes the file and never commits it; (c) an empty retro is fine and should say so, not pad; (d) a drain child needs the same step, headless.
