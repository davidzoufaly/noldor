---
noldor-page: feature-md-schema
introduced: 0.4.0
---

# Feature MD Schema

Every user-visible capability in the project is tracked as one feature MD (FD) under `docs/features/`. This page describes the frontmatter contract, body structure, and links shape. The single source of truth for the schema is the Zod definition in [`src/features/feature-schema.ts`](../../src/features/feature-schema.ts) — when this page disagrees with that file, the Zod schema wins.

## Commands

| Trigger                                 | What it does                                                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/noldor-new-feature <slug>`                   | Scaffold a blank FD from scratch. Prompts for `category`. Use when not in roadmap/backlog.                                                                             |
| `/noldor-promote <slug>`                       | Move a roadmap/backlog block into a new FD with `phase: in-progress`. No roadmap-side tracker — in-progress work is discoverable via `phase: in-progress` frontmatter. |
| `/noldor-draft-feature-md <slug> --from-spec`  | Fill `<!-- TODO -->` stubs in FD body from approved spec.                                                                                                              |
| `/noldor-draft-feature-md <slug> --refresh`    | Rewrite FD User Story / Usage to match what shipped.                                                                                                                   |
| `pnpm noldor validate features`         | Schema check + cross-checks (`packages` ↔ `links.code`, `@tests:` slugs, `@feature:` slugs). Pre-commit hook.                                                          |
| `pnpm noldor sync test-links`           | Populate `links.tests` from `// @tests: <slug>` directives. Pre-commit hook.                                                                                           |
| `pnpm noldor sync code-links`           | Populate `links.code` from `// @fd: <slug>` directives. `--check` flags drift without writing.                                                                         |
| `pnpm noldor sync doc-links`            | Populate `links.docs` from `<!-- @feature: <slug> -->` tags. Pre-commit hook.                                                                                          |
| `pnpm noldor sync spec-links`           | Populate `links.spec` from spec files. Pre-commit hook.                                                                                                                |
| `pnpm noldor sync fd-resources`         | Rewrite FD body's auto-generated Resources block. Also auto-rewrites `links.spec` to its `archive/` variant when the original spec file is missing. Pre-commit hook.   |
| `pnpm noldor features migrate-features` | One-shot rewrite of FD frontmatter to latest schema. Idempotent.                                                                                                       |

## Frontmatter fields

The Zod schema is `.strict()`: unknown keys are rejected. Every FD frontmatter must satisfy `FeatureFrontmatterSchema`.

### Required

| Field      | Type                                                                                         | Notes                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `name`     | `string` (min 1)                                                                             | Human-readable feature name. Free-form prose.                                                                      |
| `phase`    | enum: `done` \| `in-progress`                                                                | Lifecycle state. No other values accepted. Roadmap entries (file order = priority) live in `roadmap.md`, not here. |
| `category` | `string` (min 1), validated at runtime against `consumer.categories` in `.noldor/config.json` (default: `Core` \| `Tooling` \| `Other`) | Drives release-notes grouping. Closed set per repo, but configured — not a hardcoded enum. See section below. |
| `area`     | `string` (min 1)                                                                             | User-facing grouping (e.g. `viewport`, `history`, `persistence`). Decoupled from packages.                         |
| `packages` | `string[]` (min 1, each non-empty)                                                           | Monorepo package(s) containing the implementation. Always an array, even for single-package features.              |
| `links`    | `LinksSchema` (`.strict()` object)                                                           | See [Links shape](#links-shape).                                                                                   |

### Optional

| Field         | Type                                | Notes                                                                                                                                                                      |
| ------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `introduced`  | `string` matching `^\d+\.\d+\.\d+$` | Product release the feature shipped in. **Set by `pnpm release`, never by hand.** Absent on `phase: in-progress`; populated when phase flips to `done` and a release cuts. |
| `updated`     | `string` matching `^\d+\.\d+\.\d+$` | Latest product release that modified the feature. **Set by `pnpm release`, never by hand.**                                                                                |
| `deps`        | `string[]` (each non-empty)         | Slugs of prereq features. Defaults to `[]`.                                                                                                                                |
| `noldor-tier` | enum: `specs-only \| full`          | Records the FD's creation depth. Set by `/noldor-gate` (or `--tier` flag on `/noldor-promote`/`/noldor-new-feature`). Immutable post-rollout. See [Tier transitions](#tier-transitions) below.  |
| `introduces-gate` | `string` (min 1)                | Marks an FD whose work adds a release-time gate its own commits cannot satisfy. Value is a gate-registry key (`src/cr/gate-registry.ts`, e.g. `codex-cr`). Drives `/noldor-gate` Step 4 bootstrap-immunity (`pnpm noldor cr bootstrap`), which stamps the matching override on the branch's commits so the new gate can't block its own merge. Hand-added; absent by default. |
| `entry-id`    | `string` matching `^Q-\d{4,}$`  | Stable entry ID carried from the source roadmap/backlog block. Lifted by `/noldor-promote` from the block's `- id:`, or minted fresh by `/noldor-new-feature`. Lets `resolveEntryRef` map an ID `deps:` reference to this shipped feature and keeps the ID stable across the roadmap → FD hop. Never rewritten. Absent on historical FDs. See [triage.md → Stable entry IDs](triage.md#stable-entry-ids). |

Example minimum-viable frontmatter (in-progress, no deps yet):

```yaml
---
name: Example Feature
phase: in-progress
category: Tooling
area: example
packages:
  - web
noldor-tier: specs-only
links:
  code: []
  docs: []
  tests: []
---
```

## Tier transitions

`noldor-tier` is set once at FD creation (via `/noldor-gate`, `/noldor-promote --tier`, or `/noldor-new-feature --tier`) and is immutable post-rollout. It records the FD's _own creation depth_:

- `specs-only` — FD created on path `specs-only-new`: mechanical work, no brainstorm/spec.
- `full` — FD created on path `full-new`: design dialogue, spec produced and linked.

**The tier does not mutate when subsequent work attaches to the FD.** A `specs-only` FD can receive `full-attach` enhancements; those attach paths are recorded in `Noldor-Path` commit trailers (and, for `full-attach`, a spec file at `docs/superpowers/specs/<date>-<parent-slug>-<enhancement>-design.md` must exist). The parent FD's frontmatter is not modified.

Attach history is reconstructed from trailers, not from the parent FD's frontmatter.

## category — drives release-notes grouping

Per the Workflow rules: every new feature MD requires a `category` field — one of the categories configured in `.noldor/config.json` (`consumer.categories`; default `Core | Tooling | Other`). Drives release-notes grouping. `/noldor-promote` prompts for this; `/noldor-new-feature` requires it.

This is coarser than the internal `area` taxonomy. `area` can be free-form (`history`, `viewport`, `persistence`); `category` is the configured set above (a closed set per repo, sourced from `.noldor/config.json` — not a hardcoded enum).

## phase transitions

Per the FD framework spec, `phase` is restricted to two values: `in-progress` and `done`. Triage state (flat priority list in `docs/roadmap.md` and the parking-lot `docs/backlog.md`) lives in those files, not in feature MDs.

Transition rules (per Workflow):

- **`in-progress` → `done`** is a manual edit in the shipping commit. Flip the phase; the roadmap has no in-progress tracker to clean up (`phase: in-progress` in the FD frontmatter is the canonical signal).
- **`introduced` and `updated` are owned by `pnpm release` — never set them manually.** See [`versioning.md`](versioning.md) for the marker logic.
- A feature MD can land at `phase: done` with `introduced` still absent — that means code-complete but awaiting the next release cut. `pnpm release` fills `introduced` on its next run.

## Body sections

The FD body has three required sections, in order, per the [original framework design spec](../superpowers/specs/archive/2026-04-23-feature-md-framework-design.md):

- **`## Summary`** — one-paragraph capability description (1–3 sentences). What the feature is.
- **`## User Story`** — `As a user (human or agent), I want to <action>, so that <outcome>.` Persona-agnostic. Multi-story features may use a bullet list.
- **`## Usage`** — how to invoke. UI steps, keyboard shortcut, agent API call.

Optional follow-up sections used by some FDs: `## Why`, `## How it works`, `## Notes`. None of these are validator-enforced — only the frontmatter is schema-checked.

### `## Changelog` (Summary in body, Commits live)

Each version block has the shape:

```
### <x.y.z>

#### Summary

<release-note copy>
```

That's it — no `#### Commits` subsection, no `### Unreleased`. Both have moved off the FD body:

- **Per-version commits** are rendered live by the dashboard on every `/features/<slug>` request from a scope-filtered `git log` (commits whose subject scope matches `<area>:<slug>`). Static commit bullets duplicate the git history and rot — the dashboard merge injects them on the fly.
- **`### Unreleased`** is dashboard-only. It surfaces commits since the most recent tag, computed at render time. Never write `### Unreleased` into an FD body — it gets stripped by the live merge anyway.

`pnpm release`:

1. Walks every `done`-phase FD; runs `commitsForFeature(slug, prevTag, HEAD)` to get the qualifying set (noise types `chore`/`docs`/`test`/`style`/`ci`/`build` filtered out).
2. For each FD with non-zero commits, calls `polishSummary(commits)` — `claude -p` rewrites the filtered subjects as a single readable paragraph (deterministic fallback under `NOLDOR_NO_LLM=1` or subprocess failure).
3. Prepends `### <new-version> > #### Summary` to the FD's `## Changelog` section.

The operator no longer stages release-notes copy ahead of time. To override the auto-polished Summary post-release, edit the FD body's `### <version> > #### Summary` block by hand and commit (it will surface on `/release-notes` and `/features/<slug>` directly).

## Links shape

`links` is a `.strict()` object with the following sub-fields. Every array defaults to `[]` if omitted; `spec` is optional.

| Sub-field | Type                      | Notes                                                                                                                     |
| --------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `code`    | `string[]` (default `[]`) | Repo-relative paths to implementation files or directories. Scan-derived cached projection — populated by `pnpm noldor sync code-links` from `// @fd: <slug>` tags, not hand-maintained; guarded by `sync code-links --check` + the `code-links-drift` detector. Directory entries stay manual (a tag can't live on a dir). |
| `docs`    | `string[]` (default `[]`) | Repo-relative paths to user-facing docs. Populated by `pnpm noldor sync doc-links` from `<!-- @feature: <slug> -->` tags. |
| `plan`    | `string \| string[]` (optional) | Repo-relative path(s) to the implementation plan under `docs/superpowers/plans/`. Set on `full-*` paths.            |
| `spec`    | `string` (optional)       | Single repo-relative path to the design spec under `docs/superpowers/specs/`.                                             |
| `tests`   | `string[]` (default `[]`) | Repo-relative paths to test files. Populated by `pnpm noldor sync test-links` from `// @tests: <slug>` tags.              |

## Sentinel rules

Some link arrays are subject to SDD detectors that flag empty values. To opt out by design — when a feature genuinely has no doc/test surface — use the literal sentinel `n/a` as the array's sole entry:

- **`links.docs: ['n/a']`** — opt out of the "Done features without docs" detector. Allowed when `category: Tooling` (internal devloop, never user-facing) or otherwise where no user-facing surface exists.
- **`links.tests: ['n/a']`** — opt out of the "Done features without tests" detector. Use sparingly — for features with no testable surface (one-off rebrands, doc moves).

A page-by-page reference of every detector and its sentinel is in [`garden-and-drift.md`](garden-and-drift.md).

## Validation

`pnpm noldor validate features` enforces the schema across every `docs/features/*.md`. It runs via the lefthook pre-commit `validate.features` job, so schema drift fails the commit. The script lives at [`src/features/validate-features.ts`](../../src/features/validate-features.ts) and additionally cross-checks:

- Every `packages/<name>` reference in `links.code` must appear in the `packages` frontmatter array (`validatePackagesField`).
- Every slug in a `<!-- @feature: <slug> -->` doc tag must correspond to an existing `docs/features/<slug>.md` (`validateDocFeatureSlugs`).
- Every test file body must carry a `// @tests: <slug>` line (`validateTestTagPresence`).

## /noldor-new-feature and /noldor-promote

- **`/noldor-new-feature <slug>`** — scaffolds a blank FD from scratch. Use when the feature isn't already in roadmap/backlog. Required: `category`.
- **`/noldor-promote <slug>`** — moves a roadmap or backlog block into a new FD with `phase: in-progress`. Source block removed; no roadmap-side tracker is added (the FD's `phase: in-progress` frontmatter is the canonical in-progress signal). See [`workflow.md`](workflow.md) for the broader rules.
