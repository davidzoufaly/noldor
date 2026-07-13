---
name: noldor-garden
description: Doc gardening pass. Runs garden-detect to surface stale plans, unused backlog entries, rule-pair contradictions, and SDD gaps. Filters contradiction false-positives via an LLM pass over the doc excerpts. Presents an operator-confirmed checklist; on confirm executes safe auto-actions (archive plans, drop backlog blocks) and runs the regen chain. Use when the doc framework feels drifty or before a release. Operator commits.
user_invocable: true
---

# Doc gardening pass → checklist + auto-actions

## Inputs

- `pnpm noldor garden detect` — JSON of `{ stalePlans, staleSpecs, unusedBacklog, contradictions, sourceDrift, sddGaps, invariantViolations, skillDrift, ... }`. Defined in `src/garden/garden-detect.ts`.
- `skillDrift` rows (`src/garden/detectors/skill-code-drift.ts`) flag skill markdown referencing dead `pnpm` scripts, unknown `noldor` subcommands, or missing repo paths. Investigate-only — fix the skill body (or mark an intentional negative reference with `noldor-skill-drift-ignore`); never auto-edit skills.
- For each `contradictions` entry: read ~50 lines of context around the matched/unmatched pattern in each doc to judge whether the candidate is a real divergence.

## Steps

1. **Run** `pnpm --silent garden:detect`. Parse JSON. (The `--silent` flag suppresses pnpm's banner lines so stdout is pure JSON.) If all five arrays are empty, report "Garden is tidy" and stop.
2. **For each `contradictions` entry**, read both `pair[0]` and `pair[1]`, then:
   - Find the pattern match (or its absence) and the surrounding ~50 lines.
   - Decide: is the rule actually divergent, or are the two docs consistent in context?
   - If consistent → drop the entry from the checklist, leaving a one-line note in the final report (`filtered: <rule>`).
   - Otherwise → keep with the original `message`.
3. **Manual plan sweep.** The detector matches plans by single-slug feature lookup and age. Multi-feature plans (e.g. one plan covers `state-management` + `scene-tree-panel`), infra plans (e.g. `feature-md-framework`, `versioning`), and parent-plus-`-partN` splits all slip through when their slug doesn't match a feature MD. After step 2:
   - List every `*.md` in `docs/superpowers/plans/` (exclude `archive/`) that did NOT appear in `stalePlans`.
   - For each, read the first 25 lines (Goal / Architecture / Spec). Decide: is the work shipped (matches one or more done feature MDs, or infra now in active use)?
   - Present the candidates as a "Manual sweep" subsection of the checklist with proposed slug → feature mapping and an `archive` action. Operator confirms y/n per row at confirmation step.
4. **Render** the checklist:

```
Garden findings (N):

Stale plans (M):
  ✓ <path>
    → archive (<reason summary>)

Stale specs (M):
  ✓ <path>
    → archive (<reason summary>)

Manual sweep (M):
  ✓ <path>
    → archive (covers <feature-slug>[, <feature-slug>] — shipped) | (infra: <subsystem> — in active use)

Unused backlog (M):
  ✓ ### <slug> (since <date>)
    → drop (<reason summary>)

Rule contradictions (M):
  ⚠ <docA> ↔ <docB>
    → manual edit. <message>

SDD gaps (M):
  • <category>: <itemId> — <message>

Architecture invariant violations (M):
  • <invariant>: <file:line> — <message>

Confirm all auto-actions? (y/n/edit)
  y: archive M plans (incl. manual sweep), drop M backlog blocks, run regen chain
  n: do nothing
  edit: row-by-row override (auto-action rows only)
```

5. **On confirm (`y` or partial-confirm via `edit`)**, execute auto-actions in order:
   - **Archive plan** (both detector-flagged and manual-sweep rows) — `mkdir -p docs/superpowers/plans/archive` (idempotent), then `git mv <path> docs/superpowers/plans/archive/<basename>`. On collision (target exists), abort that row, continue.
   - **Archive spec** — `mkdir -p docs/superpowers/specs/archive` (idempotent), then `git mv <path> docs/superpowers/specs/archive/<basename>`. Same collision behavior as plans.
   - **Drop backlog block** — read `docs/backlog.md`. Locate the level-3 heading whose slugified name matches the finding's `slug`. Remove the heading + body up to (but not including) the next `### ` or `## ` heading or EOF. Trim any trailing blank lines. Write back. If the heading isn't found, abort that row, continue. (As of the roadmap/backlog split, `docs/backlog.md` is a flat parking lot — no level-2 phase sections to preserve.)
6. **Manual-edit**, **SDD-gap**, and **architecture invariant** rows: never auto-actioned. Print as a "Manual TODOs" section in the final report with the file paths and messages so the operator knows where to edit.
7. **Regen chain (always, even if zero auto-actions):**

```
pnpm noldor sync test-links && pnpm noldor sync doc-links && pnpm noldor sync fd-resources && pnpm noldor validate features && pnpm noldor garden receipt
```

Each must succeed. If any fails, report the failure and the partial state. Do not roll back.

`pnpm noldor garden receipt` writes `.noldor/garden-receipt` (operator-local, gitignored) with HEAD SHA + timestamp. `pnpm release` reads this via `ensureGardenFresh()` and refuses to publish when no garden pass has happened since the last tracked-file commit. Bypass via `RELEASE_SKIP_GARDEN_GATE=1` for bootstrap commits only.

7.5. **Code-link backfill prompt.** After the regen chain, surface any `Code files not referenced by any feature` SDD gaps as a separate decision: ask the operator if they want to run `pnpm noldor features fill-links-code-gaps` interactively to resolve them now (it produces a proposal MD for review, then `--apply` writes the updates). If yes, hand off to the operator — `/noldor-garden` does NOT execute it. If no, the gaps stay logged as Manual TODOs.

8. **Final report** to the user:

```
Archived: <count> plans → docs/superpowers/plans/archive/
Archived: <count> specs → docs/superpowers/specs/archive/
Dropped: <count> backlog blocks
Manual TODOs: <count> contradictions, <count> SDD gaps (see above)
Architecture invariants: <count> violations (see above)
Regen chain: ✓ all passed (or: ✗ <failed step>)

Stage and commit when ready.
```

## Rules

- **Never** auto-commit. Operator commits.
- **Never** run `pnpm release`.
- **Never** edit `CLAUDE.md`, `docs/noldor/versioning.md`, or any rule doc as part of this skill — contradictions surface as manual TODOs.
- **Never** add new contradiction candidates that the deterministic detector did not flag. The LLM pass can only filter (downgrade) candidates, not upgrade.
- If the user types `edit` at confirmation, walk auto-action rows individually for keep/skip, then re-present a final yes/no.
