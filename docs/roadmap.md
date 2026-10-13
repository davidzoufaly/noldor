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

### Gate Skill Wording Micro-Chore

- id: Q-0388
- area: tooling
- type: docs
- since: 2026-10-13
- size: XS
- impact: med
- confidence: high

Two `.claude/skills/noldor-gate/**` edits (plus `templates/` twins), which a fast-track worktree refuses, so they need their own micro-chore PR: (a) `fast-track.md` and the Step 0 entry pick should tell an interactive session to run `pnpm noldor triage source <slug>` before the first edit, as `drain-mode.md` already does; (b) `blockers.md` still says "(without --blocker it lists the ids)" for `cr arbitration dispose`; since PR #701 the listing form is "only --slug and --kind". (PRs #727, #750, 2026-10-13)

### Stale Docs Sweep

- id: Q-0389
- area: tooling
- type: docs
- since: 2026-10-13
- size: XS
- impact: low
- confidence: high

Two doc drifts: (a) grep `drop-lane` / `standalone-in-progress` across `docs/` — the cr-pipeline.md gotcha named a guard that no longer exists in src/, and other pages may still name it; (b) `docs/noldor/worktree-discipline.md` and `docs/noldor/adoption-guide.md` (worktreeEnvFiles) list only the "main workspace lacks it" and "branch tracks it" skips — add the uncopyable-entry skip from PR #748. (PRs #725, #748, 2026-10-13)

### Charuy Adopts Next Release

- id: Q-0358
- area: tooling
- type: chore
- since: 2026-10-08
- size: S
- impact: med
- confidence: med

Roll the next release out to charuy: run `noldor upgrade` + `noldor init --update` there (its `ideas.md` has no `## Lessons`; the first retro scaffolds it), and add `animations: 'disabled'` + `test.use({ reducedMotion: 'reduce' })` to its proof tests, now that UI proof can be skipped with `Noldor-UI-Proof: skip`. (session-retro-auto-capture PR #687, ui-proof-skip PR #693, 2026-10-08)

- charuy can drop its inline `.env.example` DATABASE_URL workaround (charuy PR #362) by setting `consumer.worktreeEnvFiles: [".env"]` once it runs the release that ships PR #708. (worktree-copies-local-env-files PR #708, 2026-10-08)
- charuy has no `consumer.uiProof.app.featureSpec`, so every charuy PR shows the `fixed screens, not this feature` note — set `uiProof.app.featureSpec` (e.g. `apps/web/e2e/proof/{slug}.spec.ts`) plus a command naming `{spec}` once it runs the release carrying PRs #721/#731. (PRs #721, #731, 2026-10-13)

### Compare Lanes Pair Each Final Page

- id: Q-0383
- area: tooling
- type: fix
- since: 2026-10-13
- size: M
- impact: high
- confidence: med

render-compare and geometry-compare answer `cannot-review: page-ambiguous` — and the review stays green while those lanes check nothing — in two cases: (a) a feature .pen keeps a VARIANT page beside its FINAL pages; (b) a design holds several FINAL pages (charuy's bathroom-fixture-bath design, and the Build design's `FINAL:app: build …` pages). Ignore VARIANT pages when picking the compare page, pair each FINAL page with its own captured state, and fail the round rather than pass when no pairing is possible. (charuy PRs #367, #386, #389, 2026-10-08..12)

### Drain the Dead-Code Baseline

- id: Q-0360
- area: tooling
- type: refactor
- since: 2026-10-08
- size: M
- impact: med
- confidence: med
- parent: dead-code-detection-with-knip

Drain the dead-code baseline (`.noldor/dead-code-baseline.json`, 389 findings at PR #679): delete `src/release/release-dry-run.ts` and `src/invariants/.dependency-cruiser.cjs` (nothing loads either), fix the type import of the missing `../validate-pushed-summaries.js` in `src/hooks/__tests__/validate-pushed-adrs.test.ts:6` (tests are not typechecked, so it is silent), then work through the unused exports/types and re-record. (dead-code-detection-with-knip, PR #679, 2026-10-07)

- `dead-code check` on main reports 2 recorded findings now gone — run `pnpm noldor dead-code baseline` to lock the ratchet in. (PR #746, 2026-10-13)

### Argv Free-Text Verbs Take a File

- id: Q-0361
- area: tooling
- type: fix
- since: 2026-10-08
- size: M
- impact: med
- confidence: med

Other `pnpm noldor` verbs still take free text on argv (`design log --decide/--because/--instead-of/--support`, `cr arbitration dispose --note`, `commit -m`); in this repo pnpm's `sh` expands backticks and `$(...)` in them the same way. Give them a file or stdin input, as `triage retro --file` now has. (retro-notes-from-file, PR #689, 2026-10-08)

### Refactor Report Dead-Code Section

- id: Q-0362
- area: tooling
- type: feat
- since: 2026-10-08
- size: S
- impact: low
- confidence: med
- parent: dead-code-detection-with-knip

`/noldor-refactor` "Dead Code" report section: when `deadCode.enabled` is on, run `pnpm noldor dead-code check` after the refactor and list what it reports outside the baseline. Promised in the consumers spec; a `.claude/skills/**` edit plus its `templates/` twin, so it needs its own micro-chore PR. (dead-code-detection-with-knip consumers, PR #681, 2026-10-07)

### Pr-Flow Fast-Track PR Body

- id: Q-0390
- area: tooling
- type: fix
- since: 2026-10-13
- size: S
- impact: med
- confidence: med

On a fast-track session with no FD, pr-flow warns ENOENT on `docs/features/<slug>.md` and falls back to a "Micro-chore: <first commit subject>" PR body, even though the first non-doc commit carries Why/How/What. Take the fast-track PR body from that commit instead. (PR #737, 2026-10-13)

### Worktree Create Subprocess Deadline

- id: Q-0391
- area: tooling
- type: fix
- since: 2026-10-13
- size: S
- impact: med
- confidence: med

`worktrees create` runs `consumer.worktreeBootstrap` and `pnpm install` with no timeout, so a hung build hangs the create and any drain child waiting on it. Add a deadline to both subprocess waits. (CR low, PR #729, 2026-10-13)

### Sync Code-Links Branch Drift

- id: Q-0392
- area: tooling
- type: fix
- since: 2026-10-13
- size: S
- impact: med
- confidence: med

Running `sync code-links` on a branch rewrites unrelated FDs (memory-intake-lessons-learned-pipeline gained `src/triage/ideas-lock-cli.ts` and lost a blank line), because that FD's `links.code` has drifted on main. Fix the drift on main and keep a branch run from touching FDs outside its scope. (PR #721, 2026-10-09)

### Fill-Links Dry-Run Hardening

- id: Q-0393
- area: tooling
- type: fix
- since: 2026-10-13
- size: S
- impact: med
- confidence: med

Two fill-links-code-gaps follow-ups: (a) `runDryRun` trusts the LLM tie-break's `chosen_fd_slug` unchecked — `parseLlmResponse` accepts any slug, so a hallucinated tag-built or unknown FD could land in the proposal; validate it against the shown candidates; (b) the unreadable-file tests (`runAutoHigh`, `runDryRun`) rely on `chmodSync(…, 0o000)`, which does not hold under root (some CI containers); `skipIf` on `process.getuid?.() === 0`. (PR #753, 2026-10-13)
