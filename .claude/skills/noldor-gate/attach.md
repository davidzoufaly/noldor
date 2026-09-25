# /noldor-gate — attach paths

Read by `specs-only-attach` and `full-attach` sessions at Step 2. Holds the prompts, the scaffold, the phase-revert lifecycle, and the scope of the parent-FD refresh at Step 4.

## Scaffold

**Input localization.** When a prompt asks for an input that resolves to an *existing* on-disk file — notably a parent slug (`docs/features/<slug>.md`) — don't ask blind. Run a read-only lookup first (`ls docs/features/`), surface the matching candidates, and echo the resolved path as a clickable link so the operator verifies against the real file instead of recalling it from memory. On a parent-slug prompt: list the existing FD slugs, and once picked echo `docs/features/<slug>.md` as a link before validating it exists.

- `specs-only-attach`: Prompt parent slug (localize per the Input-localization note above). Prompt enhancement slug (`Enhancement slug (short, kebab-case, scopes the spec filename)?`). Validate parent FD exists. Worktree. Session `{ path, parent, enhancement, startedAt, markerVersion: 2 }`. Run the phase-revert sequence below if applicable. `noldor-spec` writing spec named `<date>-<parent>-<enhancement>-design.md`. **After spec returns, run Step 2.5 with `--kind spec`.** On operator approval, advance directly to implementation (no plan stage).
- `full-attach`: Prompt parent slug (localize per the Input-localization note above). Prompt enhancement slug (`Enhancement slug (short, kebab-case, scopes the spec/plan filename)?`). Worktree. Session `{ path, parent, enhancement, startedAt }`. Run the phase-revert sequence below if applicable. `noldor-spec` writing spec named `<date>-<parent>-<enhancement>-design.md`. **After spec returns, run Step 2.5 with `--kind spec`.** On operator approval, continue: the `noldor-plan` skill. **After plan returns, run Step 2.5 with `--kind plan` again.**

## Phase-revert lifecycle

When `full-attach` or `specs-only-attach` runs, the parent FD's phase may need to revert `done → in-progress`. Execute this sequence on the worktree branch immediately after worktree creation and session-marker write.

**Step 1 — apply the revert (no-op when phase is already `in-progress` or `proposed`):**

`pnpm noldor features phase-revert <parent-slug>`

The CLI only writes when the phase actually changes (prevents an empty-diff commit attempt) and works from any consumer repo — no `./src/` import to resolve.

**Step 2 — stage the parent FD + the retired-ID map (`/noldor-promote` attach Step 7 may have just written it), commit only if anything staged:**

`git add docs/features/<parent-slug>.md && git add .noldor/retired-entry-ids.json 2>/dev/null; git diff --cached --quiet -- docs/features/<parent-slug>.md .noldor/retired-entry-ids.json || git commit -m "docs(features:<parent-slug>): revert phase done → in-progress for attach session" -m "Noldor-FD: <parent-slug>" -m "Noldor-Phase-Revert: 1"`

The map is staged here because attach retires its source block through `remove-block --retired-into <parent-slug>` (`/noldor-promote` Step 6.alt), which writes `.noldor/retired-entry-ids.json` but never stages or commits — and every downstream gate commit is pathspec-scoped to the artifact or the FD, so an unstaged map never reaches `main` and the retired ID dangles anyway. Gating on `git diff --cached --quiet` rather than `git diff --quiet <fd>` is what makes the map land in the common case where the phase-revert itself was a no-op (parent already `in-progress`) and the map is the only change. When that happens the subject describes a revert that didn't occur — reword it to `docs(triage): record retired entry ID absorbed into <parent-slug>` and keep both trailers. The second `git add` may fail silently: on an absent map it exits 128, which is why the commit gates on `--cached`, and the `-- <paths>` limiter keeps unrelated pre-staged work out of the commit.

The `Noldor-Phase-Revert: 1` trailer is what [`src/hooks/noldor-validate-trailer.ts`](../../../src/hooks/noldor-validate-trailer.ts) reads to bypass the spec-file existence check on `specs-only-*` / `full-attach` paths. The subject line is informational only — it may be reworded freely without breaking the bypass.

The reverse transition `in-progress → done` is written at Step 4 (`fd-close.md`, the flip) — `flipPhaseToDone` from `src/core/phase-flip-done.ts` flips phase back to `done` in the last commit before merge, so `phase: done` lands on `main` as part of the feature PR. `release-markers.ts:fillMarkers` remains the release-time safety net for any FD that didn't get flipped at end-of-flow.

## Parent-FD refresh scope (Step 4)

Target = `parent`; scoped + Usage-only so a small enhancement can't rewrite the parent FD's story. Changed files = `git diff --name-only origin/main...HEAD` filtered to `/noldor-draft-feature-md`'s source-extension allowlist, excluding the target FD file and anything under `docs/design/`. **If that filter yields zero files, skip the refresh entirely** (treat as no-op — do *not* invoke `/noldor-draft-feature-md`, which aborts on empty scope; this also keeps the autonomous `--yes` pipeline from halting). Otherwise **join the surviving paths with commas** (the `git diff` output is newline-separated; `--scope` wants comma-separated) and invoke `/noldor-draft-feature-md <parent> --refresh --scope <comma-joined paths> --usage-only` (add `--yes` in autonomous mode).
