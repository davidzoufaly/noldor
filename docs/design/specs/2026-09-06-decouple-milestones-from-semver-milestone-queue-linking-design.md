# Milestone-Queue Linking — Design

**Slug:** milestone-queue-linking
**FD:** docs/features/decouple-milestones-from-semver.md
**Date:** 2026-09-06
**Tier:** specs-only
**Deps:** none

## Problem

A milestone is a strategic gate with a doc at `docs/milestones/<slug>.md` and a lifecycle
(`draft → active → shipped`, `src/milestones/lib.ts`). The queue is `docs/roadmap.md` and
`docs/backlog.md`, parsed into `BacklogEntry` by `src/utils/parse-blocks.ts`. Today the two
surfaces meet in exactly one place: a **feature MD** may declare `milestone: <slug>` in its
frontmatter, `validateMilestoneRef` in `src/features/validate-features.ts:298` checks that it
resolves, and `buildMilestoneGroups` in `src/dashboard/data.ts:860` groups features under
their milestone with a `doneCount / total` roll-up.

Everything before promotion is invisible to that link. A roadmap or backlog entry cannot say
which milestone it belongs to — `FIELD_KEYS` in `src/utils/parse-blocks.ts:243` has no
`milestone` key, so the bullet is silently swallowed into the entry's description. The
practical consequence is that a milestone's progress reflects only work already promoted to an
FD, which is the tail end of the pipeline; the queue that decides whether the milestone can
ship at all is unrepresented. `/noldor-promote` step 6 already instructs the writer to copy a
`- milestone:` bullet from the source block into the new FD's frontmatter, so the prose
contract exists and the parser does not honour it.

The gate compounds this. `getSuggestions` in `src/core/next-priority.ts:156` surfaces a
`milestoneAligned` bucket, and with no field to read it picks its candidate by bag-of-words
overlap against the milestone's `## Gate` paragraph — a guess standing in for a declaration
the schema cannot express.

The operator restated the requirement on 2026-08-24 as bidirectional across all three
surfaces: a milestone doc should be able to enumerate its queue, and each queue surface should
be able to name its milestone.

## Goals

- A roadmap or backlog entry can declare `- milestone: <slug>` and have it parsed, validated
  and carried through promotion into the FD.
- A milestone's roll-up accounts for unpromoted queue entries as well as feature MDs, so
  milestone progress reflects the whole pipeline rather than its tail.
- A milestone's membership is enumerable from the CLI and the dashboard without the operator
  hand-maintaining a list.
- A dangling `milestone:` reference on a queue entry is caught by `validate triage` the same
  way `validate features` already catches it on an FD.
- The gate's `milestoneAligned` bucket honours a stated membership in preference to guessing
  one.

## Non-goals

- No change to the milestone lifecycle (`draft/active/shipped`), to `activateMilestone`, or to
  `docs/vision.md`'s `current-milestone` pointer.
- No milestone term in the `pnpm noldor triage score` formula. The gate's bucketing changes
  (Unit 6); the score does not.
- No milestone membership stored inside the milestone doc, hand-written or generated (D1).
- No release/semver coupling. That is the parent FD's settled decision and stays settled.
- No collapse of the `parse-blocks.ts` field fan-out — that belongs to Q-0113 (D5).

## Design

### Structural context

Read from `pnpm noldor design graph-context` over the parent FD's `links.code`
(`src/milestones/cli.ts`, `lib.ts`, `validate-milestones.ts`) plus the files this change
actually opens.

- `src/milestones/lib.ts` and `src/milestones/cli.ts` sit in community **c57**, alongside
  `src/core/atomic-write.ts` and the milestone tests. Neither defines a god node. `lib.ts`
  carries cross-community edges out to `src/dashboard/data.ts` (c9) and to the slug-guard
  cluster (`slug-paths.ts`, `resolveSlugPath()`, `readFileNoFollow()`, c18); `cli.ts` is an
  interior file with no god nodes and no cross-community edges, which is why adding a
  subcommand there is structurally cheap.
- `src/milestones/validate-milestones.ts` sits alone in **c147** with its own test, reaching
  back into c57 via one `imports_from` edge on `lib.ts`.
- `src/utils/parse-blocks.ts` sits in community **c45** and **defines a god node**:
  `parseBacklog()`, rank **#7**, 28 edges. Its cross-community edges run to
  `src/dashboard/data.ts` (c9), `src/garden/garden-detect.ts` (c27), `src/dashboard/views.ts`
  (c10), `src/sdd/sdd-report.ts` (c12) and `src/prep/prep-promote.ts` (c52).

The god-node rank is the finding that shapes this design. `BacklogEntry` is read by a wide
consumer set, so widening the *type* is cheap and widening the *behaviour* is not: every
consumer above keeps compiling against an added optional field, but any consumer that starts
branching on `milestone` becomes a new edge across those community boundaries. The design
therefore concentrates new behaviour in three consumers only — `src/dashboard/data.ts` (c9),
`src/core/next-priority.ts`, and the triage validator — and leaves the other god-node
neighbours reading the entry exactly as they do today.

### Unit 1 — the milestone field on the queue parser

`src/utils/parse-blocks.ts` documents its own fan-out at line 226: adding a schema-C key
requires four coordinated edits (`FIELD_KEYS`, `parseBlockBody`, `parseRoadmap`'s `flush()`,
`parseEntries`) plus the `BacklogEntry` interface itself — five sites. This unit performs
exactly that fan-out for `milestone`, carrying the value as an optional `string` with no
parsing beyond trim, matching how `size`, `impact` and `parent` are already handled (validated
downstream, parser accepts any string).

Both parser paths must be covered. `parseRoadmap` harvests fields through `parseBlockBody` and
maps them in `flush()`; `parseEntries` (the backlog path) builds its own `fields` record and
entry literal. A key added to `FIELD_KEYS` alone is stripped from the description and then
silently dropped, which is the specific failure the file's own comment warns about.

The existing `noldor:cut` at line 235 defers collapsing the fan-out to Q-0113
("Queue-Document Grammar Module"). This change adds the sixth key and leaves the cut in place,
correcting its "two in the schema's lifetime" count.

### Unit 2 — validation of the reference

`validate triage` gains a cross-check mirroring `validateMilestoneRef`
(`src/features/validate-features.ts:298`): when an entry declares `- milestone: <slug>`, a
matching `docs/milestones/<slug>.md` must exist. The check is skipped entirely when the repo
has no `docs/milestones/` directory — milestones are optional, and the framework must stay
green in a repo that never adopts them. Severity mirrors the FD side: hard error when the
directory exists, silent when it does not.

The slug goes through the same `parseSlug` / `milestonePath` choke point the FD check uses, so
a traversal-shaped value is refused before any path is built rather than joined into one.

### Unit 3 — the roll-up counts the queue

`buildMilestoneGroups` (`src/dashboard/data.ts:860`) currently takes `(milestones, features)`
and computes `doneCount / total` over features alone. This unit widens it to
`(milestones, features, entries)`, where `entries` is the parsed roadmap + backlog list.

Queue members are reported **separately**, never folded into the feature ratio. A queue entry
carries no `phase`, so counting it as "not done" asserts a completion state that was never
recorded; worse, a combined percentage falls every time work is triaged into the milestone, so
the number reads as regression exactly when the milestone is growing. Concretely: `doneCount`
and `total` keep their present meaning and their present consumers, and the group gains
`queuedCount` plus a `queued: BacklogEntry[]` member list.

`MilestoneGroup.incomplete` keeps its current trigger (shipped with a non-done feature) and
gains a second: a milestone cannot honestly be `shipped` while queue entries still name it.

### Unit 4 — enumerating a milestone's queue

The reverse direction is served as a **derived view, not stored state**. The milestone doc is
untouched and `milestoneFrontmatterSchema` (`src/milestones/lib.ts:18`) stays `.strict()`.
Enumeration comes from two surfaces:

- CLI: a new `pnpm noldor milestones show <slug>` in `src/milestones/cli.ts`, printing the
  milestone's features (by FD `milestone:`) and its queue entries (by entry `milestone:`),
  grouped by phase and by source file. It reuses the Unit 3 grouping and only formats it, the
  way `milestones list` already formats `listMilestones()`.
- Dashboard: the existing `/milestones` page (`src/dashboard/views.ts:366`) renders the
  `queued` list beneath the existing member list.

The CLI is kept rather than deferred to the dashboard because it is the only enumeration
surface readable without booting a server: a headless drain, a CI job or an agent has no other
way to see a milestone's queue (D4).

Two storing alternatives were considered and rejected. A hand-written list of entry IDs inside
the milestone doc goes stale the first time an entry is retired. A *generated* write-back
block — a `<!-- @milestone-queue: <slug> -->` marker filled by a projection runner, the shape
`@prs-since-last-release` already uses on FDs — keeps the doc self-contained when read on
GitHub, but buys that with a new projection runner, a freshness check and a drift gate; it is
the right shape only if reading the doc outside the tooling becomes a real requirement. The
forward `milestone:` field is written once by the operator who already knows the answer, and
nothing else has to stay in sync with it (D1).

### Unit 5 — carry-through at promotion

`/noldor-promote` step 6 already specifies copying `- milestone:` into FD frontmatter; with
Unit 1 the value is finally readable, so this is a wiring-and-test change rather than new
design: the promote path reads `entry.milestone`, and the no-FD paths (fast-track retirement,
attach) must not silently drop it. `.noldor/retired-entry-ids.json` already records where a
retired entry went, so an attached entry's milestone survives through its parent FD.

The sibling-emission recipe shared by `/noldor-promote` steps 1.7 and 6.5 carries `milestone:`
onto split and residue blocks verbatim, alongside `area` and `type` — a slice of milestone
work is still milestone work.

### Unit 6 — the gate honours a stated membership

`getSuggestions` (`src/core/next-priority.ts:156`) picks `milestoneAligned` via
`findMilestoneMatch`, a bag-of-words overlap against the active milestone's `## Gate`
paragraph. This unit puts the explicit field first: among entries not already in
`topPriority ∪ smallHighImpact`, an entry whose `milestone` names the active milestone wins;
the overlap heuristic runs only when no such entry exists.

Ordering matters and is the whole point of the unit. A declaration is ground truth and an
overlap score is a guess, so ranking the guess first lets a coincidental word match outrank a
stated membership. Keeping overlap as the fallback preserves today's behaviour exactly for
repos that never adopt the field, so the change is additive for every existing consumer.

The bucket's other rules are unchanged: at most one entry, disjoint from the two buckets above
it, `null` when nothing qualifies.

## Acceptance criteria

1. A roadmap block carrying `- milestone: foo` parses to `BacklogEntry.milestone === 'foo'`,
   and the bullet does not appear in the entry's `description`.
2. The same holds via `parseBacklog` for a backlog block, and an entry with no `- milestone:`
   bullet parses to `milestone === undefined` on both paths.
3. `validate triage` exits non-zero and names the entry when `- milestone: nope` resolves to no
   file under `docs/milestones/`.
4. `validate triage` exits zero on a repo whose entries carry `- milestone:` and which has no
   `docs/milestones/` directory at all.
5. `validate triage` refuses a traversal-shaped milestone value without reading outside the
   repo.
6. `buildMilestoneGroups` reports a milestone's queue entries in a member list distinct from
   its feature members, and its feature `doneCount` / `total` are unchanged by the presence of
   queue entries.
7. A milestone with `status: shipped` and at least one queue entry naming it is reported
   incomplete.
8. `pnpm noldor milestones show <slug>` exits zero and lists both the features and the queue
   entries that name the milestone.
9. `pnpm noldor milestones show <unknown-slug>` exits non-zero with a message naming the slug.
10. Promoting an entry that carries `- milestone: foo` produces an FD whose frontmatter carries
    `milestone: foo`.
11. `getSuggestions` returns, as `milestoneAligned`, an entry declaring the active milestone in
    preference to a higher-word-overlap entry that declares none.
12. `getSuggestions` falls back to the existing word-overlap pick when no eligible entry
    declares a milestone, and still returns `null` when the gate text is empty.
13. `pnpm noldor validate features`, `pnpm noldor triage validate` and `validate milestones`
    are green on this repo, which has no `docs/milestones/` directory.

## Risks / trade-offs

- **God-node blast radius.** `parseBacklog()` is rank #7 with 28 edges, the most-read type in
  the queue layer. Widening `BacklogEntry` is additive and source-compatible; the mitigation is
  that only three consumers read the new field.
- **The five-site fan-out is a known defect.** Adding the key makes the duplication worse
  before Q-0113 makes it better. Doing the grammar-module extraction first would turn this M
  into an L and block the linking work behind a parser rewrite.
- **Two-way link, one-way storage.** Deriving membership means a milestone doc read in
  isolation — on GitHub, say — still does not list its queue. The trade is no sync drift, which
  is what a stored list guarantees.
- **This repo has no `docs/milestones/`.** Every path added here is exercised by fixtures and
  by consumer repos only, so the tests carry the whole weight of the change and the
  directory-absent branches need explicit coverage (criteria 4 and 13).
- **Roll-up honesty costs display space.** Keeping the counters separate avoids the inverted
  progress signal but makes the `/milestones` row and the CLI output busier than a single
  percentage would be.
- **Unit 6 changes what the gate offers.** A repo that starts declaring `milestone:` will see
  different `milestoneAligned` picks than before. That is the intent, but it is a behaviour
  change to an operator-facing surface, not a pure addition.

## User Story

- As a Noldor operator, I want a roadmap or backlog entry to declare the milestone it belongs
  to, so that a milestone's progress reflects the work still queued and not only the work
  already promoted to a feature doc.
- As an agent planning a milestone, I want one command that enumerates every feature and queue
  entry naming a milestone, so that I can judge whether the gate is reachable without reading
  three files by hand.

## Usage

Declare the link on a queue entry, in `docs/roadmap.md` or `docs/backlog.md`:

```markdown
### Some Entry

- id: Q-0210
- area: tooling
- type: feat
- since: 2026-09-06
- size: S
- impact: med
- milestone: public-beta
```

Then:

- `pnpm noldor triage validate` — fails when `public-beta` has no file under
  `docs/milestones/`; silent in a repo with no milestones at all.
- `pnpm noldor milestones show public-beta` — prints the milestone's features and its queue.
- `pnpm noldor milestones list` — unchanged.
- Dashboard `/milestones` — each milestone row gains its queued entries beneath its features.
- `/noldor-promote <slug>` — carries `- milestone:` into the new FD's `milestone:` frontmatter.
- `/noldor-gate` Step 0 — the `[milestone]` bucket now offers an entry that declares the active
  milestone, ahead of the word-overlap guess.

## Open questions (resolved)

1. *Should the milestone doc store its member list, or should membership be derived from the
   entries and FDs that name it?*
   -> **Derive it** (D1). A stored list needs a writer on every triage, promote, retire and
   split path and goes stale the moment one is missed; the forward `milestone:` field is
   written once by the operator who already knows the answer.

2. *Should queue entries and features share one completion counter?*
   -> **No, keep them separate** (D2). A queue entry has no recorded phase, and a single
   percentage falls whenever work is triaged into the milestone — the signal inverts precisely
   when the milestone is growing.

3. *Should `validate triage` treat a dangling `milestone:` as an error or an advisory?*
   -> **Error, but only when `docs/milestones/` exists** (D3). This mirrors
   `validateMilestoneRef` on the FD side exactly, and the directory guard is what keeps
   milestone tracking optional.

4. *Is the `milestones show` CLI worth its unit, given the dashboard already renders
   membership?*
   -> **Yes, keep it** (D4). It reuses the Unit 3 grouping and only formats it, and it is the
   only enumeration surface readable without booting the dashboard server.

5. *Should this change also collapse the five-site field fan-out in `parse-blocks.ts`?*
   -> **No** (D5). Q-0113 owns that refactor and the canonical field vocabulary; folding it in
   couples a linking feature to a parser rewrite.

6. *Should a residue or split sibling block inherit `milestone:`?*
   -> **Yes, carried verbatim** (D6). A slice of milestone work is still milestone work, and
   the sibling-emission recipe already copies `area` and `type` the same way.

7. *Should the gate's `milestoneAligned` bucket read the new field?*
   -> **Yes, and it outranks the overlap heuristic** (D7). A declaration is ground truth and an
   overlap score is a guess; overlap stays as the fallback so repos that never adopt the field
   keep today's behaviour.
