---
name: noldor-milestone
description: Manage Noldor milestones independent of semver — draft, activate, edit, or list milestones at `docs/milestones/<slug>.md`. Vision's `current-milestone:` frontmatter points at the active milestone file. Milestones are optional; framework works fine without one.
user_invocable: true
---

# /noldor-milestone — Manage Noldor milestones

## Inputs

- **sub-command** (required) — `draft`, `activate`, `edit`, or `list`.
- **slug** (varies per sub-command) — kebab-case codename matching `docs/milestones/<slug>.md`. Required for `activate` and `edit`. Optional for `draft` (skill proposes a codename if omitted).

## Sub-commands

### `/noldor-milestone draft [<slug>]`

1. If `<slug>` omitted: ask the operator for a theme (one-line seed describing the milestone's strategic intent), then propose a kebab-case codename and confirm via `AskUserQuestion` ("Use `<proposed>`? Or rename to: \_\_\_\_"). Iterate until the operator accepts.
2. Ask the operator for an optional `description` (one-liner) via `AskUserQuestion` ("Add a description? Or leave blank.").
3. Run `tsx src/milestones/cli.ts draft <slug> [<description>]` from the repo root.
4. Tell the operator: `Drafted docs/milestones/<slug>.md with status: draft. Edit it to fill in ## Gate, ## Success Criteria, ## Out of Scope.`
4.5. **Target architecture (optional, when `docs/design/architecture/baseline.pen` exists).** Ask whether to sketch the milestone's target architecture. Take this step only once the operator has filled `## Gate`, `## Success Criteria` and `## Out of Scope` — the verdict binds the milestone file's text, so it must come last — and otherwise offer it again from `/noldor-milestone edit`. On yes:
   1. `cp docs/design/architecture/baseline.pen docs/design/architecture/milestones/<slug>.pen`, open it with `pnpm noldor design pen-bridge --pen docs/design/architecture/milestones/<slug>.pen`, and confirm with `get_app_state` that it is the open document before any write.
   2. Rename the four pages `BASE:<view>: as-built`, draw the target on a `Copy` of each view it changes, and rename each such copy `FINAL:<view>: <name>`. Keep the layer-name contract (module boxes named by path, groups `group: <Name>`, arrows `<from> -> <to>`), and after moving boxes save and run `pnpm -s noldor design arch-route --pen docs/design/architecture/milestones/<slug>.pen --view <view>`, passing its stdout to `execute`.
   3. Add an `## Architecture target` section to `docs/milestones/<slug>.md` linking `../design/architecture/milestones/<slug>.pen` — before the verdict, for the same reason.
   4. Take the verdict: `pnpm noldor design verdict --pen docs/design/architecture/milestones/<slug>.pen --approve --surface <view> [--surface <view>...] --milestone <slug> --editor-page "<name>" [--editor-page "<name>"...]` (one `--editor-page` per page the editor lists).
   The operator's micro-chore commit carries the milestone file, the target `.pen` and `.noldor/design-approval/architecture/milestones/<slug>.json` together.
5. Do NOT stage or commit.

### `/noldor-milestone activate <slug>`

0. Read `current-milestone:` from `docs/vision.md`'s frontmatter — the milestone this activation will flip to `shipped`, if any. The CLI names only the one it activates.
1. Run `tsx src/milestones/cli.ts activate <slug>` from the repo root.
2. On success, surface: `Activated <slug>. Previous active milestone (if any) flipped to shipped. docs/vision.md frontmatter updated.`
2.5. The CLI rewrote `status:` in both milestone files, which drifts any target record bound to them. For the milestone just activated, and for the one step 0 read, whenever `docs/design/architecture/milestones/<that slug>.pen` has a record: run `pnpm noldor design verdict --pen docs/design/architecture/milestones/<that slug>.pen --reconfirm`. The design is unchanged, so reconfirming rebinds it to the flipped file; stage the rewritten records with the activation.
2.6. When the milestone step 0 read has a target, run `pnpm noldor design arch-progress --milestone <that slug>` and surface its report. Advisory — it never blocks the activation; `to-build` rows are what the shipped milestone left undone.
3. On error (target missing, shipped, multi-active corruption, etc.), surface the CLI's stderr message and stop. Do NOT attempt manual workarounds.
4. Do NOT stage or commit.

### `/noldor-milestone edit <slug>`

1. Verify `docs/milestones/<slug>.md` exists. If not, tell operator: `No milestone at docs/milestones/<slug>.md. Use /noldor-milestone draft <slug> to create one.`
2. Read the file. Surface its current contents to the operator.
3. Ask the operator what to change. Apply edits via the Edit tool — never modify the `name` or `status` fields (status mutates only via `/noldor-milestone activate`).
4. Run `pnpm noldor validate milestones` after edits.
4.5. When the milestone has a target (`docs/design/architecture/milestones/<slug>.pen`): a target sketched now follows `draft` step 4.5, and a revised target is an edit to the `.pen` plus a fresh verdict (step 4.5's step 4 — it overwrites the record); an edit to the milestone file alone shows as drift in `pnpm noldor design verdict --pen docs/design/architecture/milestones/<slug>.pen --check` — re-take the verdict, or `--reconfirm` when the target still stands.
5. Do NOT stage or commit.

### `/noldor-milestone list`

1. Run `tsx src/milestones/cli.ts list` from the repo root.
2. Surface the output verbatim.

## Rules

- The skill never commits — operator stages and commits.
- The CLI handles all state transitions atomically (preflight before write). If the CLI throws, do not attempt recovery — surface the error and let the operator inspect.
- The `/noldor-milestone edit` flow never touches `name` or `status` frontmatter. To change status, use `/noldor-milestone activate`.
- The `description` field is optional. Leave it absent if the operator doesn't provide one.
- Milestones are optional. The framework works fine with no active milestone — never push the operator to draft or activate one.

## Files

- `docs/milestones/<slug>.md` — per-milestone definition.
- `docs/vision.md` — frontmatter `current-milestone: <slug>` points at the active milestone (optional).
- `src/milestones/cli.ts` — CLI dispatcher invoked by this skill.
- `src/milestones/lib.ts` — pure functions backing the CLI.
- `src/milestones/validate-milestones.ts` — snapshot validator (pre-commit).
