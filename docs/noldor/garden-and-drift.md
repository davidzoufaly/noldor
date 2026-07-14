---
noldor-page: garden-and-drift
introduced: 0.4.0
---

# Garden and Drift

Periodic audit that detects framework drift: features without tests, plans without specs, untriaged ideas, stale backlog, rule contradictions, and source-of-truth drift between code and framework pages.

## Commands

| Trigger                                            | What it does                                                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `/noldor-garden`                                          | Interactive audit; walks all 20 detectors + 4 doc-maintenance signals                                       |
| `pnpm noldor garden detect`                        | Same as `/noldor-garden` non-interactive; JSON report (`category`, `itemId`, `message` per gap)                    |
| `pnpm noldor garden sdd-report`                    | Walks SDD detectors (1-13 + 19), writes `docs/sdd-report.md`. Informational — never blocks                  |
| `pnpm noldor garden sdd-report --json`             | Machine-readable output (no file write)                                                                     |
| `pnpm noldor garden sdd-report --release`          | Includes the Gate compliance section (override + tier + review-skip counter). Invoked by `pnpm release`.    |
| `SDD_STALE_DAYS=120 pnpm noldor garden sdd-report` | Override the 90-day default for the stale-backlog detector                                                  |
| `pnpm noldor validate skill-catalog`               | **Hard pre-commit gate** for the `.claude/skills/` ↔ `skill-catalog.md` 1:1 contract; missing/orphan = fail |

`pnpm release` regenerates `docs/sdd-report.md` as a precondition (commits the snapshot for trend visibility). Pre-commit does NOT run the report — too slow once features grow. The script is the source of truth — when this page disagrees with [`src/garden/garden-detect.ts`](../../src/garden/garden-detect.ts), the script wins.

## Detectors

| #   | Detector                              | Signal                                                                                                                                                              | Fix                                                                                                        |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | Done features without tests           | `phase: done` and `links.tests` empty                                                                                                                               | Add a test at the appropriate layer; populate via `pnpm noldor sync test-links`                            |
| 2   | Done features without docs            | `phase: done` and `links.docs` empty (Tooling exempt)                                                                                                               | Tag a tutorial/explanation with `<!-- @feature: <slug> -->`; run `pnpm noldor sync doc-links`              |
| 3   | Features without spec                 | `noldor-tier == full` and `links.spec` empty (formerly flagged all FDs; now tier-gated)                                                                             | Author or link the spec under `docs/superpowers/specs/`                                                    |
| 4   | Done features missing `introduced`    | `phase: done` and frontmatter has no `introduced` field                                                                                                             | `pnpm release` fills on next bump; manual edits forbidden                                                  |
| 5   | Untriaged ideas                       | `ideas.md` bullets without a `[triaged …]` marker                                                                                                                   | Run `/noldor-triage`                                                                                              |
| 6   | Stale backlog entries                 | `docs/backlog.md` blocks with `since > 90d` and no matching feature MD                                                                                              | Drop, age out, or promote                                                                                  |
| 7   | Spec files not referenced             | `docs/superpowers/specs/*.md` not pointed at by any FD `links.spec`                                                                                                 | Link the spec or archive it                                                                                |
| 8   | Plan files without matching spec      | Plan filename slug has no spec sibling                                                                                                                              | Author the spec or rename the plan                                                                         |
| 9   | Code files not referenced             | Source file under the configured `scanPaths` with no FD owner (after `pnpm noldor features fill-links-code-gaps --auto-high` resolves unambiguous matches) | Run interactive `pnpm noldor features fill-links-code-gaps` via `/noldor-garden` step 7.5                         |
| 10  | Tests without `@tests:` tag           | Test file missing `// @tests: <slug>` directive                                                                                                                     | Add the tag (`pnpm noldor validate features` hard-fails this in pre-commit)                                |
| 11  | Tutorials without `@feature:` tag     | Tutorial/explanation MD missing `<!-- @feature: <slug> -->`                                                                                                         | Add the tag                                                                                                |
| 12  | README architecture drift             | Workspace package added/removed without README table sync                                                                                                           | Hand-edit README architecture/packages section                                                             |
| 13  | Tests with incomplete co-tag          | Test imports source files owned by FDs not in its `@tests:` list                                                                                                    | Extend the `@tests:` list; ensure graphify is fresh                                                        |
| 14  | Rule contradiction CLAUDE.md ↔ Noldor | LLM-supplemental pass flags a genuine rule mismatch on the tracked pairs                                                                                            | Decide which side is correct; align the other                                                              |
| 15  | Source-of-truth ↔ page drift          | Source commit is more than 30 days newer than the paired page commit                                                                                                | Refresh the page to reflect the source change, then commit                                                 |
| 16  | Plan without FD                       | Plan file at `docs/superpowers/plans/<date>-<slug>.md` whose slug has no matching `docs/features/<slug>.md`                                                         | Promote the plan's feature onto a FD or archive the plan                                                   |
| 17  | FD without plan                       | FD (non-grandfathered) with no matching plan file glob hit                                                                                                          | Author a plan; FDs created before the rollout marker are grandfathered                                     |
| 18  | Codex CR override audit               | `.noldor/cr-overrides.log` shows ≥ 3 overrides in 14 days, reasons < 10 chars, or repeated identical reasons                                                        | Investigate why codex CR is being skipped; rerun or fix the underlying issue                               |
| 19  | Done features without code            | `phase: done` and `links.code` empty (no opt-out unless `['n/a']` sentinel; pre-MVP grandfathered)                                                                  | Populate `links.code` via `pnpm noldor sync fd-resources` or hand-edit; sentinel for rare pure-content FDs |
| 20  | Circular `blocked-by` chain           | A cycle in the roadmap+backlog `blocked-by` graph (`deps:` alias unioned; ID and slug refs resolved to slugs; self-loops included)                                   | Break the cycle by removing one `blocked-by` ref (`manual-edit`)                                            |

`/noldor-garden` adds 4 doc-maintenance signals on top (not in `pnpm noldor garden sdd-report`): stale plans (move to `docs/superpowers/plans/archive/` once matching feature is `done`), stale specs (same trigger, `docs/superpowers/specs/archive/`), unused backlog entries (drop or merge), and a deterministic-seed rule-contradiction sweep with an LLM false-positive filter.

> **Beyond the numbered 20.** `detectAll` ([`src/garden/garden-detect.ts`](../../src/garden/garden-detect.ts)) also wires in unnumbered detectors with no row above: skill-code-drift, fd-link-rot, code-links-drift, migration-coverage, milestone-shipped-incomplete, and bootstrap-override-audit (plus the four gate-compliance detectors below). The script is the source of truth; this numbered table is the stable-numbered subset, not the full census.

When a spec is moved into `archive/` (whether via `/noldor-garden` or a hand-run `git mv`), `pnpm noldor sync fd-resources` auto-rewrites every FD's `links.spec` frontmatter path to the archive variant on the next regen-chain pass. The rewrite is conservative — only fires when the current path is missing on disk AND `<dirname>/archive/<basename>` exists — and idempotent, so running the sync twice produces no diff. See `src/sync/sync-fd-resources.ts` (`resolveSpecPath`).

## Gate compliance

`pnpm noldor garden detect --gate-compliance` runs a focused subset of detectors that enforce the 6-path gate model:

| Detector                 | What it flags                                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `override-audit`         | Scans `.noldor/overrides.log` + `Noldor-Path-Override` trailers in the last 30 days; reports count + reasons; INFO when any exist, WARN when > 3. Excludes `release-automation` commits. |
| `tier-mismatch`          | `noldor-tier == full` but `links.spec` empty → spec-vs-tier drift.                                                                                                                       |
| `allowlist-drift`        | `Noldor-Path: micro-chore` commits whose diff escaped the allowlist (catches hook-bypass attempts).                                                                                      |
| `trailer-scope-mismatch` | `Noldor-FD: <slug>` present but Conventional Commit scope doesn't reference the FD's `<area>:<slug>` — surfaced for triage.                                                              |
| `plan-without-fd`        | Plan files whose slug doesn't resolve to a `docs/features/*.md`.                                                                                                                         |
| `fd-without-plan`        | FDs (post-rollout, non-grandfathered) with no matching plan file.                                                                                                                        |

`pnpm release` requires `pnpm noldor garden detect --gate-compliance` to pass with zero override-tier-mismatch findings before proceeding. `sdd-report.md` gains a "Gate compliance" section with override usage, tier distribution, and review-skip counts — **only when regenerated via `pnpm noldor garden sdd-report --release`** (which `pnpm release` invokes). Routine `pnpm noldor garden sdd-report` runs omit the section so per-commit counter drift doesn't pollute the committed markdown.

## Tracked pairs (Detectors 14-15)

**CLAUDE.md ↔ Noldor** (Detector 14) — section ↔ owner page mapping for the rule-contradiction sweep. Source file: `.claude/CLAUDE.md`.

| CLAUDE.md section             | Should redirect to                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `## Workflow`                 | [`workflow.md`](workflow.md) + [`complexity-gating.md`](complexity-gating.md)                   |
| `## Git`                      | [`git-and-commits.md`](git-and-commits.md) + [`worktree-discipline.md`](worktree-discipline.md) |
| `## Documentation`            | [`doc-conventions.md`](doc-conventions.md)                                                      |
| `## Triage + SDD`             | [`triage.md`](triage.md) + [`garden-and-drift.md`](garden-and-drift.md)                         |
| `## Testing` (framework half) | [`testing-principles.md`](testing-principles.md)                                                |
| `## Graphify`                 | [`graph-integration.md`](graph-integration.md)                                                  |

**Source-of-truth ↔ page drift** (Detector 15) — defined in [`src/garden/garden-detect.ts`](../../src/garden/garden-detect.ts) `SOURCE_DRIFT_PAIRS`. Pure-data check (`git log -n 1 --format=%cI -- <path>`); no AST parsing.

| Source                               | Page                                           |
| ------------------------------------ | ---------------------------------------------- |
| `src/features/feature-schema.ts` | [`feature-md-schema.md`](feature-md-schema.md) |
| `.claude/skills/`                    | [`skill-catalog.md`](skill-catalog.md)         |
| `lefthook.yml` + `package.json`      | [`script-catalog.md`](script-catalog.md)       |
| `src/release/`                   | [`versioning.md`](versioning.md)               |
| `src/garden/`                    | [`garden-and-drift.md`](garden-and-drift.md)   |

## Sentinels — opt out of FD detectors

The detectors that scan FD frontmatter (Detectors 1, 2, 19) accept the literal sentinel `['n/a']` (not a bare string, not an empty array — empty still trips the detector):

- `links.docs: ['n/a']` — opt out of Detector 2 (Done features without docs). Allowed when `category: Tooling` and the feature has no user-visible surface.
- `links.tests: ['n/a']` — opt out of Detector 1 (Done features without tests). Use sparingly — for features with no testable surface (one-off rebrands, doc moves).
- `links.code: ['n/a']` — opt out of Detector 19 (Done features without code). Use sparingly — for pure-content / branding features that legitimately have no implementation code.

## Exemptions

`category: Tooling` auto-exempts user-facing detectors (Detector 2 silently skips Tooling features). Exact rules live in [`src/garden/garden-detect.ts`](../../src/garden/garden-detect.ts) — script wins on disagreement.

## Audit-only — never blocks

`/noldor-garden`, `pnpm noldor garden detect`, and `pnpm noldor garden sdd-report` are informational. They never block `pnpm release` or pre-commit. Their findings surface as a punch list. The exception is the `pnpm noldor validate skill-catalog` strict pre-commit gate (skills filenames ↔ `skill-catalog.md` headings, 1:1 contract) — see Commands above.
