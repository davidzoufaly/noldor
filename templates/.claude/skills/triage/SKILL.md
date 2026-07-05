---
name: triage
description: Bulk-triage raw ideas from ideas.md into either docs/roadmap.md (flat priority-ordered list) or docs/backlog.md (parking lot). Reads docs/vision.md for strategic rubric; proposes target + area + since + size + impact per untriaged bullet; user batch-confirms; writes schema-C blocks; appends [triaged YYYY-MM-DD → slug] markers to ideas.md. Use when ideas.md accumulates new bullets and you want to advance them onto the engineering queue.
user_invocable: true
---

# Triage raw ideas → roadmap or backlog

## Inputs

- `ideas.md` — raw user dump. Top-level bullets without `[triaged …]` markers are candidates.
- `docs/vision.md` — strategic source. Frontmatter (`current-milestone` — optional slug pointer) + body sections (`## North Star`, `## Posture`).
- `docs/milestones/<active-slug>.md` — when vision's `current-milestone:` is set, the resolved milestone file provides `## Gate`, `## Success Criteria`, `## Out of Scope`. Skip this read entirely when the slug is absent.
- `docs/roadmap.md` — first target. Flat priority-ordered list (file order = priority); the prior `## Now / ## Next / ## Later` section split was retired 2026-05-13.
- `docs/backlog.md` — second target. Parking lot for items not on the roadmap.

## Bucket rubric

Apply in order; first match wins.

1. **Backlog** — when an active milestone is set: idea matches a bullet in the active milestone file's `## Out of Scope`. Park it. When no milestone is active, skip this bucket (no out-of-scope list exists; deferral happens via rule 3 only).
2. **Roadmap** — idea is on a path the project intends to ship; either aligns with the active milestone (when set) or earns priority among the post-milestone work. File order within `docs/roadmap.md` carries the priority — the confirmation table proposes an insert position (top / after a named entry / bottom) and the operator can override.
3. **Backlog** — speculative (no clear trigger), or community/business work without an active need. **Bias toward backlog when uncertain** — promotion to roadmap is cheap; demotion is fine too.

In-progress work (FDs with `phase: in-progress`) is tracked via FD frontmatter, not via a roadmap entry. `/triage` never writes to roadmap entries representing in-progress work — promotion of a roadmap entry to a feature MD happens via `/promote`, which removes the entry from the roadmap when scaffolding the FD.

## Steps

1. **Read** `docs/vision.md` (frontmatter + body) for strategic context.
2. **Read** `docs/roadmap.md` and `docs/backlog.md` in full — both for area conventions AND to enumerate existing schema-C blocks (heading + summary paragraph) as merge candidates for step 4.
3. **Run** `pnpm noldor triage list-untriaged`. Capture the JSON output. If `untriaged` is empty, report "Nothing to triage" and stop.
4. **For each** untriaged bullet, first decide: **new entry** or **merge into existing**?
   - Scan the schema-C blocks enumerated in step 2. Use LLM judgment on the bullet text vs. each block's heading + summary paragraph: same capability, same problem, same component? If yes → propose `merge:<existing-slug>`. Bias toward merge when overlap is plausible — operator can reject in confirmation.
   - On a merge proposal, also check whether the host block belongs in its current position (priority within the roadmap) or its current file (roadmap vs backlog). If the new bullet implies the host should move (e.g. matched a low-priority entry but the new idea makes it more urgent; matched a `backlog` block that should now be on the roadmap), propose a `promote-to:<position>` or `promote-to:roadmap` annotation alongside the merge.
   - On a **new entry**, propose:
     - **slug** — kebab-case derived from the bullet text (lowercase, replace spaces/slashes with hyphens, strip non-alphanumerics, max 60 chars)
     - **name** — human-readable (capitalize meaningful words from the bullet text)
     - **area** — match an existing feature/backlog/roadmap `area`; invent only when nothing fits. When inventing a new `area`, check `consumer.areaCategories` in `.noldor/config.json`: if the new area maps to no existing release-notes **category** (and none of `consumer.categories` fits its functional domain), surface a proposed new category to the operator in the confirmation table. On approval, append it to `consumer.categories` + add the `areaCategories[area]` mapping. This is how the project's taxonomy grows as new domains appear — categories are a functional axis, never duplicating commit types (`feat`/`fix`/`docs`). Never add a category silently.
     - **type** — one of `feat | fix | refactor | chore | docs | perf | test` (see Type rubric below)
     - **target** — `roadmap` (with a position annotation: `top`, `after:<slug>`, or `bottom`), `backlog`, or `now`. `now` declares ship-next intent: the row is written as a roadmap insert at `top`, and after step 8's validations pass the skill auto-chains `/promote <slug> --tier=<full when size is L/XL, else specs-only>` — closing the old two-step seam (triage → manual `/promote`). Propose `now` only when the operator's bullet explicitly signals immediate work ("do this now", "next up"); never infer it from score alone.
     - **since** — today's date in `YYYY-MM-DD`
     - **size** — `XS | S | M | L | XL`. **Required** when `target` is `roadmap` (validator gates on it); advisory on `backlog`. Skill estimates from bullet text + similar prior entries; operator overrides per row.
     - **impact** — `low | med | high | critical`. Same gating as `size`: required on roadmap, advisory on backlog.
     - **confidence** — `low | med | high`. How sure the proposer is about the `size` + `impact` estimate. Default to `med`; lower to `low` if the bullet text is fuzzy or the work needs spike-level exploration; raise to `high` only when the work has a clear, well-understood shape. Silently optional in v1 — `validate:triage` does NOT complain when missing.
     - **deps** — comma-separated kebab slugs of unshipped roadmap/backlog/in-progress entries this work blocks on. Empty when no blockers known. The slug list feeds dependency-weight at scoring time. Silently optional in v1; operator can supply or leave empty.
     - **milestone** — slug of the milestone this work belongs to (a `docs/milestones/<slug>.md` file). Propose `- milestone: <active-slug>` **only** when `docs/vision.md` has an active `current-milestone:` AND the bullet aligns with that milestone's `## Gate`; otherwise omit the line entirely. Never infer from score. Operator overrides or drops per row. Silently optional, exactly like `confidence`/`deps` — written into the schema-C block only when proposed/confirmed; `validate:triage` does NOT complain when absent. `/promote` lifts the line into the FD frontmatter.
5. **Present** the proposal table to the user for batch confirmation. Merge rows show the matched host block's heading + current section so the operator can spot bad matches:

```
Idea                                  | proposal                                       | area     | type    | size | impact | conf | score
───────────────────────────────────────┼─────────────────────────────────────────────────┼──────────┼─────────┼──────┼────────┼──────┼──────
performance tracking → separated libs  | new: performance-tracking → roadmap (bottom)    | tooling  | feat    | M    | med    | med  | 75
brand identity / logo                  | merge: brand-identity (backlog) + promote-to:roadmap-top | branding | feat    | L    | high   | high | 133
add second logo variant                | merge: brand-identity (backlog) — sub-bullet     | branding | feat    | —    | —      | —    | —
rozpracovat vizi a roadmapu            | new: refine-vision-roadmap → backlog            | process  | chore   | S    | low    | low  | 50
```

The `score` column is computed by shelling out to `scripts/triage/score.ts` (or the `pnpm noldor triage score` alias) for each new-entry row. Pass the bullet fields as flags: `pnpm noldor triage score --size=<...> --impact=<...> --confidence=<...> --deps=<slug,slug>`. The helper returns one integer; capture it for the table column. Dependency-weight is `1 / (1 + unshipped_dep_count)` where **shipped = the slug names a `docs/features/<slug>.md` with frontmatter `phase: done`**; every other state (file missing, file present with non-done phase, slug only in roadmap or backlog) counts as unshipped. Higher score = higher priority. Merge rows do not carry size/impact/confidence/score (the host block's values stand). The score is **not** persisted to the schema-C block — it is recomputed on every `/triage` run from the bullet fields.

For roadmap targets, the proposal includes an insert position: `(top)`, `(after <existing-slug>)`, or `(bottom)`, plus `size` (XS/S/M/L/XL) and `impact` (low/med/high/critical) — both required for roadmap inserts because `validate:triage` errors on missing `size` or `impact` for roadmap entries. The computed `score` informs the suggested insert position (higher score → closer to top; lower score → bottom; comparable scores → `after:<slug>` near peers), but the operator can override per row. Backlog targets may propose `size` + `impact` (advisory there). Merge rows do not carry size/impact (the host block's values stand). Operator confirms or edits per row.

Ask: "Confirm all? (y/n/edit) — n means skip everything; edit lets you override per row (including flipping merge ↔ new)."

6. **On confirm**, first **mint stable IDs** for the accepted **new-entry** rows (both `backlog` and `roadmap`/`now` targets — merge rows never mint; the host block keeps its ID). Count the accepted new-entry rows and make one call: `pnpm noldor triage mint-id --count <n>`. It prints one `Q-NNNN` per line and bumps `.noldor/id-counter.json`. Assign the minted IDs to the new-entry rows in table order. Rejected rows never burn an ID. Then, for each accepted row:
   - **`backlog`** target → append a phase-less schema-C block to `docs/backlog.md` (the minted `- id:` is the **first** bullet):

   ```markdown
   ### <name>

   - id: <minted Q-NNNN>
   - area: <area>
   - type: <type>
   - since: <today>
   - size: <size-or-omit>
   - impact: <impact-or-omit>
   - confidence: <confidence-or-omit>
   - deps: <slug|Q-id,…-or-omit>

   <one-paragraph description, polished from the original bullet>
   ```

   (`size` / `impact` / `confidence` / `deps` lines are all silently optional on backlog — emit when the proposal supplied them, omit otherwise. For `deps`, only emit the bullet when the slug list is non-empty.)
   - **`roadmap`** target → insert a schema-C block into `docs/roadmap.md` at the position indicated by the proposal (`top` = before the first existing H3/H4 entry; `after:<slug>` = immediately after the matching block; `bottom` = at end of file). `size` and `impact` lines are **required** on roadmap blocks — emit both. If the entry slots under an existing H3 category, render as `#### <Entry Name>` under that category; if it's a standalone direct entry, render as `### <Entry Name>`:

   ```markdown
   #### <name>

   - id: <minted Q-NNNN>
   - area: <area>
   - type: <type>
   - since: <today>
   - size: <size>
   - impact: <impact>
   - confidence: <confidence-or-omit>
   - deps: <slug|Q-id,…-or-omit>

   <one-paragraph description, polished from the original bullet>
   ```

   (`size` and `impact` are required on roadmap; `confidence` and `deps` are silently optional — emit `confidence` when the proposal supplied it, omit otherwise. For `deps`, only emit the bullet when the slug list is non-empty.)
   - **`merge:<existing-slug>`** target → locate the host block in roadmap or backlog. Append a sub-bullet under the host's body paragraph (or after the last existing sub-bullet) preserving the new bullet's wording lightly polished. Do NOT rewrite the host paragraph. Do NOT update the host's `since`. If the operator confirmed `promote-to:<position>`, also relocate the entire host block (heading + bullet fields + body + new sub-bullet) to the indicated position in `docs/roadmap.md` (or move to `docs/backlog.md` if `promote-to:backlog`). When the host move targets roadmap and the host originally came from backlog, the host block's `size` / `impact` lines must be present on arrival — if absent, prompt the operator to supply them as part of the confirmation row. Cross-file moves between roadmap and backlog mirror the patterns logged in commits `08a509c` / `c46f560` / `22719c6`.

   - **`now`** target → write the block exactly as a `roadmap` insert at `top` (same required fields — `size` and `impact` gate it). With multiple `now` rows, insert in reverse confirmation-table order so the final roadmap order matches the table. The auto-chain to `/promote` happens in step 8, never here — a failed validation must abort the chain.

   Append `[triaged YYYY-MM-DD → <slug>]` to the original bullet in `ideas.md` — for merges, `<slug>` is the host's slug, not a new one (preserves traceability back to the host).

7. **On all rejection** (user said `n`), do nothing. Confirm with user and stop.
8. **Final step (regardless of outcome):** run
   `pnpm noldor validate triage && pnpm noldor sync test-links && pnpm noldor sync doc-links && pnpm noldor validate features`.
   Each must succeed; if any fails, report the failure and the partial state. Do not roll back. `validate:triage` runs first so a missing `size` / `impact` on any newly-inserted roadmap block fails fast before the doc-link sync re-writes derived files.

   **Then, for each confirmed `now` row** (in table order; any of the four commands above failing aborts ALL `now` chaining): invoke `/promote <slug> --tier=<full when size is L/XL, else specs-only>`. `/promote` reads the just-inserted roadmap block and removes it as it scaffolds the FD — the transient roadmap insert keeps the schema-C contract intact and the `[triaged … → slug]` marker preserves traceability. If `/promote` fails for a row, report it and continue with the remaining `now` rows; the block stays on the roadmap top for a manual retry.
9. **Report** to the user:
   - Number of ideas triaged, broken down by target (roadmap / backlog / now — for `now` rows also report each `/promote` chain outcome: FD scaffolded, or failed-and-left-on-roadmap)
   - Number remaining untriaged
   - Files modified
   - Reminder: stage and commit when ready

## Area rubric

`area` is a free-form, project-specific slug — there is no fixed enum. Derive the set empirically: read the `- area:` bullets already present across `docs/features/*.md`, `docs/roadmap.md`, and `docs/backlog.md` (step 2 enumerates these) and reuse an existing area when the bullet's subject matches one.

If the bullet defies every existing area, invent a new area slug and surface it in the table for user review. New areas may also imply a new release-notes category — see the `area` bullet under step 4.

## Type rubric

Pick from the Conventional Commits set. First match wins.

- **fix** — bullet describes a bug, regression, data-loss, drift between layers, or anything currently broken in shipping code.
- **perf** — measurable performance improvement is the explicit goal (e.g. "speed up X", "lift the perf ceiling", "off main thread for latency").
- **refactor** — restructure, extract, split, unify, or migrate existing internals without changing user-visible behavior. Architecture-shape entries (command core, lifecycle types, service boundaries) land here.
- **test** — adds or extends test coverage as the primary deliverable (a11y suite, smoke tests, visual regression).
- **docs** — adds or restructures documentation as the primary deliverable (how-to authoring, versioned docs, demo embeds).
- **chore** — infra, build, ops, CI, lint pipeline, marketing, or other support work that is neither feature nor fix nor refactor (VPS stack, vendor swap, lint plugin add, paid marketing).
- **feat** — new user-visible or agent-visible capability. Default for "ship X" entries that don't fit any above.

When ambiguous, prefer the more specific type over `feat` (e.g. a perf-targeted rewrite is `perf`, not `feat`; a structural cleanup is `refactor`, not `feat`).

## Rules

- **Never** delete or relocate bullets within `ideas.md`; only append `[triaged …]` markers.
- **Never** commit. Operator commits.
- **Never** auto-promote backlog or roadmap entries to feature MDs — with one exception: rows the operator explicitly confirmed as `target: now` chain to `/promote <slug>` in step 8 after validations pass. Everything else promotes via a manual `/promote <slug>` (separate skill).
- **Never** silently merge — every `merge:<slug>` proposal must show the matched host's heading + current section in the confirmation table. Operator can flip merge → new entry.
- **Bias toward merge** when an existing block plausibly covers the new bullet. Multiple sub-bullets under one block beat scattered duplicates that `/garden` will later flag.
- **Sub-bullets, not paragraph rewrites.** Preserve the host's original summary verbatim. Append the new bullet as a fresh `-` item under the body.
- **Cross-section moves** triggered by `promote-to:<section>` follow the symmetric backlog ↔ roadmap pattern from commits `08a509c` / `c46f560` / `22719c6` — move the whole block, never split.
- **Optional `parent: <existing-fd-slug>` field** in schema-C blocks signals attach intent at `/promote` time. `/triage` doesn't enforce parent existence; `/promote` validates and presents attach-to-parent option to operator.
- **Always** run the regen chain in step 8, even if zero ideas triaged (catches drift from manual edits).
- **Confidence + deps are silently optional in v1.** Missing `confidence` defaults to `med` at scoring time. Missing `deps` means the dependency factor is `1.0` (no discount). `validate:triage` does NOT complain when either is missing. Both fields can be backfilled by hand later — `/triage` will pick them up on the next run.
- **Stable IDs are minted, never hand-written.** Every accepted new entry gets a `- id: Q-NNNN` first bullet minted via `pnpm noldor triage mint-id` after confirmation. Never write `- id:` by hand (except resolving a counter merge conflict), never renumber, never reuse. The ID survives heading renames and roadmap ↔ backlog moves — the slug is now a renameable alias. `deps:` bullets may reference an ID or a slug interchangeably. Gaps in the sequence (rejected/dropped rows) are permanent and harmless. Once `.noldor/id-counter.json` exists, `validate:triage` errors on any entry missing an `id`.
- **Score is derived, not stored.** The score column in the confirmation table is recomputed from bullet fields on every `/triage` run. Do not write `- score: <int>` into schema-C blocks. If the formula in `scripts/triage/score.ts` tunes, the new score takes effect on the next run without rewriting the markdown.
- If the user types `edit` at confirmation, walk row-by-row asking for overrides on target / area / slug / merge-host, then re-present the final table for one last yes/no.
