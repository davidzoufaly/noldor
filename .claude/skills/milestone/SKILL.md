---
name: milestone
description: Manage Noldor milestones independent of semver — draft, activate, edit, or list milestones at `docs/milestones/<slug>.md`. Vision's `current-milestone:` frontmatter points at the active milestone file. Milestones are optional; framework works fine without one.
user_invocable: true
---

# /milestone — Manage Noldor milestones

## Inputs

- **sub-command** (required) — `draft`, `activate`, `edit`, or `list`.
- **slug** (varies per sub-command) — kebab-case codename matching `docs/milestones/<slug>.md`. Required for `activate` and `edit`. Optional for `draft` (skill proposes a codename if omitted).

## Sub-commands

### `/milestone draft [<slug>]`

1. If `<slug>` omitted: ask the operator for a theme (one-line seed describing the milestone's strategic intent), then propose a kebab-case codename and confirm via `AskUserQuestion` ("Use `<proposed>`? Or rename to: \_\_\_\_"). Iterate until the operator accepts.
2. Ask the operator for an optional `description` (one-liner) via `AskUserQuestion` ("Add a description? Or leave blank.").
3. Run `tsx scripts/milestones/cli.ts draft <slug> [<description>]` from the repo root.
4. Tell the operator: `Drafted docs/milestones/<slug>.md with status: draft. Edit it to fill in ## Gate, ## Success Criteria, ## Out of Scope.`
5. Do NOT stage or commit.

### `/milestone activate <slug>`

1. Run `tsx scripts/milestones/cli.ts activate <slug>` from the repo root.
2. On success, surface: `Activated <slug>. Previous active milestone (if any) flipped to shipped. docs/vision.md frontmatter updated.`
3. On error (target missing, shipped, multi-active corruption, etc.), surface the CLI's stderr message and stop. Do NOT attempt manual workarounds.
4. Do NOT stage or commit.

### `/milestone edit <slug>`

1. Verify `docs/milestones/<slug>.md` exists. If not, tell operator: `No milestone at docs/milestones/<slug>.md. Use /milestone draft <slug> to create one.`
2. Read the file. Surface its current contents to the operator.
3. Ask the operator what to change. Apply edits via the Edit tool — never modify the `name` or `status` fields (status mutates only via `/milestone activate`).
4. Run `pnpm noldor validate milestones` after edits.
5. Do NOT stage or commit.

### `/milestone list`

1. Run `tsx scripts/milestones/cli.ts list` from the repo root.
2. Surface the output verbatim.

## Rules

- The skill never commits — operator stages and commits.
- The CLI handles all state transitions atomically (preflight before write). If the CLI throws, do not attempt recovery — surface the error and let the operator inspect.
- The `/milestone edit` flow never touches `name` or `status` frontmatter. To change status, use `/milestone activate`.
- The `description` field is optional. Leave it absent if the operator doesn't provide one.
- Milestones are optional. The framework works fine with no active milestone — never push the operator to draft or activate one.

## Files

- `docs/milestones/<slug>.md` — per-milestone definition.
- `docs/vision.md` — frontmatter `current-milestone: <slug>` points at the active milestone (optional).
- `scripts/milestones/cli.ts` — CLI dispatcher invoked by this skill.
- `scripts/milestones/lib.ts` — pure functions backing the CLI.
- `scripts/milestones/validate-milestones.ts` — snapshot validator (pre-commit).
