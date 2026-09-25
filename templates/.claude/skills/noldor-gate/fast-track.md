# /noldor-gate — fast-track

Read by `fast-track` sessions at Step 2. Holds the scaffold, the roadmap-entry retirement, and the doc-impact check Step 4 runs before the push-gate preflight.

## Scaffold

Create the worktree via `pnpm noldor worktrees create <short-desc> --branch fast/<short-desc>`. Write session marker `{ path: 'fast-track', startedAt }` — include `slug: <roadmap-slug>` when this fast-track was entered from a Step 0 roadmap pick (an XS/S `suggestedPath`). Branch named `fast/<short-desc>`. No FD. When the marker carries a `slug`, run the **Roadmap-entry retirement** sequence below so the shipped entry leaves the queue. A commit that mixes code with `docs/noldor/` pages keeps its code scope only with a `Noldor-Sibling-Scope: noldor:<page>, …` trailer naming every staged page (see [`git-and-commits.md`](../../../docs/noldor/git-and-commits.md) § Sibling doc-sync commits) — the commit-msg hook refuses it otherwise.

## Roadmap-entry retirement

When a `fast-track` session was entered from a Step 0 roadmap pick (XS/S `suggestedPath`), its session marker carries `slug`. Unlike `/noldor-promote` — which removes the source block as it scaffolds an FD — `fast-track` creates no FD, so the source roadmap block must be retired explicitly or the shipped entry re-surfaces at the next gate. Execute this on the worktree branch immediately after worktree creation + session-marker write. Skip entirely when the marker has no `slug` (ad-hoc fast-track not tied to a roadmap entry).

**Step 1 — remove the block (built-in no-op when the slug is already absent):**

`pnpm noldor roadmap remove-block <slug>`

The CLI is idempotent — an absent slug prints `nothing to do` and exits 0 (re-run safety). It works from any consumer repo; there is no `./src/` import to resolve. When the removed block carries an `- id:`, the CLI also records it in `.noldor/retired-entry-ids.json` (the retired-ID map) so `blocked-by:` references to the retired entry keep resolving.

**Step 2 — stage the roadmap + the retired-ID map (the CLI may have just created it), commit only if anything staged:**

`git add docs/roadmap.md && git add .noldor/retired-entry-ids.json 2>/dev/null; git diff --cached --quiet -- docs/roadmap.md .noldor/retired-entry-ids.json || git commit -m "docs(roadmap): retire <slug> — shipped via fast-track (no FD)"`

The second `git add` is allowed to fail silently: when the map file does not exist (the removed block carried no `- id:`, or the repo has never retired one), `git add` on that pathspec exits 128. Staging first and gating on `--cached` keeps the commit alive in every case. The `-- <paths>` limiter on the gate is what keeps the commit **scoped**: without it the gate fires on any staged content, so unrelated pre-staged work would land under a retirement subject. `git diff --cached --quiet -- <existing> <missing>` exits 0 rather than fatalling on the absent map (only the pathspec-less `git diff <path>` form exits 128), so the limiter is safe in the no-map case too.

The `prepare-commit-msg` hook injects `Noldor-Path: fast-track` from the session marker — and, when the marker carries a `slug`, a `Noldor-FD: <slug>` trailer too (the hook injects from `slug` unconditionally; the commit-msg validator ignores it on fast-track, where no FD file is required). The block is removed on the feature branch and lands on `main` when the fast-track PR merges — keeping retirement atomic with the shipped change rather than a separate edit on `main`.

## Doc-impact check (Step 4)

Runs before the push-gate preflight. A fast-track has no FD, but the code it changed may be what other FDs document:

1. `pnpm noldor features owners --base origin/main` lists every FD owning a changed file. A `candidate` is `phase: done` with a written `## Usage`; an in-progress FD belongs to its own session. Exit 2 means the list could not be built — fix what it names, and never read it as "no owners".
2. For each candidate, judge whether this change alters what its User Story or Usage says. For each that it does, update the FD: `/noldor-draft-feature-md <slug> --refresh --scope <its owned changed files, comma-joined> --usage-only` (add `--yes` in autonomous or drain mode), or a hand edit when the change is one flag or one line.
3. Record the outcome as a trailer. FDs updated → commit them (`docs(features:<slug>): …`, or `docs(features): …` for several) with `Noldor-Doc-Impact: <slug>, <slug>`. None updated, or no candidates → `git commit --amend --no-edit --trailer 'Noldor-Doc-Impact: none'` on the tip: a message-only amend, so the tree is unchanged. The commit-msg hook refuses a value that is neither `none` nor existing FD slugs.

A later fix commit that changes documented behaviour updates the FD the same way; the declaration already on the branch stays. `garden detect` reports fast-tracks that skipped this step under `undeclaredDocImpact`.
