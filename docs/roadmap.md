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

### Fill-Links Skips Tag-Built FDs

- id: Q-0347
- area: tooling
- type: fix
- since: 2026-10-08
- size: S
- impact: high
- confidence: high
- parent: dead-code-detection-with-knip

Pre-commit `features fill-links-code-gaps --auto-high` adds an untagged file to an FD whose links.code is tag-built, and the same commit warns that `sync code-links` will drop it, so every commit leaves that FD dirty (charuy: `apps/web/src/components/build/money.ts`). The auto-high pass should skip FDs that carry `// @fd:` tags. (charuy-noldor-1-16-0, PR #362, 2026-10-08)

### Worktree Copies Local Env Files

- id: Q-0350
- area: tooling
- type: feat
- since: 2026-10-08
- size: S
- impact: high
- confidence: med
- parent: parallel-worktree-workflow

`noldor worktrees create` leaves the gitignored root `.env` behind, so a consumer `verifyCommands` entry that needs it fails in every worktree. charuy's `server` surface exited on DATABASE_URL until charuy PR #362 set the .env.example default inline. Copy a configured list of local env files into the worktree, or say so in worktree-discipline.md. (charuy-noldor-1-16-0, PR #362, 2026-10-08)

### Dead-Code Baseline Diffs Across Knip Drift

- id: Q-0351
- area: tooling
- type: fix
- since: 2026-10-08
- size: S
- impact: med
- confidence: high
- parent: dead-code-detection-with-knip

`noldor dead-code baseline` re-records silently when the old baseline is "unreadable" only because of knip/algorithm version drift — its `issues` array is still well-formed, so a finding that lands alongside a knip bump is absorbed without the ADDED/dropped diff. Diff against the parsed issues whenever the schema parse succeeded. (reviewer low, PR #679, 2026-10-07)

### Gate CR Cleanup After Merge

- id: Q-0352
- area: tooling
- type: fix
- since: 2026-10-08
- size: S
- impact: med
- confidence: high

Gate Step 4 context cleanup deletes the autofix ledger and decision store before `pr-flow`; when the merge then fails and the branch is rebased and re-reviewed, the round cap restarts and earlier operator rulings are no longer shown to lanes. Move the cleanup after the merge. (session-retro-auto-capture, PR #687, 2026-10-08)

### SDD Gaps After v1.16.0

- id: Q-0353
- area: tooling
- type: chore
- since: 2026-10-08
- size: S
- impact: med
- confidence: high

SDD gaps left after the v1.16.0 garden pass: links.code is stale against `// @fd:` tags on dead-code-detection-with-knip and graph-and-main-freshness-before-coding (`pnpm noldor sync code-links`; the second also reads "done without code"), 4 tests miss FD co-tags (pr-flow-ui-proof, ui-proof, sdd-report-dead-code, code-freshness), and `src/migrations/1.16.0.ts` + `src/worktrees/code-freshness*.ts` have no owning FD. (release-sweep-v1-16-0, PR #691, 2026-10-08)

### README Config Blocks Check

- id: Q-0354
- area: tooling
- type: feat
- since: 2026-10-08
- size: S
- impact: med
- confidence: high

README's Configuration section hand-lists the optional `.noldor/config.json` blocks and drifted when `deadCode` landed (caught only by the v1.16.0 sweep's read-through). `checks readme` could compare that list with the `noldorConfigSchema` keys so the next new block fails the check. (readme-config-blocks-drift, PR #692, 2026-10-08)

### Arbitration Dispose Lists Blocker IDs

- id: Q-0355
- area: tooling
- type: fix
- since: 2026-10-08
- size: XS
- impact: low
- confidence: high

`cr arbitration dispose --slug <s> --kind <k>` with no other flags prints usage (exit 2) instead of the blocker-id list its help promises; the list appears only once `--disposition` and `--note` are set. (session-retro-auto-capture, PR #687, 2026-10-08)

### Dead-Code Guide Ignore Build Output

- id: Q-0356
- area: tooling
- type: docs
- since: 2026-10-08
- size: XS
- impact: low
- confidence: high
- parent: dead-code-detection-with-knip

The adoption guide's dead-code setup should tell consumers to ignore build output in their knip config (`**/dist/**`). charuy recorded its baseline in a fresh worktree, then the main checkout's stale `dist/*.d.ts` failed the pre-push check (charuy PR #363). (charuy-noldor-1-16-0, PR #362, 2026-10-08)

### Gate Load Budget Headroom

- id: Q-0357
- area: tooling
- type: chore
- since: 2026-10-08
- size: S
- impact: med
- confidence: med

specs-only-new gate load is 6841 of 6844 words after #685 + #687; the next gate prose addition must trim first, or the half-of-pre-split budget needs revisiting. (session-retro-auto-capture, PR #687, 2026-10-08)

### Charuy Adopts Next Release

- id: Q-0358
- area: tooling
- type: chore
- since: 2026-10-08
- size: S
- impact: med
- confidence: med

Roll the next release out to charuy: run `noldor upgrade` + `noldor init --update` there (its `ideas.md` has no `## Lessons`; the first retro scaffolds it), and add `animations: 'disabled'` + `test.use({ reducedMotion: 'reduce' })` to its proof tests, now that UI proof can be skipped with `Noldor-UI-Proof: skip`. (session-retro-auto-capture PR #687, ui-proof-skip PR #693, 2026-10-08)

### Shared Lock Module

- id: Q-0359
- area: tooling
- type: refactor
- since: 2026-10-08
- size: XS
- impact: low
- confidence: med

Move the lock-wait helper (`acquireSuiteLock`/`releaseSuiteLock`) out of `src/testing/suite-lock.ts` into a shared lock module; `src/triage/retro-cli.ts` imports it from test infrastructure (new undrawn `src/triage -> src/testing` edge). (session-retro-auto-capture, PR #687, 2026-10-08)

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

### Ideas-md Writers Take the Lock

- id: Q-0363
- area: tooling
- type: fix
- since: 2026-10-08
- size: S
- impact: low
- confidence: med

`/noldor-triage`, `/noldor-absorb` and hand edits write `ideas.md` without `noldor-ideas.lock`, so a retro landing mid-edit can drop the other write (CR low). (session-retro-auto-capture, PR #687, 2026-10-08)
