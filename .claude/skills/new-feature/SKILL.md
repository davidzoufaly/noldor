---
name: new-feature
description: Scaffold a blank feature MD at docs/features/<slug>.md with required frontmatter and body sections. Use when starting work on a feature that is not in the backlog (urgent work, matured spike, bug-fix-became-feature). For promoting a backlog entry, use /promote (Part 2 of the framework).
user_invocable: true
---

# Scaffold a new feature MD

Create a fresh feature MD in `docs/features/<slug>.md` with `phase: in-progress`
and stub body sections. User provides the slug; the skill prompts for remaining
fields interactively or accepts them inline.

## Inputs

- **slug** (required) — kebab-case filename stem, e.g. `cloud-sync`.
- **name** (required) — human-readable, e.g. `Cloud Sync`.
- **area** (required) — internal taxonomy slug, free-form and project-specific (e.g. `core`, `tooling`, `docs`). Reuse an existing area from `docs/features/*.md` where one fits.
- **category** (required) — user-facing release-notes bucket. Must be one of `consumer.categories` in `.noldor/config.json` (functional-domain axis, NOT a commit type). If none fits, propose a new one to the operator and append it to the config first (`validate:features` rejects unconfigured categories). Suggest a default via `consumer.areaCategories[area]`.
- **packages** (required) — array of package names from `consumer.lockstepPackages` (a single-package repo lists its one package).
- **deps** (optional) — array of prereq feature slugs.
- **--tier** (required) — `specs-only` or `full`. Records the FD's creation depth. Set automatically by `/gate`; prompted interactively when invoked directly.

## Steps

1. If --tier was not passed, prompt the user via AskUserQuestion: "FD creation depth — specs-only (spec, no plan) or full (spec + plan)?" Validate response is `specs-only` or `full`.
2. If file `docs/features/<slug>.md` exists, stop and tell the user.
3. Write the file with this template:

```markdown
---
area: <area>
category: <one of consumer.categories>
deps: []
links:
  code: []
  tests: []
name: <Name>
packages:
  - <package>
phase: in-progress
noldor-tier: <specs-only | full>
---

## Summary

<!-- TODO 1-3 sentences. What the feature is. -->

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: <slug> -->

## Changelog
```

Replace `<slug>` in the `<!-- @prs-since-last-release: <slug> -->` marker with the actual slug value before writing the file.

4. Run `pnpm noldor validate features` to confirm the scaffold passes schema.

5. Print the file path and remind the user to fill in Summary / User Story / Usage before committing.

## Rules

- Always `phase: in-progress` on scaffold. Flip to `done` in the shipping
  commit on `main`; the release script (`pnpm release`) sets `introduced`
  automatically on next release. Never instruct users to set `introduced`
  manually.
- Never overwrite existing feature MDs — error out and tell the user to edit
  in-place or choose a different slug.
- Do not commit the scaffold — leave staging/commit to the user.
