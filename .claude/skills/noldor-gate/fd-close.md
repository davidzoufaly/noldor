# /noldor-gate — FD close-out (Step 4)

Read by FD-carrying sessions (`specs-only-*`, `full-*`) at Step 4. Holds the FD body refresh, the design-artifact archive, the phase flip, and bootstrap immunity, in the order the router's checklist runs them.

## Refresh the feature-MD body

Run `/noldor-draft-feature-md --refresh` *before* the phase-flip below, so the refreshed `User Story` / `Usage` ride the same commit and are seen by the code-stage CR. Resolve target + scope by path:

- **New-FD paths** (`specs-only-new`, `full-new`): target = `slug`; full `links.code` / `links.tests`; both sections. Invoke `/noldor-draft-feature-md <slug> --refresh` (add `--yes` in autonomous mode).
- **Attach paths** (`specs-only-attach`, `full-attach`): target, scope and the zero-file skip come from `attach.md` → Parent-FD refresh scope.

`/noldor-draft-feature-md` never stages or commits — the flip step below commits the refreshed body together with `phase: done`. In autonomous mode `--yes` runs it non-interactively (no prompt). Because the flip commits the refreshed FD onto the branch, it rides the `origin/main..HEAD` diff that the code-stage CR reviews (that step passes `--base-sha origin/main`) — that is the mechanism behind "reviewed by the code-stage CR".

## Archive this session's design artifacts

Immediately before the flip below, so the move rides the same commit. The flip commit records the *index*, so assert it is empty first:

`git diff --cached --quiet || { echo "index not empty before flip — resolve by hand"; exit 1; }`

`pnpm noldor design archive`

The CLI ([`src/design/archive-cli.ts`](../../../src/design/archive-cli.ts)) reads `.noldor/session.json`, resolves the artifacts this session owns (dialogue key `<slug>` on `*-new` / `<parent>-<enhancement>` on `*-attach`, gated on the branch-added set so a filename collision can never reach a foreign feature's live spec), `git mv`s them into their sibling `archive/` directory and **leaves the moves staged**. It never commits. Exit 0 with `nothing to do` on a re-run, and with an explanatory line on `fast-track` / `micro-chore` (no artifacts) — so the seam is safe to run unconditionally. Add `--dry-run` to preview.

Do NOT pass a `docs/design` pathspec to `git add`/`git commit` here: `loadDocRoots` still resolves design subdirs through the 1.0.0 transition alias, so on a not-yet-migrated consumer the artifacts live under `docs/superpowers/*`. The CLI stages its own moves precisely for this reason.

Garden's `detectStaleSpecs` / `detectStalePlans` remain the backstop for exceptions (pre-flip-era debt, skipped flips, orphans, age-outs).

## Flip FD `phase: in-progress → done`

For all FD-carrying paths (`specs-only-new`, `specs-only-attach`, `full-new`, `full-attach`). Read `slug` (new-FD paths) or `parent` (attach paths) from `.noldor/session.json`. Then commit the index — FD plus the archive moves staged above:

`pnpm noldor features phase-flip-done <slug>`

`git add docs/features/<slug>.md`

`git diff --cached --quiet || git commit -m "docs(features:<slug>): mark phase=done + archive design artifacts" -m "Noldor-FD: <slug>"`

On attach paths the subject is `docs(features:<parent>): mark phase=done + archive design artifacts` (the refresh is Usage-only); mention `+ refresh User Story/Usage` instead when the refresh produced a body change and nothing was archived. `<slug>` is the new-FD slug or the parent slug per path. This single commit now carries the refreshed body, `phase: done`, and the archived spec/plan. Because the archive moves are already staged, the `--cached` check (not `git diff --quiet <fd>`) is what decides whether to commit — a move-only change with an unchanged FD body must still land.

`release-markers.ts:fillMarkers` remains the release-time safety net for any FD that didn't get flipped at end-of-flow (forgot, manual commits, etc.) — its branches still accept `phase: in-progress + introduced` as input. Trade-off: the `### <version> (in-progress)` changelog label renders only for FDs caught by that safety net, never for an enhancement cycle whose Step 4 flip succeeded.

## Bootstrap immunity (gate-introducing FDs only)

Run `pnpm noldor cr bootstrap --slug <slug>`. If the FD's frontmatter declares `introduces-gate`, this rewrites every commit on the worktree branch to carry the matching bootstrap override so the release gate the feature introduces can't block its own commits. No-op otherwise (`no introduces-gate — skipped`). Runs **after** the code-stage review amends `Noldor-Reviewed-Subagent` on the tip (the rewrite is message-only, tree-preserving, so review receipts stay valid) and **before** `pnpm noldor pr-flow` (so the history rewrite stays local, pre-push).
