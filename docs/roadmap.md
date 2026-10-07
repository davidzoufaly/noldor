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

### Graph and Main Freshness Before Coding

- id: Q-0341
- area: tooling
- type: feat
- since: 2026-10-07
- size: M
- impact: med
- confidence: med

Graph freshness is checked once per session, at the spec's structural-read step, and never again (surfaced 2026-10-04, charuy Q-0145). `noldor-spec` step 1.7 runs `design graph-context`, rebuilds on `stale`, reads the digest, then restores `graphify-out/`. Nothing re-checks before implementation starts, during it, or before the code-stage CR, so a long session (spec → 3 review rounds → code) can plan and code against a graph the tree has moved past, and other sessions' merges to `origin/main` mid-session are never pulled in. Worktrees branch from `origin/main` at create time and `pr-flow` fetches at the end, but nothing fetches in between. Options: (a) gate Step 3.5 (rule brief before the first edit) also runs `design graph-context` over the files about to be touched and rebuilds locally on `stale` (~15 s, restored afterwards, never committed); (b) a `git fetch origin main` + "main moved N commits since worktree create" notice at the same seam, so the operator can merge main in before coding rather than at push.

### Dead-Code Detection with knip

- id: Q-0342
- area: tooling
- type: feat
- since: 2026-10-07
- size: M
- impact: med
- confidence: med

Nothing in the framework finds dead code (unused files, unused exports, unused and unlisted dependencies). `noldor clones` finds code that exists twice, not code that should not exist; the `/noldor-refactor` report's "Dead Code" section is filled in by hand; the dashboard already looks for an "Unused Exports" count (`src/dashboard/data.ts:2125`) that nothing produces. Two steps, both wanted: (1) noldor itself — add knip as a devDependency, run it in pre-push or CI, and ratchet it like `clones` (a recorded baseline; the count may not rise); ships nothing to consumers. (2) Consumers — an opt-in check that runs only when the consumer has knip installed, feeds the same ratchet, and surfaces the counts in `sdd-report`, the dashboard slot above, and the `/noldor-refactor` Dead Code section. Do (1) first and let it prove itself, then (2).

### UI Proof Screenshots on the PR

- id: Q-0343
- area: tooling
- type: feat
- since: 2026-10-07
- size: M
- impact: med
- confidence: low

When a feature touches UI, the PR should carry a screenshot of it working as proof — and when the feature is e2e-tested on the UI end, the screenshot comes from that run. Today a UI change ships with a text-only PR body, so a reviewer has to check out the branch to see the result. Capture screenshots from the e2e/verify run (or a dedicated capture step) and attach them to the PR body via `pr-flow`.
