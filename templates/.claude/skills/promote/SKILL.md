---
name: promote
description: Promote a roadmap or backlog entry to a feature MD. Reads a schema-C block from docs/roadmap.md (preferred) or docs/backlog.md by slug, scaffolds docs/features/<slug>.md with frontmatter + body stubs, and removes the source block. Use at work-start for any feature that already lives in the roadmap or backlog. For features not present in either, use /new-feature instead.
user_invocable: true
---

# Promote roadmap/backlog entry to feature MD

## Inputs

- **slug** (required) — kebab-case identifier matching the filename stem the
  feature will land at (e.g. `cloud-sync`). The source heading is the
  human-readable name (e.g. `### Cloud Sync`); the slug is derived by
  lowercasing + replacing spaces/slashes with hyphens + stripping other
  punctuation (mirror `slugify()` in `scripts/migrate-features.ts`).
- **--tier** (required) — `specs-only` or `full`. Records the FD's creation depth. Set automatically by `/gate`; prompted interactively when invoked directly.

## Steps

0. If --tier was not passed, prompt the user via AskUserQuestion: "FD creation depth — specs-only (spec, no plan) or full (spec + plan)?" Validate response is `specs-only` or `full`.
1. Search `docs/roadmap.md` first, then `docs/backlog.md`, for the `### <heading>` block whose slugified heading matches the input slug. If not found in either, stop and report to the user.

1.5. **Detect attach intent.** Two signals:
a. Source block has a `parent: <existing-fd-slug>` field
b. LLM-judgment scan: read all `docs/features/*.md` `name` + Summary; if any FD is a strong semantic match for the source block (capability overlap, same area, parent is `phase: done` or epic-shaped `phase: in-progress`), surface as candidate

If either signal fires, present to the operator:

```
Source block: ### <heading> (<source-section>)
Candidate parents:
  1. <fd-slug-1> (phase: <p>, area: <a>) — explicit parent: hint OR LLM match
  2. <fd-slug-2> (phase: <p>, area: <a>) — LLM match, low confidence
  3. (none — scaffold new FD)

Pick 1/2/3:
```

If the operator picks (1) or (2): execute the attach branch (step 6.alt).
If (3) or no candidates fired: continue to step 2 (existing scaffold flow).

2. Parse the block's bullet fields: `area`, `since?`, `deps?`, `parent?`. Source roadmap section determines current bucket but is not carried into the feature MD.
3. If `docs/features/<slug>.md` already exists, stop and tell the user to either edit that file in-place or choose a different slug.
4. Prompt the user for the user-facing release-notes **category**. The valid set is consumer-owned: read `consumer.categories` from `.noldor/config.json` and offer those. Suggest a default via the consumer's `consumer.areaCategories[area]` map (falls back to `Other`); `src/lib/area-category.ts` is the shared helper the dashboard `/backlog` Category column uses too.

   **Self-evolving taxonomy.** Categories are a functional-domain axis, deliberately distinct from Conventional-Commit types (`feat`/`fix`/`docs` already classify change KIND). If none of the configured categories fit the item's domain, do NOT force it into `Other` — propose a NEW category name to the operator (one short functional-domain noun, e.g. `Billing`, `Auth`, `Search`). On approval, append it to `consumer.categories` in `.noldor/config.json` (and add an `areaCategories` entry mapping the item's `area` to it) BEFORE writing the FD. `validate:features` rejects any category not in `consumer.categories`, so the config edit must land first. Never invent a category silently — always confirm with the operator. As a project grows, this is how its taxonomy grows with it.
5. Extract `packages` from the block bullet fields if present, else prompt the user interactively for a minimum viable `packages` array (must be non-empty).
6. Write `docs/features/<slug>.md` with:

```markdown
---
area: <area>
category: <category>
deps: <deps-or-empty-array>
links:
  code: []
  tests: []
name: <heading-verbatim>
packages:
  - <package>
phase: in-progress
noldor-tier: <specs-only | full>
---

## Summary

<first paragraph of the source block's body, with the trailing `Touches: <paths>` clause stripped (see step 6.4)>

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: <slug> -->

## Changelog
```

Replace `<slug>` in the `<!-- @prs-since-last-release: <slug> -->` marker with the actual slug value before writing the file.

6.4. **Touches extraction (runs on both scaffold and attach branches).** Before residue check (step 6.5), parse the trailing `Touches: <paths>` clause from the source block's body using the `extractTouches` helper at [`scripts/noldor/extract-touches.ts`](../../../scripts/noldor/extract-touches.ts).

- On **scaffold branch:** use the `stripped` body as the `## Summary` content (replaces the verbatim copy in step 6). Write the extracted `paths` into the new FD's frontmatter `links.code` array (deduplicated against any operator-provided entries).
- On **attach branch:** the parent FD already has Summary; do **not** mutate it. Instead, merge the extracted `paths` into the parent FD's `links.code` array (preserving existing entries; deduplicating). Surface the extracted paths to the operator via `AskUserQuestion` ("Extracted N paths from source's `Touches:` clause — append to parent `links.code`? [Yes / No / Edit]") so the operator can reject ambiguous attributions.

Skip the step silently when `extractTouches` returns `paths: []`. The `stripped` body is used regardless — passing the body through the helper is idempotent when no clause is present.

6.5. **Residue check (runs on both scaffold and attach branches).** Before removing the source block, scan its body for sub-items NOT carried into the FD scope. Residue signals:

- Stand-alone alternative implementation paths in the body (e.g. "Two implementation paths: (1) ... (2) ...").
- Bullet items prefixed with explicit scope-names that name distinct concerns (e.g. "- Delivery sequencing —", "- Scoring rubric —", "- Dashboard filter surface —").
- Nested sub-headings inside the block.
- Anything the plan would later list under "Out of scope (folded back into the parent roadmap block for a later slice)".

The FD body inherits the first paragraph (scaffold branch, step 6) or nothing (attach branch). Everything beyond the inherited portion is candidate residue.

If residue is found, surface it to the operator via AskUserQuestion:

```
Residue detected in source block "<heading>":
  1. <sub-item-1-title>
  2. <sub-item-2-title>
  ...

For each item, choose:
  (a) fold into FD body (Summary / Usage / parent FD)
  (b) leave as a new roadmap entry — auto-write back as a sibling block in the same section
  (c) drop (intentionally lost; will be erased with source block)
```

Apply per-item disposition before step 7:

- (a) — append the residue text to the FD body (Summary or Usage as appropriate; attach branch appends to parent FD).
- (b) — write the residue as a new sibling block in the source file. If the source was an H3 (`### <heading>`) at the top level of `docs/roadmap.md` (a direct entry, not nested under a category), write the new block as `### <residue-title>` immediately after the original block's position. If the source was an H4 (`#### <heading>`) under an H3 category (e.g. `### Noldor Framework`), write as `#### <residue-title>` immediately after. Carry forward bullets `- area:` (default to source's area), `- type:`, `- size:`, `- impact:`, and add `- recovered: YYYY-MM-DD` for provenance.
- (c) — no write; the residue is erased when step 7 deletes the source block.

**Step 7 must not run until every residue item has an explicit disposition.** If residue scan returns zero items, skip the prompt and proceed.

**Rationale:** narrow slicing of a multi-scope source block loses un-scoped residue silently otherwise. Original incident: the `roadmap-priority-ordering` promotion (commit 650d8d3, 2026-05-11) scoped Path 1 (file-order = priority) and dropped Path 2 (drag-and-drop), the scoring rubric, the bucket restructure, and the dashboard filter surface. Recovery + this step landed 2026-05-13.

7. Remove the `### <heading>` block (heading + bullet fields + body up to the next `### ` or `## ` or EOF) from the source file (`docs/roadmap.md` or `docs/backlog.md`). Step 6.5's residue disposition must have completed first.

8. Skip — `docs/roadmap.md` is a flat priority list with no in-progress tracker section. In-progress work is discoverable via `phase: in-progress` in the FD frontmatter (see `docs/noldor/triage.md`); the dashboard's overview surface reads that frontmatter directly. No roadmap-side tracker is needed.

9. Run `pnpm noldor validate features` to confirm the scaffold passes schema.
10. Tell the user: file path created, source block removed, reminder to fill in User Story / Usage before committing.

### Step 6.alt — Attach branch (when attach intent confirmed at step 1.5)

When the operator picks an existing parent FD at step 1.5:

- Skip steps 3, 4, 5 (no FD scaffold, no category prompt, no packages prompt — parent already has these)
- **Don't write a new feature MD file**
- Step 6.4 (Touches extraction) still runs — extracted paths are surfaced to the operator and (on confirmation) merged into the parent FD's `links.code`. The parent FD's Summary is **not** mutated.
- Step 6.5 (residue check) still runs — the source block may contain sub-items beyond what the parent FD already covers; residue must be disposed (fold into parent / write back as new entry / drop) before step 7.
- Step 7 (remove source block from `docs/roadmap.md` or `docs/backlog.md`) still runs
- Step 8 is skipped (no roadmap-side tracker exists; the parent FD's `phase: in-progress` already covers discoverability).
- Step 9 (`pnpm noldor validate features`) still runs — confirms parent FD wasn't accidentally corrupted.
- Step 10 message:

  > Attached to `<parent-slug>`. Source block removed.
  > Reminder: edit parent FD body sections (Summary / Usage) inline at end of implementation per CLAUDE.md "after every feature, update the feature MD" rule.
  > Recommended: run `/draft-feature-md <parent-slug> --refresh` after implementation lands.

## Rules

- Always `phase: in-progress` on promotion. Flip to `done` in the shipping
  commit on `main`; the release script (`pnpm release`) sets `introduced`
  automatically on next release. Never instruct users to set `introduced`
  manually.
- Always require `category` — it drives release-notes grouping.
- Never overwrite existing feature MDs — error out and tell the user.
- Never delete a source block without successfully writing the feature MD
  first. If any step fails, roll back: delete the partial MD file, leave
  `roadmap.md` / `backlog.md` untouched.
- Do not commit — leave staging/commit to the user.
