# Specs-Only Tier Produces a Spec File — Design

**Status:** Draft
**Parent FD:** [`noldor`](../../features/noldor.md)
**Date:** 2026-05-25

## Problem

The `rename-plan-only-tier-to-specs-only` rename (#39) flipped the tier label `plan-only → specs-only` as a pure terminology shift — same semantics. The tier still produces only a plan file (`docs/design/plans/`) and no spec file (`docs/design/specs/`). The renamed tier's name now contradicts its behavior:

- **Tier name** says "specs-only" → reader expects a spec artifact.
- **Tier behavior** still writes a plan, not a spec.
- **Path matrix** in `docs/noldor/complexity-gating.md` shows `specs-only-*` rows with `Spec ✗` + `Plan ✓` — the table is self-consistent with behavior but contradicts the tier name.
- **Rename FD User Story** ([docs/features/rename-plan-only-tier-to-specs-only.md:23](../../features/rename-plan-only-tier-to-specs-only.md)) said the rename was to "reflect what it actually produces (a spec, not a plan-without-spec)" — but the implementation never followed through. The rename was label-only.

The contradiction confused an operator and surfaced two adjacent gaps:

1. `Brainstorm` and `Spec` columns in the path matrix duplicate each other (brainstorming → spec is 1:1).
2. `full-attach` pre-commit hook (`scripts/hooks/noldor-validate-trailer.ts:176-191`) requires a spec file at the time the phase-revert commit lands, but the gate skill prescribes phase-revert as the _first_ attach commit (before brainstorming runs). Chicken-and-egg: phase-revert commits fail validation until a spec exists.

## Goal

Honor the rename's stated intent. `specs-only` becomes a tier that produces a spec file (no plan). Introduce a separate `plan-only` tier (revert of the original name) for the legacy behavior. Three tiers going forward:

| Tier         | Artifacts   | Use case                                                                                                          |
| ------------ | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `plan-only`  | plan file   | Mechanical work, taxonomy clear, no design ambiguity                                                              |
| `specs-only` | spec file   | Design clarity needed but small enough that spec is sufficient context for implementation (no plan decomposition) |
| `full`       | spec + plan | New design dialogue with decomposition needed                                                                     |

## Non-Goals

- **No retroactive backfill** of spec files for the 29 existing FDs currently tagged `noldor-tier: specs-only`. They get their tier flipped to `plan-only` (the rename was always purely cosmetic; their behavior matches `plan-only`). Verified 2026-05-25 (repro: `ls docs/design/specs/ | grep -v archive` lists 3 specs, then `grep "noldor-tier:" docs/features/<each-parent>.md` shows `full` for both shipped specs + this in-flight spec is the third): every live spec under `docs/design/specs/` belongs to a `noldor-tier: full` FD or is this in-flight spec — no current `specs-only` FD has a real spec file, so the blanket flip is loss-free.
- **No re-design of CR pipeline schemas.** `scripts/cr/findings-schema.ts:18` already supports `kind: 'spec'`. The pipeline routes `kind=spec` correctly today; only the gate-skill orchestrate-invocation strings need updating.
- **No change to `full` tier behavior.** `full-new`/`full-attach` continue to produce spec + plan exactly as today.
- **No change to `fast-track` or `micro-chore`.** Lightweight paths are out of scope.

## Architecture

### Tier and path roster

| #   | Path                | FD                       | Design Spec | Plan | Worktree | Reviewer | Use                                       |
| --- | ------------------- | ------------------------ | ----------- | ---- | -------- | -------- | ----------------------------------------- |
| 1   | `micro-chore`       | —                        | —           | —    | —        | —        | doc/policy edits matching allowlist       |
| 2   | `fast-track`        | —                        | —           | —    | ✓        | ✓        | small code change, no FD warranted        |
| 3   | `plan-only-new`     | new (tier: `plan-only`)  | —           | ✓    | ✓        | ✓        | mechanical work, taxonomy already clear   |
| 4   | `plan-only-attach`  | parent (any tier)        | —           | ✓    | ✓        | ✓        | mechanical enhancement under existing FD  |
| 5   | `specs-only-new`    | new (tier: `specs-only`) | ✓           | —    | ✓        | ✓        | design needed, spec sufficient context    |
| 6   | `specs-only-attach` | parent (any tier)        | ✓           | —    | ✓        | ✓        | design-light enhancement under parent FD  |
| 7   | `full-new`          | new (tier: `full`)       | ✓           | ✓    | ✓        | ✓        | new design dialogue, new FD               |
| 8   | `full-attach`       | parent (any tier)        | ✓           | ✓    | ✓        | ✓        | substantial enhancement under existing FD |

**Design Spec** = a separate document under `docs/design/specs/`, produced by `superpowers:brainstorming`. Both `specs-only` and `full` tiers produce one. The FD frontmatter + body always exists for FD-carrying paths regardless of tier.

### Gate flow per path

- **`plan-only-new` / `plan-only-attach`** (unchanged behavior, renamed from current `specs-only-*`): worktree → FD scaffold → `superpowers:writing-plans` → Step 2.5 (`--kind plan`) → implementation.
- **`specs-only-new` / `specs-only-attach`** (NEW behavior): worktree → FD scaffold → `superpowers:brainstorming` (writes spec to `docs/design/specs/<date>-<slug>-design.md` for `-new`, `<date>-<parent>-<enhancement>-design.md` for `-attach`) → Step 2.5 (`--kind spec`) → implementation. **No `writing-plans` step.** Implementation flows directly from the spec.
- **`full-new` / `full-attach`** (unchanged): worktree → FD scaffold → brainstorming → spec → Step 2.5 (`--kind spec`) → `writing-plans` → plan → Step 2.5 (`--kind plan`) → implementation.

The difference between `specs-only-*` and `full-*` is whether `writing-plans` runs after the spec. The difference between `specs-only-*` and `plan-only-*` is whether brainstorming runs at all (spec produced) versus writing-plans (plan produced).

### PATHS enum + Zod schema

- `scripts/noldor/session.ts` `PATHS` const: add `'plan-only-new'`, `'plan-only-attach'`. Keep `'specs-only-new'`, `'specs-only-attach'` (semantics flip; enum strings unchanged).
- `scripts/features/feature-schema.ts` `noldor-tier` enum: becomes `['plan-only', 'specs-only', 'full']`.

### In-flight session marker migration

Because `specs-only-new` / `specs-only-attach` enum strings stay the same but gain new semantics (brainstorming + spec instead of writing-plans + plan), any `.noldor/session.json` markers written before this PR lands will silently execute the new flow on resume — likely confusing the operator mid-feature. Mitigations:

- The `SessionMarker` Zod schema gets a new optional `markerVersion: z.literal(2).optional()` field. New markers (post-PR) emit `markerVersion: 2`. Markers without the field are treated as pre-flip (version 1) and rejected on resume with a clear error: `"Session marker from pre-flip era; tier semantics changed. Re-pick path via /gate. Worktree at <path> retained — to continue under the new semantics, hand-edit .noldor/session.json adding 'markerVersion: 2' (auto-rewrite available via 'pnpm noldor:bump-session-marker')."`
- Worktrees in flight at PR-merge time: operator-facing rollout note in the FD's User Story instructs to drain in-flight `specs-only-*` sessions before pulling the PR. The `phase: done` flip happens at PR merge time, so the rollout is detectable by scanning for any `.noldor/session.json` with `path: specs-only-*` and no `markerVersion`.

Trade-off: a small marker-schema bump touches `scripts/noldor/session.ts` and its tests. Cheap. Migration risk without the bump is real (operator returns from lunch, picks up worktree, the session marker invokes the wrong skill).

### Hook updates (`scripts/hooks/noldor-validate-trailer.ts`)

- `plan-only-new`: require `noldor-tier: plan-only` in FD frontmatter (mirror existing `specs-only-new` logic).
- `plan-only-attach`: validate parent FD exists. No spec/plan file existence check (plan is written after the attach phase-revert commit).
- `specs-only-new`: require `noldor-tier: specs-only` in FD frontmatter + spec file at `docs/design/specs/<date>-<slug>-design.md`.
- `specs-only-attach`: require spec file at `docs/design/specs/<date>-<parent>-<enhancement>-design.md`. The `<enhancement>` slug is not currently prompted explicitly by the gate skill — today's `full-attach` scaffold says only `Prompt parent slug` ([.claude/skills/gate/SKILL.md:76](../../../.claude/skills/gate/SKILL.md#L76)) and `<enhancement>` appears solely inside the spec-filename template. This PR formalizes the prompt: gate-skill Step 2 scaffolds for both `full-attach` and `specs-only-attach` must explicitly ask the operator for `<enhancement>` after `<parent>`. The answer drives both the spec filename and the FD's enhancement-tracking copy block. Prompt wording: `Enhancement slug (short, kebab-case, scopes the spec/plan filename)?`.
- `full-new` / `full-attach`: unchanged (already requires spec file).

### Adjacent fix — phase-revert hook ordering

`scripts/hooks/noldor-validate-trailer.ts` currently rejects `full-attach` commits whose spec file does not yet exist, blocking the phase-revert commit that gate prescribes as the _first_ attach commit (before brainstorming runs). Same blocker will apply to the new `specs-only-attach` semantic.

**Fix:** Add a subject-line exception so phase-revert commits bypass the spec-file existence check. Match the canonical phase-revert subject:

```
^docs\(features:[^)]+\): revert phase done → in-progress for attach session$
```

The exception applies to `specs-only-attach` and `full-attach`. The trailer's other validation (path enum, FD existence, scope) still runs. Phase-revert commits remain auditable via the `Noldor-Path:` trailer + the canonical subject pattern.

Trade-off: a malicious commit using the canonical subject without actually being a phase-revert could pass the spec-existence check. Mitigation: the commit also passes through `scripts/garden/detectors/override-audit.ts` if it lacks a corresponding `Noldor-Path-Override:` trailer, and the diff-content guard (`scripts/hooks/noldor-pre-commit.ts` allowlist) still applies. Net risk: low.

### Step 2.5 reshape

CR pipeline already supports `kind: 'spec'` at [scripts/cr/findings-schema.ts:18](../../../scripts/cr/findings-schema.ts). No schema change needed.

- `specs-only-*`: gate Step 2.5 invokes `pnpm cr:orchestrate --kind spec` once after the spec. Continue-dialog options match existing `kind=spec` behavior (no `proceed-autonomous` — autonomous mode currently triggers on plan-confirm; staying consistent).
- `plan-only-*`: gate Step 2.5 invokes `--kind plan` once (unchanged from today's `specs-only-*` behavior).
- `full-*`: unchanged (kind=spec, then kind=plan).

**Implication for autonomous mode:** `proceed-autonomous` continues to require `kind=plan` per the existing gate-skill prose. `specs-only-*` paths skip autonomous mode entirely (no plan stage). This is acceptable — `specs-only-*` is by definition smaller-scope work where manual oversight between spec and implementation is cheap. If the operator wants autonomous, they should use `full-*` (which has a plan stage where autonomous triggers).

### Migration of 29 existing FDs

One-shot script `scripts/noldor/rename-specs-only-tier-to-plan-only.ts` (mirror of `scripts/noldor/rename-plan-only-tier.ts` but reversed):

- Scans `docs/features/*.md` (excludes archives) for `noldor-tier: specs-only` frontmatter.
- Replaces with `noldor-tier: plan-only`.
- Touches: 29 FD files.
- Runs in the same commit as the atomic flip via the `pnpm noldor:rename-specs-only-tier` package.json script.

The script is **not** a reusable migration helper — it's a one-shot, deleted in a follow-up commit (matches the pattern used by `rename-plan-only-tier.ts`).

### Framework docs

Updates required (all in the same PR, atomic):

- **`docs/noldor/complexity-gating.md`**: rewrite the path matrix table (3 tiers, 8 paths, drop `Brainstorm` column, rename `Spec → Design Spec`). Update `## Allowlist for micro-chore`, `## Review handoff after spec/plan` (specs-only now hits the pause once at kind=spec), `## Autonomous mode` (clarify `specs-only-*` paths skip autonomous), `### Path confirmation beat`, and the worked examples.
- **`docs/noldor/lifecycle.md`**: update the mermaid flow diagram + path descriptions to show 8 paths.
- **`docs/noldor/cr-pipeline.md`**: clarify `kind=spec` lane semantics for `specs-only-*` paths (no orchestrate change needed; just doc).
- **`.claude/skills/gate/SKILL.md`**: rewrite Step 1 path picker (8 options), Step 2 path-specific scaffold (add `plan-only-*`, change `specs-only-*` to invoke brainstorming), Step 2.5 path-to-kind mapping table, autonomous-mode caveat.
- **`.claude/skills/promote/SKILL.md`**: AskUserQuestion wording for tier picker. Currently asks `specs-only (no brainstorm) or full (spec + brainstorm)?` — becomes `plan-only (no spec) or specs-only (spec, no plan) or full (spec + plan)?`.
- **`.claude/skills/new-feature/SKILL.md`**: same tier-picker wording update.
- **`docs/noldor/skill-catalog.md`**: refresh tier descriptions if listed.
- **`docs/roadmap.md`**: the existing entry `#### Specs-Only Path: Print Detailed Plan Summary to Operator` becomes `#### Plan-Only Path: Print Detailed Plan Summary to Operator` (it referred to the old plan-producing semantic; rename keeps the entry valid). Body prose adjusts.
- **`docs/features/rename-plan-only-tier-to-specs-only.md`**: add a `## Follow-up` note linking forward to this FD's slug, explaining that the rename's User Story intent ("produces a spec") was completed in this enhancement.

## Data Flow

```
Operator runs /gate
  → Step 0: priority pickup (unchanged)
  → Step 1: path picker (8 options instead of 6)
  → Step 1.5: confirmation (unchanged shape)
  → Step 2: path-specific scaffold
      plan-only-*  → worktree → FD scaffold → writing-plans
      specs-only-* → worktree → FD scaffold → brainstorming (writes spec)
      full-*       → worktree → FD scaffold → brainstorming (writes spec)
  → Step 2.5: CR pause per artifact
      kind=spec for specs-only-* (1×) and full-* (1×, before plan stage)
      kind=plan for plan-only-* (1×) and full-* (1×, after plan stage)
  → Implementation
  → Step 4: PR flow (unchanged)
```

## Error Handling

- **Invalid tier in FD frontmatter** (e.g., a stale `noldor-tier: specs-only` that's actually a plan-only FD): caught at commit time by `scripts/features/validate-features.ts` — the migration script rewrites all 29 existing FDs in the same commit so no stale tier values survive.
- **Spec file missing on `specs-only-attach` commit** (gate skill operator forgot the brainstorming step): pre-commit hook rejects with a clear error pointing to the expected spec path. Same shape as today's `full-attach` error.
- **Phase-revert commit on `specs-only-attach` or `full-attach`**: subject-line exception in `noldor-validate-trailer.ts` lets the commit through despite the spec file not yet existing. Operator's brainstorming step runs next.
- **Operator picks `specs-only-*` but discovers mid-flight that a plan is also needed**: escape hatch is to switch to `full-*` via `/gate --resume <slug>` and override the path. The session marker can be hand-edited (`.noldor/session.json`) as a last resort; the prose in gate-skill Step 1 confirmation should mention this.

## Testing

- **Migration script** (`scripts/noldor/rename-specs-only-tier-to-plan-only.ts`): unit tests at `scripts/noldor/__tests__/rename-specs-only-tier-to-plan-only.test.ts` verify the regex substitution touches `noldor-tier: specs-only` → `plan-only` and leaves space-separated English phrases (`"specs only"` in prose) alone. Mirror the existing `scripts/noldor/__tests__/rename-plan-only-tier.test.ts` shape.
- **PATHS enum**: existing `scripts/noldor/__tests__/session.test.ts` extended with `plan-only-new` and `plan-only-attach` cases.
- **Hook validate-trailer**: new test cases for `plan-only-new`/`-attach`, plus updated `specs-only-new`/`-attach` cases that now require a spec file. Phase-revert subject exception gets its own test.
- **Schema validation**: `scripts/features/__tests__/feature-schema.test.ts` updated for the 3-value `noldor-tier` enum.
- **Integration** (manual): one dogfood pass via `/gate` picking `specs-only-new` to confirm the new flow ships a spec and no plan, and `plan-only-new` to confirm the legacy behavior continues working under its new name.

## Open Questions

- **`specs-only-*` autonomous mode**: skipped today because autonomous triggers on plan-confirm. Could be revisited as a follow-up if operators want spec-stage autonomous (would need a new `proceed-autonomous` continue-dialog option at kind=spec).
- **`specs-only` Step 2.5 continue-dialog wording**: spec is followed by direct implementation (no plan). Today's kind=spec continue-dialog at `full-*` advances to `/draft-feature-md` + writing-plans. For `specs-only-*` it advances to implementation. The gate-skill rewrite should mention this explicitly so the operator knows what `proceed` means in each context.

Neither is blocking. Both are scoped as plan-phase decisions.

## Touches (estimated)

- `scripts/noldor/session.ts` (PATHS enum + `markerVersion` field)
- `scripts/features/feature-schema.ts` (3-value `noldor-tier` enum)
- `scripts/hooks/noldor-validate-trailer.ts` (path validation + phase-revert subject exception)
- `scripts/noldor/rename-specs-only-tier-to-plan-only.ts` (new, one-shot)
- `scripts/noldor/__tests__/rename-specs-only-tier-to-plan-only.test.ts` (new)
- `scripts/noldor/__tests__/session.test.ts` (PATHS + markerVersion cases)
- `scripts/features/__tests__/feature-schema.test.ts`
- `scripts/hooks/__tests__/noldor-validate-trailer.test.ts`
- `docs/features/*.md` (29 FDs — tier rewrite, mechanical)
- `docs/noldor/complexity-gating.md` (path matrix rewrite)
- `docs/noldor/lifecycle.md` (mermaid flow + path descriptions)
- `docs/noldor/cr-pipeline.md` (kind=spec semantics note)
- `docs/noldor/skill-catalog.md` (if tier descriptions referenced)
- `.claude/skills/gate/SKILL.md` (Step 1 picker, Step 2 scaffolds, Step 2.5 kind mapping, autonomous-mode caveat)
- `.claude/skills/promote/SKILL.md` (tier-picker wording)
- `.claude/skills/new-feature/SKILL.md` (tier-picker wording)
- `docs/roadmap.md` (existing `#### Specs-Only Path: Print Detailed Plan Summary to Operator` entry's title + body)
- `docs/features/rename-plan-only-tier-to-specs-only.md` (follow-up note linking to this FD)
- `docs/features/noldor.md` (enhancement entry under parent FD)
- `package.json` (new `noldor:rename-specs-only-tier` script wiring)
