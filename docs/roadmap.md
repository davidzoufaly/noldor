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

### Seed Missing Test Co-Tags

- id: Q-0335
- area: tooling
- type: test
- since: 2026-09-29
- size: S
- impact: med
- confidence: med
- blocked-by: Q-0333

The owners PR #640 added raised the SDD report's "Tests with incomplete co-tag" count from 1 to 33. Run `pnpm noldor features seed-test-tags`, add the named FDs to each test's `// @tests:` line, and re-run `pnpm noldor garden sdd-report` until the section is empty or every remaining row is explained. Waits on Q-0333 because new `@fd:` headers change which FDs own the imported files.

### SDD Report Honours Ownerless On Purpose

- id: Q-0336
- area: tooling
- type: fix
- since: 2026-09-29
- size: M
- impact: med
- confidence: med

ADR 0009 says a shared helper may have no owner, but the SDD report still counts it as a gap. Detector 9 ("Code files not referenced by any feature") counts every ownerless file, and detector 19 ("Done features without code") counts FDs that #636 emptied on purpose because their code lives in shared files (the five dashboard page FDs, `scripts-reorganization-by-feature-area`, `self-boundaries-declaration-and-cycle-break`). After #640 that leaves 17 + 7 rows that are honest, not gaps, so the counts stop meaning anything. Needs a way to say "ownerless on purpose" — a config list, or an FD sentinel stronger than `['n/a']` — that both detectors read. Surfaced 2026-09-26, PR #640.
