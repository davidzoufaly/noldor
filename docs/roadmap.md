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

### Worktree Bootstrap Command

- id: Q-0375
- area: tooling
- type: feat
- since: 2026-10-13
- size: S
- impact: high
- confidence: med
- parent: per-task-dev-environment-bootstrap

`worktrees create` should run a consumer-declared bootstrap (e.g. `consumer.worktreeBootstrap: "pnpm build && pnpm build:samples"`): in charuy every fresh worktree fails all vitest suites with "Failed to resolve import @charuy/…" until a build runs — logged 8 times in one week of drains, and a red that only proves a missing build passes as a TDD red. (from charuy ideas.md Lessons, 2026-10-13)

### UI Proof Tests the Developed Feature

- id: Q-0376
- area: tooling
- type: fix
- since: 2026-10-13
- size: S
- impact: high
- confidence: low
- parent: ui-proof-screenshots-on-the-pr

Operator report: UI proof still doesn't test the developed feature. Check first — PR #721 (v1.17.0) made UI proof run the branch's own feature proof test via `uiProof.app.featureSpec`, and charuy has not adopted it yet (see Q-0358). If the gap remains after adoption, find which path still shoots a generic screen instead of the feature. (operator, 2026-10-13)

### CR Delta Round Misreports Empty Delta

- id: Q-0377
- area: tooling
- type: fix
- since: 2026-10-13
- size: S
- impact: high
- confidence: low

The code-stage CR delta round reported "synthetic OK (empty delta)" for reviewer and verifier although `1fb20b2f..HEAD` changed 3 files, so only codex reviewed the fix. The empty-delta check computes the delta wrongly somewhere upstream — reproduce, then fix where the base is resolved. (charuy construction-knowledge-corpus, PR #387, 2026-10-12)

### Worktree Env Fills Keys From Env Example

- id: Q-0378
- area: tooling
- type: feat
- since: 2026-10-13
- size: S
- impact: med
- confidence: high

`worktrees create` copies `.env` from main but not keys that only `.env.example` defines (charuy's `DB_SMOKE_URL`), so every live DB suite silently skips and a green run proves nothing. Fill missing keys from `.env.example`, or have doctor / the verifier warn when a smoke URL is absent. (from charuy ideas.md Lessons, 2026-10-13)

### FD Writers Keep the Blank Line After Frontmatter

- id: Q-0379
- area: tooling
- type: fix
- since: 2026-10-13
- size: XS
- impact: low
- confidence: high

`phase-flip-done` and `sync test-links` still drop the blank line after an FD's frontmatter (fixed by hand twice in one session). Same loss as the earlier `sync code-links` bug; fix it once in the shared FD writer. (charuy build-section-phases-parts-and-materials-priced, PR #389, 2026-10-12)

### PR Flow Skips Auto-Merge When the Repo Disables It

- id: Q-0380
- area: tooling
- type: fix
- since: 2026-10-13
- size: XS
- impact: low
- confidence: high

pr-flow always tries `gh pr merge --auto`, which consumer repos with auto-merge disabled refuse ("Auto merge is not allowed for this repository"), then falls back to a direct squash-merge every time — including on fast/* branches. Detect `enablePullRequestAutoMerge` once (`gh api repos/:owner/:repo`) and skip the attempt when it is off, or document enabling it as a consumer setup step. (charuy PRs #444, #455, 2026-10-12; also charuy backlog Q-0147)

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

### Drain Supervisor Reports Progress Every Minute

- id: Q-0381
- area: tooling
- type: feat
- since: 2026-10-13
- size: S
- impact: med
- confidence: med

In drain mode the main thread (the agent that started the drain) should poll the drain log about once a minute and tell the operator in text what finished, so progress is visible without asking. (operator, 2026-10-13)

### Verify Force Reaches Turbo

- id: Q-0382
- area: tooling
- type: fix
- since: 2026-10-13
- size: S
- impact: med
- confidence: med

`pnpm verify --force` does not force turbo: pnpm appends the flag to the last chained script (`pnpm test`), which rejects it or exits 1 after a fully cached run. Give verify a real uncached mode, or document running plain `pnpm verify` and reading the `Cached:` line, or `pnpm exec turbo run test --force` separately. (charuy PRs #386, #503, 2026-10-11..13)

### Compare Lanes Pair Each Final Page

- id: Q-0383
- area: tooling
- type: fix
- since: 2026-10-13
- size: M
- impact: high
- confidence: med

render-compare and geometry-compare answer `cannot-review: page-ambiguous` — and the review stays green while those lanes check nothing — in two cases: (a) a feature .pen keeps a VARIANT page beside its FINAL pages; (b) a design holds several FINAL pages (charuy's bathroom-fixture-bath design, and the Build design's `FINAL:app: build …` pages). Ignore VARIANT pages when picking the compare page, pair each FINAL page with its own captured state, and fail the round rather than pass when no pairing is possible. (charuy PRs #367, #386, #389, 2026-10-08..12)

### PR Flow Body From the Trailer Commit

- id: Q-0384
- area: tooling
- type: fix
- since: 2026-10-13
- size: S
- impact: med
- confidence: med

pr-flow on a fast-track entry with no FD falls back to a "Micro-chore: <first commit subject>" PR body, and picks the first commit (often the roadmap-retirement commit) rather than the fix commit that carries Why/How/What. Build the body from the commit that carries the trailer sections, or from the retired roadmap block. Separately, after the squash merge its remote-branch delete failed with "cannot lock ref" (and on PR #455 tried to delete a branch already gone) — make the delete idempotent and quiet. (charuy PRs #402, #436, #455, 2026-10-12)

### Indirection Ratchet Names the Edges

- id: Q-0385
- area: tooling
- type: feat
- since: 2026-10-13
- size: S
- impact: med
- confidence: med
- parent: abstraction-cost-ratchet

The indirection ratchet reports only "+N excess". Name the import edge(s) and closure(s) that added it, and suggest the known fixes (mount from a parent whose closure already holds it, export beside the primitive, local structural type instead of a type-only import). Charuy hit it 6 times in a week. (from charuy ideas.md Lessons, 2026-10-13)

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
