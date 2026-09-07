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

1. **Run** `pnpm --silent noldor garden detect`. Parse JSON. (The `--silent` flag suppresses pnpm's banner lines so stdout is pure JSON.) If **every** key is empty (emptiness rule in step 4), report "Garden is tidy" and stop. Check every key the payload carries, not a fixed count — `structuralContextStubs` is a finding like any other, and a gate that enumerates a subset silently swallows whichever key it predates.
2. **For each `contradictions` entry**, read both `pair[0]` and `pair[1]`, then:
   - Find the pattern match (or its absence) and the surrounding ~50 lines.
   - Decide: is the rule actually divergent, or are the two docs consistent in context?
   - If consistent → drop the entry from the checklist, leaving a one-line note in the final report (`filtered: <rule>`).
   - Otherwise → keep with the original `message`.
3. **Manual plan sweep.** The detector matches plans by single-slug feature lookup and age. Multi-feature plans (e.g. one plan covers `state-management` + `scene-tree-panel`), infra plans (e.g. `feature-md-framework`, `versioning`), and parent-plus-`-partN` splits all slip through when their slug doesn't match a feature MD. After step 2:
   - List every `*.md` in `docs/design/plans/` (exclude `archive/`) that did NOT appear in `stalePlans`.
   - For each, read the first 25 lines (Goal / Architecture / Spec). Decide: is the work shipped (matches one or more done feature MDs, or infra now in active use)?
   - Present the candidates as a "Manual sweep" subsection of the checklist with proposed slug → feature mapping and an `archive` action. Operator confirms y/n per row at confirmation step.
4. **Render** the checklist. **Derive the sections from the payload, never from a list written here.** Emit one section per key whose value is non-empty, in the order `garden detect` emits them, plus the `Manual sweep` section from step 3 (the one section with no payload key). A key this skill has never heard of still gets a section — that is the whole point of the rule in step 1, and a hand-maintained roster is exactly how `architectureAdvisories` went unrendered for a release cycle.

   **Emptiness rule.** An array-valued key is empty when it has no entries. The one non-array key, `overrideAudit`, is an `OverrideAuditResult` and is empty when its `severity` is `OK` — so an `INFO` audit still renders, which is the detector's stated intent (`src/garden/detectors/override-audit.ts`: "any override keeps it INFO-visible (never disappears)"). Step 1's tidy gate is the one place that reads it differently: `overrideAudit` at `INFO` does **not** by itself keep the pass from reporting "Garden is tidy", because `INFO` means visible, not actionable, and overrides are routine here. Only `WARN` — unexpected overrides above the configured threshold — counts as untidy.

   **Rendering `overrideAudit`.** It is one section, not one per override. `(M)` is its `count` (UNEXPECTED overrides — the same number that drives `severity`), never `overrides.length`. Follow the heading with a `•` summary line carrying `severity` and `<count> unexpected, <expectedCount> expected`, then one `•` row per entry in `overrides[]` showing `sha`, `reason`, and whether it was `expected`. Every row is advisory — the whole section is `•`, never `✓`.

   **Heading.** Split the camelCase key on word boundaries and sentence-case it (`fdDiagramStubs` → `Fd diagram stubs`, `architectureAdvisories` → `Architecture advisories`), then append the count. Use a friendlier heading only for the keys the table below names.

   **Row body.** Print the finding's own fields: lead with whatever locates it (`path`, `file`, `artifact`, `slug`, `pair`, `itemId`) and follow with its `message` / `reason`. For a shape this skill does not know, print every field the row carries as `key: value` rather than guessing which ones matter — a verbose row that shows the finding beats a tidy one that hides it.

   **Markers and actions.** Only these keys get a hand-written shape and an auto-action; every other key renders per the rules above with a `•` bullet and no action line:

   | key | heading | marker | action line |
   | --- | --- | --- | --- |
   | `stalePlans` | Stale plans | `✓` | `→ archive (<reason summary>)` |
   | `staleSpecs` | Stale specs | `✓` | `→ archive (<reason summary>)` |
   | _(no key — from step 3)_ | Manual sweep | `✓` | `→ archive (covers <feature-slug>… — shipped)` or `(infra: <subsystem> — in active use)` |
   | `unusedBacklog` | Unused backlog | `✓` | `→ drop (<reason summary>)` |
   | `contradictions` | Rule contradictions | `⚠` | `→ manual edit. <message>` — step-2 survivors only |

   `✓` marks a row step 5 will auto-action. `⚠` and `•` never are, whatever the key. That marker — not a section name — is what steps 6 and 8 read, so a newly added key is manual-only by default and can never be silently auto-actioned by a skill that has never seen it.

   The shape below is an illustration of the rules, not the roster:

```
Garden findings (N):

Stale plans (M):
  ✓ <path>
    → archive (<reason summary>)

Manual sweep (M):
  ✓ <path>
    → archive (covers <feature-slug> — shipped)

Unused backlog (M):
  ✓ ### <slug> (since <date>)
    → drop (<reason summary>)

Rule contradictions (M):
  ⚠ <docA> ↔ <docB>
    → manual edit. <message>

Sdd gaps (M):
  • <category>: <itemId> — <message>

Architecture advisories (M):
  • <category>: <itemId> — <message>

<Sentence-cased name of any other non-empty key> (M):
  • <locating field> — <message>

Confirm all auto-actions? (y/n/edit)
  y: execute every ✓ row (archive plans incl. manual sweep, archive specs, drop backlog blocks), run regen chain
  n: do nothing
  edit: row-by-row override (✓ rows only)
```

5. **On confirm (`y` or partial-confirm via `edit`)**, execute auto-actions in order:
   - **Archive plan** (both detector-flagged and manual-sweep rows) — `mkdir -p docs/design/plans/archive` (idempotent), then `git mv <path> docs/design/plans/archive/<basename>`. On collision (target exists), abort that row, continue.
   - **Archive spec** — `mkdir -p docs/design/specs/archive` (idempotent), then `git mv <path> docs/design/specs/archive/<basename>`. Same collision behavior as plans.
   - **Drop backlog block** — read `docs/backlog.md`. Locate the level-3 heading whose slugified name matches the finding's `slug`. Remove the heading + body up to (but not including) the next `### ` or `## ` heading or EOF. Trim any trailing blank lines. Write back. If the heading isn't found, abort that row, continue. (As of the roadmap/backlog split, `docs/backlog.md` is a flat parking lot — no level-2 phase sections to preserve.)
6. **Every row step 4 did not mark `✓`** (`⚠` manual-edit rows and `•` advisory rows alike, whatever key they came from): never auto-actioned. A structural-context row is advisory by design — it names a design artifact whose `Structural context` unit is unwritten, and the remedy is either `pnpm noldor design graph-context --path <file>...` plus a paragraph, or a `noldor:cut <reason>` line recording a deliberate skip. Never edit someone's artifact prose for them, and never let one of these block a ship. Print as a "Manual TODOs" section in the final report with the file paths and messages so the operator knows where to edit.
7. **Regen chain (always, even if zero auto-actions):**

```
pnpm noldor sync test-links && pnpm noldor sync doc-links && pnpm noldor sync fd-resources && pnpm noldor validate features && pnpm noldor garden receipt
```

Each must succeed. If any fails, report the failure and the partial state. Do not roll back.

`pnpm noldor garden receipt` writes `.noldor/garden-receipt` (operator-local, gitignored) with HEAD SHA + timestamp. `pnpm release` reads this via `ensureGardenFresh()` and refuses to publish when no garden pass has happened since the last tracked-file commit. Bypass via `RELEASE_SKIP_GARDEN_GATE=1` for bootstrap commits only.

7.5. **Code-link backfill prompt.** After the regen chain, surface any `Code files not referenced by any feature` SDD gaps as a separate decision: ask the operator if they want to run `pnpm noldor features fill-links-code-gaps` interactively to resolve them now (it produces a proposal MD for review, then `--apply` writes the updates). If yes, hand off to the operator — `/noldor-garden` does NOT execute it. If no, the gaps stay logged as Manual TODOs.

8. **Final report** to the user:

```
Archived: <count> plans → docs/design/plans/archive/
Archived: <count> specs → docs/design/specs/archive/
Dropped: <count> backlog blocks
Manual TODOs: <count> total — one `<section heading>: <count>` clause per non-✓ section step 4 rendered (see above)
Regen chain: ✓ all passed (or: ✗ <failed step>)

Stage and commit when ready.
```

## Rules

- **Never** auto-commit. Operator commits.
- **Never** run `pnpm release`.
- **Never** edit `CLAUDE.md`, `docs/noldor/versioning.md`, or any rule doc as part of this skill — contradictions surface as manual TODOs.
- **Never** add new contradiction candidates that the deterministic detector did not flag. The LLM pass can only filter (downgrade) candidates, not upgrade.
- If the user types `edit` at confirmation, walk auto-action rows individually for keep/skip, then re-present a final yes/no.
