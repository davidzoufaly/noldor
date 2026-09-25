# Milestone Membership Has No Tagger and No Counter — Design

**Slug:** milestone-membership-has-no-tagger-and-no-counter
**FD:** docs/features/milestone-membership-has-no-tagger-and-no-counter.md
**Date:** 2026-09-25
**Tier:** specs-only

## Problem

A milestone's membership is declared in two places: `- milestone: <slug>` on a roadmap/backlog block (`BacklogEntry.milestone`, `src/utils/parse-blocks.ts`) and `milestone: <slug>` in a feature MD's frontmatter. `buildMilestoneGroupBases` (`src/milestones/lib.ts`) reads both, and `renderMilestoneShow` prints `Features (<done>/<total> done)` and `Queued (<n>)` from them.

Nothing writes either field after the fact. `/noldor-triage` can set `- milestone:` when it files an entry, and `/noldor-promote` copies it onto the FD it scaffolds (step 6) or adopts it onto a parent (`features attach-milestone`). Everything filed before a milestone existed, or filed without one, stays untagged unless someone hand-edits the block or the frontmatter. And nothing reports the untagged work: `validate triage` catches a milestone slug that does not exist, but an entry with no `- milestone:` at all is invisible, so `milestones show <active>` under-reports with no hint that it does.

The entry's claim that the feature counter is "structurally always `0/0`" no longer holds: `doneCount` counts `phase: done` members, `phase-flip-done` sets that phase, and promote carries the milestone onto new FDs. In charuy today 11 FDs carry `milestone: public-release`. The counter reads `0/0` for a milestone only when none of its work has been promoted yet (charuy's active `real-materials`: 5 queued, 0 promoted), which is correct. What is missing on the feature side is the same thing as on the entry side: a way to tag an FD that was created untagged.

## Goals

- One command tags roadmap entries, backlog entries and feature MDs with a milestone, so fixing N untagged items is one call, not N hand edits.
- `milestones show` says how much live work carries no milestone, so the gap is visible from the command people already run.

## Non-goals

- No gate or promote change. Promote already carries the milestone onto the FD it creates.
- No new `validate triage` rule. A missing milestone is not an error: milestones are optional, and a repo with no active milestone must stay silent.
- No automatic tagging. Which milestone an entry belongs to is a judgment call; the tool writes what the operator names.
- No dashboard change.

## Design

### Structural context

`src/milestones/lib.ts` and `src/milestones/show-cli.ts` sit in community c35 with `src/milestones/cli.ts` and their tests, owned by `decouple-milestones-from-semver`. `show-cli.ts` is interior: no god node, no cross-community edge. `lib.ts` reaches out to `src/dashboard/data.ts` (c0), `src/core/fd-load.ts` (c14), `src/core/doc-roots.ts` (c41) and `src/utils/parse-blocks.ts` (c18). `parse-blocks.ts` defines `parseBacklog()`, god node rank #7 (38 edges). This change reads through `parseRoadmap`/`parseBacklog` and adds no edge into c18 that `lib.ts` does not already have; the new code stays inside c35.

### `milestones assign` — the tagger

`pnpm noldor milestones assign <milestone> <target>...` — a new sub under the existing `milestones` group in `src/cli/manifest.ts`, backed by `src/milestones/assign-cli.ts` over a pure core in `src/milestones/assign.ts`.

Each `<target>` is a slug or a `Q-NNNN` id. It resolves in this order: a roadmap block, then a backlog block (matched the way `has-block-cli.ts` matches), then `docs/features/<slug>.md` (FDs match by slug, or by their `entry-id:` for a `Q-NNNN`). A target that resolves nowhere is a refusal.

For a queue block, the tool writes a `- milestone: <milestone>` bullet as the last bullet of the block's field list. For an FD, it sets `milestone:` in the frontmatter via gray-matter, the same way `flipPhaseToDone` (`src/core/phase-flip-done.ts`) rewrites `phase:`.

Per target, the outcome is one of: `written` (had none), `noop` (already names this milestone), `conflict` (names a different one). A conflict refuses unless `--replace` is passed. This reuses the reasoning of `resolveAttachMilestone`: the tool does not silently drop a stated assignment.

The milestone must exist in `docs/milestones/` and must not be `shipped`. Writing work into a shipped milestone is exactly what `detectMilestoneShippedIncomplete` flags later.

**All-or-nothing.** Every target is resolved and judged before any file is written. If any target refuses, nothing is written and the command exits 1, listing every refusal. Exit 0 means every target is now `written` or `noop`; exit 2 is a usage error. It prints one line per target with its outcome.

Writing to `docs/roadmap.md` / `docs/backlog.md` from this command is a triage-flow write, the same class as `roadmap remove-block` and `triage backfill-ids`. The existing `validate triage` hook on those files still checks the result at commit time.

### Unassigned count in `milestones show`

`renderMilestoneShow` gains one trailing section:

```
Unassigned: 3 roadmap entries, 120 backlog entries, 1 in-progress feature carry no milestone
```

Counted, each as its own number: roadmap entries with no `- milestone:`, backlog entries with no `- milestone:`, and FDs with `phase: in-progress` and no `milestone:`. The backlog is a separate number, not folded into the roadmap one, so its size (128 entries in charuy) does not hide the live roadmap gap. `done` FDs are not counted, because shipped history is not live work. The count is computed by a pure `countUnassigned(features, roadmapEntries, backlogEntries)` in `lib.ts` so it is unit-testable. When every count is zero, the line still prints, so "zero" is a stated fact and not an absence.

### Error handling

A malformed roadmap/backlog/FD file surfaces the parser's own error and exits 1 before any write. Slugs go through `resolveSlugPath` like every other milestone command, so a traversal attempt is a refusal, not a write.

### Testing

Unit tests for `assign.ts`: block bullet insertion, noop, conflict, `--replace`, FD frontmatter write, all-or-nothing refusal, unknown and shipped milestone. Unit test for `countUnassigned`. A `show.test.ts` case for the new line. Tests run in temp dirs, like `src/milestones/__tests__/show.test.ts` already does.

UI verdict: skip — the repo configures no `uiPaths`, and this is CLI-only.
Architecture verdict: skip — new files live inside the existing `src/milestones` module; no new directory, package, external or cross-module import.

## Acceptance criteria

- `milestones assign <m> <slug>` on an untagged roadmap entry adds `- milestone: <m>` to that block; `parseRoadmap` then reads `milestone === <m>` and `validate triage` stays green.
- The same works for a backlog entry, for a `Q-NNNN` id, and for a feature MD (frontmatter `milestone:` set; `validate features` stays green).
- Re-running the same assign changes no file and exits 0.
- A target already tagged with a different milestone exits 1 and changes no file; with `--replace` it is rewritten.
- An unknown target, an unknown milestone, or a `shipped` milestone exits 1.
- With several targets and one refusal, no file is written.
- After tagging an FD, `milestones show <m>` counts it under `Features`, and flipping it to `done` raises the done count.
- `milestones show <m>` prints the number of untagged roadmap entries, untagged backlog entries and untagged in-progress FDs as separate counts, including when all are zero.

## Risks / trade-offs

- **Formatting churn on FDs.** gray-matter re-serializes the whole frontmatter. `flipPhaseToDone` already accepts this, so FDs are used to it; the diff may still reorder or re-quote a line.
- **Roadmap is queue state.** A command that writes it widens who edits it. It is limited to one bullet per named block, and every write is operator-named.
- **The backlog count is large.** In a repo with a big parking lot the backlog number will dwarf the others. Accepted: it is a separate number, so the roadmap gap stays readable.

## User Story

As an operator (human or agent) running a milestone, I want to tag queued entries and features with the milestone in one command, and see how much live work is still untagged, so that `milestones show` tells me how far through the milestone I really am.

## Usage

```
pnpm noldor milestones assign real-materials Q-0101 Q-0102 build-section-phases
pnpm noldor milestones assign public-release some-fd --replace
pnpm noldor milestones show real-materials
```

`assign` prints one line per target (`written` / `noop` / `conflict`), exits 0 when every target is tagged, 1 when any target refused (nothing written), 2 on a usage error. `show` ends with the untagged count.

## Open questions (resolved)

1. *Should `assign` also offer an `--unassign`?* -> No, not in this slice. (D1) No one has asked for it, and removing one bullet by hand is easy.
2. *Should the unassigned count also land in the sdd-report or garden?* -> No. (D2) `show` is where people look when they ask about a milestone; a garden row would fire in every repo that uses no milestones.
3. *Should the gate stamp the milestone onto the FD at attach time, as the entry proposed?* -> No. (D3) `/noldor-promote` already does this (step 6 on scaffold, `attach-milestone` on attach).
