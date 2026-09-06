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
- No manifest wiring for `milestones draft` / `activate` / `list`, and no fix for the adjacent
  defect that `tsx src/milestones/cli.ts` cannot resolve in an installed consumer repo. Both
  are real and both are wider than this feature; only `show` is wired here (Unit 4).

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
branching on `milestone` becomes a new edge across those community boundaries.

Five consumers read the new field, and the list is exhaustive by design:
`src/dashboard/data.ts` (c9, Unit 3), `src/core/next-priority.ts` (Unit 6), the triage
validator (Unit 2), `src/prep/scaffold.ts` (Unit 5 — it writes the FD frontmatter key that
`validateMilestoneRef` already reads), and `src/garden/detectors/milestone-shipped-incomplete.ts`
(Unit 3's invariant owner). Every other god-node neighbour — `garden-detect.ts`,
`dashboard/views.ts`, `sdd-report.ts`, `prep-promote.ts` — keeps reading the entry exactly as
it does today. Unit 4's `src/milestones/cli.ts` and `src/cli/manifest.ts` edits are surface
wiring rather than new branching on the field: the CLI renders the Unit 3 grouping.

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

`validate triage` gains a cross-check reusing the exact shape of `validateMilestoneRef`
(`src/features/validate-features.ts:294-310`). It is two checks, not one, and they have
different trigger conditions:

- **Syntax.** `parseSlug(entry.milestone)` then `milestonePath(cwd, slug)`. Runs whenever the
  field is present, unconditionally — a traversal-shaped or otherwise malformed value is
  refused before any path is built, in a repo with a `docs/milestones/` directory and in one
  without.
- **Existence.** `existsSync(built.path)`. Also runs whenever the field is present, and hard-
  errors when the file is absent.

**There is no directory guard, on either side.** An earlier draft of this unit proposed
skipping the whole check when `docs/milestones/` is absent, and claimed that mirrored the FD
side. It does not: `validateMilestoneRef` has no such guard and hard-errors on any missing
file, so an FD carrying `milestone: foo` in a repo with no milestones directory errors today.
Adding a guard to the queue side alone would make identical input error on an FD and pass on
an entry.

Milestones stay optional through *absence of the field*, not through a guard: an entry that
declares no `- milestone:` bullet is never checked, which is every entry in every repo that
does not use milestones. Declaring a milestone that does not exist is an error, and it should
be — it is a dangling reference either way.

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

**`MilestoneGroup.incomplete` is not widened here.** "A shipped milestone still has open work"
is an invariant that already has an owner: `detectMilestoneShippedIncomplete`
(`src/garden/detectors/milestone-shipped-incomplete.ts`, wired at
`src/garden/garden-detect.ts:28`), which walks `docs/features/*.md` and flags a non-`done`
feature under a `shipped` milestone. `MilestoneGroup.incomplete` (`src/dashboard/data.ts:875`)
is the dashboard's local restatement of the same rule.

Adding a queue trigger to the dashboard flag alone would leave the two disagreeing: garden
would call a milestone clean while the dashboard called it incomplete, for the same repo. So
the queue case is added **to the detector**, which becomes the single definition — a `shipped`
milestone named by any live roadmap or backlog entry is flagged, with a finding `reason`
distinct from the feature case so the two are still tellable apart. `MilestoneGroup.incomplete`
keeps exactly its present meaning and its present consumers, and the dashboard surfaces the
queue as `queuedCount` / `queued` rather than as a second definition of "incomplete".

### Unit 4 — enumerating a milestone's queue

The reverse direction is served as a **derived view, not stored state**. The milestone doc is
untouched and `milestoneFrontmatterSchema` (`src/milestones/lib.ts:18`) stays `.strict()`.
Enumeration comes from two surfaces:

- CLI: a new `pnpm noldor milestones show <slug>`, printing the milestone's features (by FD
  `milestone:`) and its queue entries (by entry `milestone:`), grouped by phase and by source
  file. It reuses the Unit 3 grouping and only formats it, the way `fmtGroup` in
  `src/milestones/cli.ts` already formats `listMilestones()`.

  **`src/milestones/cli.ts` is not reachable through `pnpm noldor` today.** The `milestones`
  group in `src/cli/manifest.ts:250-254` exposes exactly one sub — `validate`, pointing at
  `src/milestones/validate-milestones.ts`. `draft`, `activate` and `list` are invoked only as
  `tsx src/milestones/cli.ts <cmd>` by the `/noldor-milestone` skill, so
  `pnpm noldor milestones list` exits 1 with `Unknown subcommand` today, and
  `docs/noldor/script-catalog.md:179` carries a row for the validator alone. This unit
  therefore lands three edits, not one:

  1. `src/milestones/cli.ts` — the `show` subcommand itself.
  2. `src/cli/manifest.ts` — a `show` entry under the `milestones` group, pointing at
     `milestones/cli.ts`. Without it the command is unreachable.
  3. `docs/noldor/script-catalog.md` — a row for `pnpm noldor milestones show`, or
     `pnpm noldor validate script-catalog` reds on the new manifest entry.

  Wiring `draft` / `activate` / `list` into the manifest is **out of scope**, and so is the
  adjacent defect it exposes: `tsx src/milestones/cli.ts` has no `src/` to resolve in an
  installed consumer repo, so those three skill commands cannot work outside this checkout.
  That is a real bug with a wider blast radius than this feature and belongs in its own entry.
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

`/noldor-promote` step 6 already specifies copying `- milestone:` into FD frontmatter, but the
FD writer has no such key. `scaffoldFd` (`src/prep/scaffold.ts:83-93`) builds its frontmatter
record from `area`, `category`, `deps`, `links`, `name`, `packages`, `phase` and
`noldor-tier` — nothing else. So this unit is a code change, not prose alone: `scaffoldFd`
sets `milestone` from `entry.milestone` when the entry carries one and omits the key otherwise
(the FD schema already accepts `milestone`, which is what `validateMilestoneRef` reads). That
is what makes the promotion criterion machine-testable rather than a claim about skill prose.

An entry leaves the queue by one of three paths, and each needs a stated destination —
otherwise "membership follows the work" holds only on the path that happens to have an FD.

- **Promote to a new FD.** `scaffoldFd` writes `milestone:` as above. The assignment survives
  verbatim.
- **Attach to an existing parent FD.** The parent's frontmatter governs, because the parent is
  where the work now lives. Three cases: the parent declares the same milestone (no-op); the
  parent declares none (the attach writes the entry's milestone onto the parent FD, since
  nothing is being overwritten); the parent declares a *different* milestone (a conflict the
  tooling must not resolve silently — `/noldor-promote`'s attach branch surfaces both values
  and stops, leaving the source block in place for the operator to re-file or re-assign).
  Refusing here is deliberate: the alternative is either dropping a stated assignment or
  rewriting an unrelated feature's milestone, and both are worse than a stop.
- **Fast-track retirement.** No FD is ever created, so nothing carries the field forward.
  `roadmap remove-block` records `milestone` in `.noldor/retired-entry-ids.json` alongside the
  ID it already records, which keeps the assignment auditable — but the roll-up does not read
  it. A retired entry has shipped and therefore left the queue; counting it would resurrect
  completed work into a "queued" list. This is the one path where membership genuinely ends at
  retirement, and saying so is the point.

The sibling-emission recipe shared by `/noldor-promote` steps 1.7 and 6.5 carries `milestone:`
onto split and residue blocks verbatim, alongside `area` and `type` — a slice of milestone
work is still milestone work.

### Unit 6 — the gate honours a stated membership

`getSuggestions` (`src/core/next-priority.ts:156`) picks `milestoneAligned` via
`findMilestoneMatch`, a bag-of-words overlap against the active milestone's `## Gate`
paragraph. This unit puts the explicit field first. The bucket becomes two branches over
entries not already in `topPriority ∪ smallHighImpact`:

1. **Declared.** Entries whose `milestone` equals the active slug. First in file order (which
   is priority) wins.
2. **Fallback — overlap.** Only when branch 1 yields nothing.

Three rules the earlier draft left unstated, each of which decides real cases:

- **The empty-gate short-circuit moves.** Today `getSuggestions:156-159` returns `null` before
  matching whenever `milestoneGate` is empty. Left there, a milestone whose `## Gate`
  paragraph is blank or deleted would suppress an *explicit* declaration — the exact
  guess-beats-declaration inversion this unit exists to remove. The short-circuit therefore
  guards branch 2 only. Branch 1 depends on the active slug, never on the gate text.
- **Branch 1 ignores the impact filter.** `findMilestoneMatch` skips any entry that is not
  `high` or `critical` impact (`src/core/next-priority.ts:199`). That filter exists to stop a
  *guess* surfacing trivia; a declaration is not a guess, so a declared `impact: low` entry is
  eligible. Branch 2 keeps the filter unchanged.
- **Branch 2 excludes entries declared elsewhere.** An entry carrying
  `milestone: <some-other-slug>` is skipped by the overlap fallback entirely. Without this,
  the fallback can surface an entry whose own frontmatter says it belongs to a different
  milestone purely because its wording overlaps — a declaration losing to a word count, which
  is what the unit forbids. Entries with no `milestone` at all remain fully eligible for
  branch 2; that is today's behaviour and the reason the fallback still exists.

**The active slug is not currently available at that call site, and plumbing it is part of
this unit.** `SuggestionsInput` (`src/core/next-priority.ts:98-101`) carries
`{ inProgressFds, milestoneGate: string }`, and `milestoneGate` is the `## Gate` *paragraph
text* produced by `loadMilestoneGate` (`src/core/next-priority.ts:267-302`) — the slug is
resolved inside that helper and discarded. Matching `entry.milestone === activeSlug` therefore
requires four coordinated edits:

1. `SuggestionsInput` gains `activeMilestone: string | null`.
2. `loadMilestoneGate` returns the resolved slug alongside the gate text instead of dropping
   it (or a sibling helper exposes it).
3. `getSuggestions` passes it into the milestone-match step.
4. The `src/autonomous/drain-source.ts:247` caller is updated for the widened input.

A `null` active slug — no active milestone, or an unresolvable `current-milestone` — means the
declaration branch is skipped and behaviour is exactly today's.

Ordering matters and is the whole point of the unit. A declaration is ground truth and an
overlap score is a guess, so ranking the guess first lets a coincidental word match outrank a
stated membership. In a repo that never adopts the field, branch 1 is always empty and branch 2
behaves exactly as today, so the change is additive for every existing consumer.

The bucket's remaining rules are unchanged: at most one entry, disjoint from the two buckets
above it, `null` when neither branch qualifies.

## Acceptance criteria

1. A block carrying `- milestone: foo` parses to `BacklogEntry.milestone === 'foo'` on both
   parser paths (`parseRoadmap` and `parseBacklog`), and the bullet does not appear in the
   entry's `description`.
2. An entry with no `- milestone:` bullet parses to `milestone === undefined` on both paths.
3. `validate triage` exits non-zero and names the entry when `- milestone: nope` resolves to no
   file, and does so identically whether or not `docs/milestones/` exists — matching what
   `validateMilestoneRef` already does for the same value on an FD.
4. `validate triage` exits zero on a repo with no `docs/milestones/` directory whose entries
   declare no milestone.
5. `validate triage` refuses a traversal-shaped milestone value without reading outside the
   repo, with and without a `docs/milestones/` directory present.
6. `buildMilestoneGroups` reports a milestone's queue entries in a member list distinct from
   its feature members, and its feature `doneCount`, `total` and `incomplete` are all unchanged
   by the presence of queue entries.
7. `detectMilestoneShippedIncomplete` flags a `shipped` milestone named by a live roadmap or
   backlog entry, under a `reason` distinct from the open-feature case.
8. `pnpm noldor milestones show <slug>` exits zero and lists both the features and the queue
   entries that name the milestone; `pnpm noldor milestones show <unknown-slug>` exits non-zero
   naming the slug.
9. `pnpm noldor validate script-catalog` is green with the new `milestones show` manifest entry
   present.
10. `scaffoldFd` writes `milestone: foo` into the FD frontmatter for an entry carrying
    `- milestone: foo`, and omits the key entirely for an entry carrying none.
11. Attaching an entry that declares a milestone to a parent FD that declares none writes the
    milestone onto the parent FD.
12. Attaching an entry that declares a milestone to a parent FD declaring a *different* one
    stops with both values reported, and leaves the source block and the parent FD unchanged.
13. `roadmap remove-block` records the entry's milestone in `.noldor/retired-entry-ids.json`,
    and a retired entry does not appear in any milestone's `queued` list.
14. `getSuggestions` returns, as `milestoneAligned`, an entry declaring the active milestone in
    preference to a higher-word-overlap entry that declares none — including when the declaring
    entry's `impact` is `low`, and including when the milestone's gate text is empty.
15. `getSuggestions`'s overlap fallback never returns an entry declaring a milestone other than
    the active one, and returns `null` when the gate text is empty and no entry declares the
    active milestone.
16. `getSuggestions` behaviour is byte-identical to today's for a roadmap in which no entry
    declares a milestone.
17. `pnpm noldor validate features`, `pnpm noldor triage validate` and
    `pnpm noldor validate milestones` are green on this repo, which has no `docs/milestones/`
    directory.

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
  directory-absent branches need explicit coverage (criteria 3, 4, 5 and 17).
- **Roll-up honesty costs display space.** Keeping the counters separate avoids the inverted
  progress signal but makes the `/milestones` row and the CLI output busier than a single
  percentage would be.
- **Unit 6 changes what the gate offers.** A repo that starts declaring `milestone:` will see
  different `milestoneAligned` picks than before. That is the intent, but it is a behaviour
  change to an operator-facing surface, not a pure addition — and the impact-filter bypass in
  branch 1 means a `low`-impact entry can now reach a bucket it previously could not.
- **The conflicting-attach stop is a new refusal.** A promotion that would previously have
  completed now halts when the entry and its parent FD name different milestones. That is the
  honest outcome, but it is an added failure mode on an existing path, and an operator hitting
  it mid-drain gets no automatic remedy.
- **Unit 4 touches the CLI manifest.** Adding the first non-validator sub to the `milestones`
  group makes an unreachable file reachable, which means `src/milestones/cli.ts` starts being
  exercised by `pnpm noldor` for the first time. Anything already broken in that file surfaces
  now rather than later.

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

- `pnpm noldor triage validate` — fails when `public-beta` resolves to no file under
  `docs/milestones/`, exactly as an FD declaring the same milestone already fails. Declaring no
  milestone is what keeps a repo without milestones green, not the absence of the directory.
- `pnpm noldor milestones show public-beta` — prints the milestone's features and its queue.
- Dashboard `/milestones` — each milestone row gains its queued entries beneath its features.
- `/noldor-promote <slug>` — carries `- milestone:` into the new FD's `milestone:` frontmatter;
  on an attach it writes the milestone onto a parent that has none, and stops when the parent
  names a different one.
- `/noldor-gate` Step 0 — the `[milestone]` bucket now offers an entry that declares the active
  milestone, ahead of the word-overlap guess.

`pnpm noldor milestones list` is *not* part of this. It does not work today — the `milestones`
manifest group exposes only `validate` — and wiring it is out of scope (Non-goals).

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

3. *Should `validate triage` treat a dangling `milestone:` as an error or an advisory, and
   should it be guarded on `docs/milestones/` existing?*
   -> **Hard error, no directory guard** (D3). `validateMilestoneRef` has none, so a guard on
   the queue side alone would make identical input error on an FD and pass on an entry.
   Optionality comes from not writing the field, which is every entry in a repo that does not
   use milestones.

3a. *Should slug-syntax and reference-existence be one check or two?*
   -> **Two, with the same trigger** (D3a). Both run whenever the field is present, so a
   traversal-shaped value is refused in every repo rather than only in one that happens to have
   a milestones directory.

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

8. *Does the declaration branch inherit the `high`/`critical` impact filter and the empty-gate
   short-circuit that guard the overlap heuristic today?*
   -> **Neither** (D8). Both exist to stop a *guess* surfacing the wrong entry. A declaration is
   not a guess, so a declared `low`-impact entry is eligible and an empty `## Gate` paragraph no
   longer suppresses the bucket. Both guards stay on the fallback branch unchanged.

9. *Can the overlap fallback pick an entry that declares a different milestone?*
   -> **No, those are excluded** (D9). Otherwise a stated membership loses to a word count,
   which is the inversion Unit 6 exists to remove. Entries declaring nothing stay eligible.

10. *Where does a milestone assignment go when an entry leaves the queue without an FD?*
    -> **Per path, stated explicitly** (D10). Promote writes it to the new FD; attach adopts it
    onto a parent that has none and *stops* when the parent names a different one; fast-track
    records it in `.noldor/retired-entry-ids.json` for audit and ends there, because the work
    has shipped and left the queue.

11. *Should Unit 3 widen `MilestoneGroup.incomplete` to cover queue entries?*
    -> **No — widen the garden detector instead** (D11). `detectMilestoneShippedIncomplete`
    already owns that invariant; adding a second trigger to the dashboard's local copy would
    let the two disagree about the same repo.
