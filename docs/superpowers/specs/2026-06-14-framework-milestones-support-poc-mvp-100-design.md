# Framework Milestones Support (POC / MVP / 1.0.0) — Design

**Slug:** framework-milestones-support-poc-mvp-100
**FD:** docs/features/framework-milestones-support-poc-mvp-100.md
**Date:** 2026-06-14
**Tier:** specs-only
**Deps:** none (the `decouple-milestones-from-semver` work already landed — `/milestone` manages arbitrary-name milestones independent of semver; see `src/milestones/lib.ts`)

## Problem

Noldor already has a **milestone primitive** — but only the management half. Shipped today:

- `src/milestones/lib.ts` — `draftMilestone`, `activateMilestone` (atomic, ships previous active), `listMilestones`, `loadMilestones`, `loadMilestoneBySlug`; `milestoneFrontmatterSchema` (`name` / `status` ∈ draft|active|shipped / optional `description`).
- `.claude/skills/milestone/SKILL.md` — `/milestone draft|activate|edit|list`.
- `docs/vision.md` frontmatter `current-milestone: <slug>` (written by `activateMilestone`, `src/milestones/lib.ts:161`).
- `src/core/doc-roots.ts:29` — `milestones` doc root.
- `src/core/next-priority.ts` — `loadMilestoneGate` + `milestoneAligned` suggestion (reads active milestone's `## Gate`).
- `src/dashboard/views.ts:329` — `renderMilestoneBanner` (overview + `/vision`); `src/dashboard/data.ts:716` resolves the active milestone.
- `.claude/skills/triage/SKILL.md` — already uses the active milestone's `## Out of Scope` / `## Gate` for *bucketing*.

What is **missing** is the layer that connects an individual *feature* to a milestone and surfaces that membership across the framework. There is no way to record "this FD belongs to MVP", no detector for milestone/feature drift, no per-milestone feature roll-up on the dashboard, no per-bullet milestone proposal in `/triage`, and no doc page answering the recurring "where do milestones live?". `FeatureFrontmatterSchema` (`src/features/feature-schema.ts:38`) has no `milestone` field.

## Goals

1. Add an **optional** `milestone:` field to FD frontmatter, validated to resolve to a real `docs/milestones/<slug>.md`.
2. `/triage` proposes a milestone per roadmap bullet (the active milestone, when one is set); `/promote` copies it into the FD.
3. A `/garden` detector flags features whose milestone is `status: shipped` but whose `phase` is not `done`.
4. A dashboard `/milestones` page lists milestones grouped by status, each with its member features + phase roll-up.
5. A `docs/noldor/milestones.md` page documents where milestones live and links the `/milestone` skill.

The cross-cutting invariant: **every surface is a no-op when the `milestone` field is absent and no milestones are declared.** The framework never forces the abstraction.

## Non-goals

- No new milestone-management commands — `/milestone` already covers draft/activate/edit/list.
- No semver coupling — milestone names are arbitrary (`POC`, `MVP`, `1.0.0`, or anything).
- No auto-assignment of features to milestones (operator/triage chooses; never inferred from score).
- No mandatory milestone plan; no migration that back-fills `milestone:` onto existing FDs.
- No change to the milestone state machine (`draft → active → shipped`) in `src/milestones/lib.ts`.

## Design

### Unit 1 — FD frontmatter `milestone` field (`src/features/feature-schema.ts`)

Add to `FeatureFrontmatterSchema` (line 38), alongside `since`:

```ts
/** Optional milestone membership — the slug of a docs/milestones/<slug>.md
 *  file (filename stem == milestone frontmatter `name`). Absent by default;
 *  the framework never requires a milestone. Cross-checked against the
 *  milestones dir by validate-features (dangling reference = error). */
milestone: z.string().min(1).optional(),
```

`.strict()` already rejects unknown keys, so the field must be declared here to be permitted at all. No superRefine coupling — `milestone` is independent of `introduced`/`updated`.

Cross-reference validation lives in **`validate-features`** (the FD validator that already loads every FD and the consumer category set): when an FD declares `milestone: <slug>`, assert `docs/milestones/<slug>.md` exists (resolve via `loadDocRoots(cwd).milestones`, `src/core/doc-roots.ts:29`). A dangling reference is a hard error — mirrors the strictness applied elsewhere and matches the dashboard's existing "slug referenced but file not found" warning (`src/dashboard/views.ts:346`). When the field is absent, the check is skipped entirely.

### Unit 2 — `/triage` per-bullet milestone + `/promote` copy

`.claude/skills/triage/SKILL.md`: in the per-row proposal (step that emits `area` / `since` / `size` / `impact`), add an optional **`milestone`** line. Proposal rule: when `docs/vision.md` has an active `current-milestone:` and the bullet aligns with that milestone's `## Gate`, propose `- milestone: <active-slug>`; otherwise omit the line. Operator overrides per row, same as every other field. The line is written into the schema-C block in `docs/roadmap.md` only when proposed/confirmed — silently optional, exactly like `confidence`/`deps`.

`.claude/skills/promote/SKILL.md`: when the source schema-C block carries a `- milestone: <slug>` line, copy it verbatim into the scaffolded FD frontmatter (the same mechanism that copies `since`). Absent line → absent field.

This is skill-doc + schema-C-shape work only; no roadmap-parser code change is required because the dashboard's `roadmapEntrySchema` (`src/dashboard/data.ts:251`) does not enforce a closed field set on body bullets — but `validate:triage` must learn to accept (not reject) the optional `milestone` line on roadmap blocks.

### Unit 3 — `/garden` detector: shipped-milestone-but-incomplete (`src/garden/detectors/milestone-shipped-incomplete.ts`)

New detector module mirroring the shape of `src/garden/detectors/tier-mismatch.ts`:

- Input: all FDs (already loaded in `src/garden/garden-detect.ts`) + `loadMilestones(cwd)` (`src/milestones/lib.ts`).
- Build a `Map<slug, status>` from the milestones.
- Finding when: an FD has `frontmatter.milestone` set, that slug resolves to a milestone with `status: 'shipped'`, and `frontmatter.phase !== 'done'`.
- Message: ``${f.frontmatter.name}: milestone "${slug}" is shipped but feature phase is ${phase} (not done)``.
- Returns `[]` when no FD carries a `milestone` field — the no-op invariant.

Register it in `src/garden/garden-detect.ts` alongside the existing `detectTierMismatch` / `detectFdWithoutPlan` imports (lines 16–22) and wire its findings into the report aggregation the same way. Add `MilestoneShippedIncompleteFinding` to the type imports (line 32 cluster). Test: `src/garden/detectors/__tests__/milestone-shipped-incomplete.test.ts` covering (a) shipped milestone + in-progress feature → finding, (b) shipped milestone + done feature → none, (c) active milestone + in-progress → none, (d) no `milestone` field anywhere → none.

### Unit 4 — Dashboard `/milestones` page

- **Route**: add `if (pathname === '/milestones') return { handler: handleMilestones, pathParams: {} };` in `src/dashboard/server.ts` (after the `/vision` line, ~120). Add `handleMilestones` following the `handleVision` pattern (load data via `data.ts`, render via `views.ts`, return `RouteResult`).
- **Nav**: add `{ href: '/milestones', label: 'Milestones' }` to `NAV_LINKS` in `src/dashboard/layout.ts` (after the `/vision` entry, line 3). When `loadMilestones()` returns empty, the page renders an empty-state ("No milestones declared — milestones are optional.") so the nav link is never broken.
- **Data**: reuse `loadMilestones()` + `loadFeatures()` (`src/dashboard/data.ts:380`). Group features by their `frontmatter.milestone` slug; compute a per-milestone phase roll-up (done / in-progress counts).
- **View**: `renderMilestones` in `src/dashboard/views.ts` — milestones grouped by status (active / draft / shipped, reusing the existing `.milestone-banner` accent styling from `src/dashboard/layout.ts:117`), each listing its member FDs as links to `/features/<slug>` with a phase chip. A `shipped` milestone with any non-`done` member renders that row in the `warn` style already defined for the banner — visually echoing the Unit 3 detector.
- Add a `milestone` chip to each row on the existing `/features` list (`renderFeatures`) when the FD carries the field. Requires surfacing `milestone` on the dashboard `FeatureRecord` (`src/dashboard/data.ts` / `src/garden/sdd-report.ts:46`) — it flows through automatically once Unit 1 adds it to the parsed frontmatter, since the record embeds `frontmatter`.

### Unit 5 — `docs/noldor/milestones.md`

New framework page (`noldor-page: milestones` frontmatter per `src/core/validate-noldor.ts` convention). Content: what a milestone is, the `draft → active → shipped` lifecycle, where they live (`docs/milestones/<slug>.md` + vision's `current-milestone:`), the optional FD `milestone:` field, how `/triage` proposes it, what the garden detector flags, and that the whole layer is optional. Link it from `docs/noldor/README.md` (the index) and add a row to `docs/noldor/skill-catalog.md` for `/milestone`. This directly answers "where are milestones documented?". The page must be added to the parent FD's `links.docs` and committed under scope `noldor:milestones` (commit-msg validator `src/core/validate-noldor-scope.ts`).

## Acceptance criteria

- `FeatureFrontmatterSchema` accepts an FD with `milestone: mvp` and rejects an unknown sibling key (`.strict()` still holds).
- `validate:features` errors when an FD declares `milestone: ghost` and `docs/milestones/ghost.md` does not exist; passes when the file exists; passes when the field is absent.
- `/promote` on a roadmap block carrying `- milestone: mvp` scaffolds an FD whose frontmatter has `milestone: mvp`; a block without the line scaffolds an FD without the field.
- Garden detector emits exactly one finding for a `phase: in-progress` FD whose milestone is `status: shipped`, and zero findings when no FD carries a `milestone` field.
- `GET /milestones` returns 200, lists each milestone with its member features, flags shipped-milestone-with-open-feature rows in `warn` style, and renders an empty-state when no milestones exist.
- `docs/noldor/milestones.md` exists, is linked from `docs/noldor/README.md`, and passes `validate:noldor` (frontmatter) + `validate:noldor-scope` (commit scope).
- With zero milestones declared and no `milestone:` fields, every new surface is a silent no-op (detector empty, dashboard empty-state, triage omits the line) — verified by an explicit test.

## Risks / trade-offs

- **Slug vs name ambiguity.** The roadmap body says `milestone: <name>`, but files are keyed by slug and `draftMilestone` writes `name: <slug>` (`src/milestones/lib.ts:73`) — so name==slug today. Storing the slug (filename stem) keeps it consistent with vision's `current-milestone:` and avoids a name→file lookup. See (D1).
- **`validate:triage` drift.** If the triage validator enforces a closed field set on roadmap blocks, the new `milestone` line would fail it. The spec calls for an explicit allow; missing this is the likeliest implementation trap.
- **Dashboard record threading.** The `milestone` chip on `/features` depends on `milestone` reaching the dashboard `FeatureRecord`. It rides along inside `frontmatter`, so no extra plumbing — but a test must lock this so a future record-narrowing refactor doesn't silently drop it.
- **Low blast radius overall** — additive optional field + one detector + one read-only page + skill-doc edits; no state-machine or release-marker changes.

## User Story

As an operator running a milestone-planned Noldor project, I want each feature to optionally declare which milestone it belongs to and to see that membership surfaced in triage, garden, and the dashboard, so that I can tell at a glance whether a milestone is truly shipped or still has open features — without the framework forcing milestones on projects that grow organically.

## Usage

**Declare membership** — add `milestone: mvp` to an FD's frontmatter (or let `/promote` copy it from a triaged roadmap block). The slug must match a `docs/milestones/<slug>.md` file.

**Triage** — `/triage` proposes `- milestone: <active-slug>` per roadmap bullet when an active milestone is set; override or drop per row. `/promote` lifts the line into the FD.

**Garden** — `pnpm garden:detect` flags any feature whose milestone is `status: shipped` but `phase != done`.

**Dashboard** — open `/milestones` (nav: **Milestones**) for milestones grouped by status with member-feature roll-ups; the `/features` list shows a milestone chip per feature. Empty-state shown when no milestones exist.

**Manage milestones** — unchanged: `/milestone draft|activate|edit|list` (see `docs/noldor/milestones.md`).

**Keyboard shortcut** — _none._
**Agent API** — _none; operates through FD frontmatter, `pnpm` scripts, and the dashboard HTTP routes._

## Open questions (resolved)

1. _Does the FD `milestone:` field store the milestone slug or its `name`?_ -> **Slug (filename stem).** Vision's `current-milestone:` already stores the slug and `draftMilestone` sets `name == slug`, so slug is the unambiguous key and needs no name→file resolution (D1).
2. _Is a dangling `milestone:` reference a hard error or a soft warning?_ -> **Hard error in `validate:features` (pre-commit).** Consistent with Noldor's strict-frontmatter posture; the dashboard already treats a missing milestone file as a problem state (`views.ts:346`). The field stays fully optional — the check only fires when it is present (D2).
3. _Should the garden detector also flag `phase: done` features whose milestone is NOT shipped?_ -> **No — only the shipped-milestone-with-open-feature case.** That is the drift the roadmap body names and the one that signals a falsely-declared "shipped". The inverse is normal (features finish before their milestone ships) and would be noise (D3).
4. _Dedicated `/milestones` page, or fold into `/features` / `/vision`?_ -> **Dedicated `/milestones` page plus a milestone chip on `/features`.** A dedicated page gives the status-grouped roll-up room to breathe and a stable nav target; the chip keeps the connection visible where operators already scan features. `/vision` keeps only the single active-milestone banner it has today (D4).
5. _When should `/triage` propose a milestone line?_ -> **Only when an active milestone is set AND the bullet aligns with its `## Gate`; otherwise omit.** Never infer from score; mirror the existing "optional line, operator overrides" treatment of `confidence`/`deps` so no-milestone projects see no change (D5).
