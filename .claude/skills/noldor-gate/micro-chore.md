# /noldor-gate — micro-chore

Read by `micro-chore` sessions at Step 2. Holds the scaffold, the temp-branch handoff, the roadmap-entry retirement and the merge cleanup; Step 4 runs only `pr-flow` and the cleanup below.

## Scaffold

Confirm diff scope (pre-commit allowlist enforces, see [`src/core/allowlist.ts`](../../../src/core/allowlist.ts)). Write session marker `{ path: 'micro-chore', startedAt }` (the `startedAt` timestamp is required by the schema and drives the 24h staleness expiry — see the Noldor FD Usage "Session-marker expiry"). Include `slug: <roadmap-slug>` when the session was entered from a Step 0 roadmap pick; its block is then retired inside this commit (see **Roadmap-entry retirement** below). No worktree — edits land on local `main`, so **sync it before the first edit**: `git fetch origin main && git merge --ff-only origin/main` (a worktree gets this from `worktrees create`; local `main` is routinely one commit behind, because the graph-refresh PR merges itself after the previous session's end-of-flow sync). If `--ff-only` rejects, local `main` has commits `origin/main` lacks — stop and surface the divergence rather than editing on top of it. Commit. After commit, gate scaffolds the temp-branch handoff so Step 4 can deliver the change via PR:

1. `branch=micro/$(date -u +%s)` — epoch seconds, unique + sortable.
2. `git branch $branch HEAD` — point temp branch at the new commit.
3. `git stash push --include-untracked -m noldor-microchore` — park any *unrelated* uncommitted edits before the rewind. The step-1 commit already holds the micro-chore change itself; this protects every *other* dirty working-tree file (notably in-flight `ideas.md`/roadmap edits) from the `reset --hard` below. On a clean tree this no-ops and creates no stash entry.
4. `git reset --hard origin/main` — rewind local main (keeps the PR shape: temp branch is the only commit ahead of `origin/main`). The step-3 stash is what keeps this reset from destroying unrelated working-tree edits: uncommitted content never enters git's object store, so nothing could recover it afterwards.
5. `git stash list | grep -q noldor-microchore && git stash pop` — restore the parked edits on top of the rewound main, only when step 3 actually stashed something. A pop conflict means an unrelated edit overlaps a file the micro-chore commit also touched; surface it to the operator instead of forcing.
6. `git checkout $branch` — switch onto the temp branch before Step 4. `pnpm noldor pr-flow` reads the branch from `HEAD`, so run from the rewound `main` it exits with `no commits ahead of origin/main on current branch`. Any files step 5 popped back stay dirty in the working tree and ride along harmlessly: the checkout keeps them, and `pr-flow` pushes commits, not the working tree. The one exception: a popped file the micro-chore commit also changed differs between `main` and the temp branch, so the checkout refuses (`local changes would be overwritten`) — surface it to the operator, as with a pop conflict.
7. Step 4 end-of-flow takes over: `pr-flow.ts openAndAutoMerge()` pushes the temp branch, opens a PR (body = `Micro-chore: <commit subject>`), auto-merges, then `git checkout main` + `git branch -D $branch` (git refuses to delete the checked-out branch) + `git fetch origin main` refreshes the local main pointer.

Trade-off: working tree is briefly "ahead of `origin/main`" between commit and reset (5-10s window). Multi-commit micro-chore is not supported in a single session — second commit fails the pre-commit allowlist (existing single-commit invariant).

## Roadmap-entry retirement

A micro-chore session entered from a roadmap pick (a `micro-chore` `suggestedPath`) carries `slug` and must retire the entry, or the shipped entry re-surfaces at the next gate. The retirement rides the micro-chore commit instead of preceding it, because the session is single-commit. Run `pnpm noldor roadmap remove-block <slug>` on `main` before that commit — it is idempotent (an absent slug prints `nothing to do` and exits 0), and when the removed block carries an `- id:` it records the ID in `.noldor/retired-entry-ids.json` so `blocked-by:` references to it keep resolving. Then stage `docs/roadmap.md` — and `.noldor/retired-entry-ids.json` when the CLI wrote it — alongside the change. Both are micro-chore paths, so the one commit carries the change and its retirement, and it reaches `main` through the same temp-branch PR. The hook injects `Noldor-Path: micro-chore` and `Noldor-FD: <slug>` from the marker; the micro-chore validator checks the staged paths, not the FD.

## Merge cleanup

`git checkout main` (a no-op when `gh` already switched back) + `git branch -D <temp-branch>` + `git fetch origin main && git rebase origin/main` to refresh the local main pointer. Local main must match `origin/main` before the session exits.
