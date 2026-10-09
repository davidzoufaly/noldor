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

### Copy Env Files Names the Failing Entry

- id: Q-0366
- area: tooling
- type: fix
- since: 2026-10-09
- size: XS
- impact: low
- confidence: high

`copyEnvFiles` in `src/worktrees/create-worktree.ts` lets a listed entry that is a directory or unreadable throw a raw EISDIR/EACCES after `git worktree add`, leaving a half-set-up tree (no install, no port) with no hint which entry failed. Catch per file and skip with a log line, or return a result naming the entry. (reviewer low, worktree-copies-local-env-files PR #708, 2026-10-08)

### Arbitration Dispose Docs Wording

- id: Q-0367
- area: tooling
- type: docs
- since: 2026-10-09
- size: XS
- impact: low
- confidence: high

`docs/noldor/cr-pipeline.md` and `script-catalog.md` still say "without --blocker it lists the ids"; since PR #701 the listing form is "only --slug and --kind" (a `--disposition` or `--note` with no `--blocker` stays a usage error). Align the wording in both pages and their `templates/` twins. (arbitration-dispose-lists-blocker-ids PR #701, 2026-10-08)

### README Config-Block Count Drift

- id: Q-0368
- area: tooling
- type: fix
- since: 2026-10-09
- size: XS
- impact: low
- confidence: high

`checks readme`'s config-block axis diffs the backticked names only, so the README's spelled-out count ("Ten optional blocks") can still drift when a block lands. Compare the number word too, or drop it from the README. (readme-config-blocks-check PR #715, 2026-10-08)

### Fill-Links Dry Run Skips Tag-Built FDs

- id: Q-0369
- area: tooling
- type: fix
- since: 2026-10-09
- size: S
- impact: low
- confidence: high

The interactive `fill-links-code-gaps` dry-run proposal still assigns untagged files to tag-built FDs, which `sync code-links` then drops after `--apply`. Apply the same skip PR #706 added to `--auto-high`. (fill-links-skips-tag-built-fds PR #706, 2026-10-08)

- `runAutoHigh`'s fail-closed branch (tag scan failure → warn and apply nothing) has no test; add one with an unreadable file under a scan root. (reviewer low, PR #706)

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
