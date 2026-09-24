# Co-Tag Detector: Mechanical `@tests:` Seeding — Design

**Slug:** sdd-co-tag-detector-degraded-honesty-seeding
**FD:** docs/features/sdd-co-tag-detector.md
**Date:** 2026-09-16 (re-scoped 2026-09-24)
**Tier:** specs-only
**Deps:** none

## Problem

The 13th SDD detector (`detectMissingCoTags`, [`src/garden/sdd-report.ts`](../../../src/garden/sdd-report.ts))
names the test files whose `// @tests:` tag omits an FD that owns a file they import. It
finds plenty: the committed `docs/sdd-report.md` on `main`, generated 2026-09-24, lists
**201** such rows. The count only grows — 139 when the roadmap entry was filed
(2026-08-23), 181 on 2026-09-06, 183 on 2026-09-16, 201 now — because closing
`links.code` gaps manufactures co-tag obligations for every test importing the newly-owned
file.

Nothing drains it. The report's remedy is a by-hand audit, file by file, which nobody will
do for 201 files. `@fd:` tags have a mechanical seeder (`features migrate-code-tags`);
`@tests:` co-tags have none.

The roadmap entry asked for a second thing: keeping the co-tag rows when the graph is
stale, instead of collapsing them into one advisory line. That half is dropped — see
Non-goals.

## Goals

1. `@tests:` co-tags get a mechanical seeder, so the 201-row backlog drains by a command,
   in reviewable batches, instead of by hand.
2. The seeder writes exactly what the detector reports: one computation over one file set,
   so the count in the report is the count the seeder acts on.

## Non-goals

- **Carrying co-tag rows forward on a degraded run.** The entry's first ask, dropped by the
  operator on 2026-09-24. Its premise was that the graph goes stale on its own between
  release sweeps. Since 2026-09-23, `update-knowledge-graph.yml` (#501) regenerates the
  committed graph after every `feat` / `fix` / `refactor` merge, so the graph lags the code
  only between a merge and its refresh PR. A report written in that window loses its co-tag
  rows until the next regeneration, which the release sweep already forces.
- **Replacing the mtime freshness gate.** `loadFreshGraphOrWarn` compares `graph.json`'s
  mtime with the newest mtime under `consumer.scanPaths`. That asks "was a source file
  written after the graph", which a `git checkout` of `graphify-out/` or a pull's file-write
  order can fool. Real, and a different defect that affects every graph consumer.
- **Changing `detectMissingCoTags`'s return contract.** It keeps returning exactly one
  meta-gap on a stale or missing graph. That is what keeps `isStaleGraphGap` matching and
  `garden detect --ci` exiting 1
  ([`src/garden/garden-detect.ts:966-974`](../../../src/garden/garden-detect.ts)). Its
  *internals* change once, to call the shared computation below.
- **Seeding tests that carry no `// @tests:` line at all.** That is detector 10
  (`detectUntaggedTests`), which suggests slugs but never writes. The seeder merges into an
  existing tag line and never inserts one.
- **Draining the 201 rows.** This ships the tool. Running it is a follow-up chore, and a
  large one — see Risks.

## Design

### Structural context

From `pnpm noldor design graph-context` against a freshly regenerated graph on 2026-09-16
(status `fresh`; 3527 nodes, 9344 edges, 219 communities):

- `src/garden/graph-fd-lookup.ts` and `src/garden/sdd-report.ts` both sit in community
  **c4**. The shared computation lands inside that community rather than across a seam.
- `sdd-report.ts` **defines a god node**: `main()`, rank #10 with 24 edges. That is the
  argument against putting the seeder there.
- `src/features/migrate-code-tags.ts` is in community **c44**, alongside
  `src/core/fd-load.ts` and `src/features/propose-pointers.ts`, with **no god nodes and no
  cross-community edges — an interior file**. The seeder placed next to it adds one
  cross-community edge, to `graph-fd-lookup.ts` [c4] for the shared computation — the same
  edge `src/features/propose-pointers.ts:12` already has, and one no `.noldor/config.json`
  boundary forbids.

### The seeder

A new module, `src/features/seed-test-tags.ts`, beside `migrate-code-tags.ts`, run as
`pnpm noldor features seed-test-tags`. It mirrors that file's shape, but only its **merge**
behaviour: `insertFdTag` (`src/features/migrate-code-tags.ts:22-33`) inserts a tag line
when none exists, and the seeder must not — a test with no `// @tests:` line is detector
10's business, so when the tag regex misses, the seeder returns the content unchanged.
Where a tag line exists, the missing slugs are added to it: the slugs already there keep
their order, and the missing ones follow in sorted order, comma-separated. The diff on each
file is the added slugs and nothing else. A test the graph names but the walk did not find
is skipped — there is no content to merge into.

The line it edits is the one `extractTags` reads (`src/sync/sync-test-links.ts:18`): the
first `// @tests:` line, as matched by the tests adapter's pattern
(`src/sync/adapters/tests.ts:14`). The rewrite cannot use that pattern as-is, because its
trailing `\s*` can match the line break after the tag, so a `replace` would delete it.
`migrate-code-tags.ts:8-10` met the same trap for `@fd:` and matches horizontal whitespace
only; the seeder does the same.

Its freshness gate calls `loadFreshGraphOrWarn` with `scanRoots()` from
[`src/core/repo-paths.ts:35`](../../../src/core/repo-paths.ts) — the same function
`sdd-report.ts:1005` calls, where it is imported under the alias `resolveScanRoots`. A
hardcoded root set would let the seeder call fresh a graph the detector called stale, which
is exactly the confidently-wrong-tags failure the gate exists to prevent.

It **defaults to a dry run**, printing what it would write; `--apply` performs the write,
and `--path` scopes it so the backlog drains in reviewable batches. `--path` takes a
repo-relative directory or file path and may repeat. A test file is selected when its path
equals a value or sits under it at a `/` boundary, so `--path src/design` does not select
`src/design-extra/`. No globs. A `--path` that selects no test file exits non-zero and names
the value, because a typo there would otherwise read as "nothing to seed".

**Batching needs a regen between batches, and that is stated rather than implied.** A
successful `--apply` rewrites test files under `scanPaths`, which bumps their mtimes and
makes the graph stale by the gate's own definition. The next batch therefore refuses —
correctly, since the seeder cannot distinguish its own writes from a real source change.
The workflow is: regen the graph, apply one batch, regen, apply the next. The refusal
message names the regen step. Idempotence is defined **against a refreshed graph**: after a
regen, a second run over already-seeded files exits 0 having written nothing. A run that
refuses because of its own prior writes is a distinct outcome with a non-zero exit, and must
not be mistaken for the idempotent no-op.

### One shared missing-co-tag computation

`detectMissingCoTags` (`sdd-report.ts:442-476`) does more than call
`getImportOwnersForTest`: it applies the test-file filter, the `e2ePrefix` skip, the
`source_location !== 'L1'` node filter, and the declared-tag diff. The seeder needs exactly
that chain, and copying it would make "the seeder writes what the detector reports" an
assertion rather than a structural fact.

So the chain is extracted as `computeMissingCoTags(features, testInputs, graph, e2ePrefix)`,
returning per-test missing-slug sets. `e2ePrefix` is a parameter rather than a
`loadConsumerConfig()` call inside the helper, so the helper reads no config and each caller
passes the prefix it already reads. `detectMissingCoTags` becomes a thin renderer over it,
and the seeder consumes the same function. Equality of the two sets is then a property of
there being one implementation, and is pinned by a test that runs both over the same inputs.

**Discovery is extracted too, and that is the load-bearing half.** Sharing the diff chain
while letting the seeder find its own test files would leave the two agreeing on *how* to
compute and disagreeing on *what* to compute over — which is the bug this FD already
shipped once. The comment at `sdd-report.ts:1001-1004` records it: hardcoded roots left
standalone `src/` repos with an empty `testInputs` map, so every graph-known test read as
untagged and detector 13 flagged all of them.

So `collectTestInputs()` — `scanRoots()` + `walkRepo` + the test-file filter +
`readTextFiles` (`src/core/fd-load.ts:111,360`) — is extracted alongside
`computeMissingCoTags`, and `main()`'s inline filter is replaced by the shared call.
`main()` keeps its own walk for the other detectors' `allRepoPaths`, so the scan roots are
walked twice — the trade `main()`'s clone corpus already makes, one extra sub-second walk
for a single policy source.

**One test-file predicate, and it is core's.** The repo holds three today: `TEST_FILE_RE`
in [`src/core/repo-paths.ts:75`](../../../src/core/repo-paths.ts) (`.test` / `.spec` over
`ts|tsx|js|jsx`), a narrower private copy at `sdd-report.ts:421` (`ts|tsx` only), and an
inline pair at `sdd-report.ts:1010-1012` (also `ts|tsx`). Core's is the one that decides
which files feed `links.tests` — the tests adapter's `eligible`
(`src/sync/adapters/tests.ts:15`) — and those are the files whose tags the seeder writes. So
both garden sites switch to core's constant and the two copies are deleted.
`graph-fd-lookup.ts` already imports `repo-paths.ts`, so this adds no module edge, and it
imports nothing from `sdd-report.ts`: that module already imports `graph-fd-lookup.ts`, and
the reverse edge would trip the `no-module-cycles` boundary.

### Deliverables

- `src/garden/graph-fd-lookup.ts` — `computeMissingCoTags` and `collectTestInputs`.
- `src/garden/sdd-report.ts` — `detectMissingCoTags` as a thin renderer over
  `computeMissingCoTags`; its private `TEST_FILE_RE` (`:421`) and `main()`'s inline pair
  (`:1010-1012`) both gone, replaced by the shared calls over core's constant.
- `src/features/seed-test-tags.ts` — the seeder, and its leaf in
  [`src/cli/manifest.ts`](../../../src/cli/manifest.ts).
- [`docs/noldor/script-catalog.md`](../../../docs/noldor/script-catalog.md) — required:
  `src/cli/validate-script-catalog.ts` blocks when a manifest leaf's `src` path and its
  `pnpm noldor <group> <sub>` token are not cited there.
- [`docs/features/sdd-co-tag-detector.md`](../../features/sdd-co-tag-detector.md) — the
  seeder's `links.code` / `links.tests` entries and its Usage lines.
- Tests beside each.

## Acceptance criteria

1. `detectMissingCoTags` returns exactly one gap on a stale graph and on a missing graph;
   `isStaleGraphGap` still matches the stale one, and `garden detect --ci` still exits 1.
2. `main()` and the seeder both obtain test files from `collectTestInputs()`, and no
   test-file regex remains in `sdd-report.ts`.
3. `detectMissingCoTags` and the seeder, run over identical inputs, produce equal
   missing-slug sets, including with a non-default `e2ePrefix`.
4. Against a fresh graph, the seeder adds to a test file's `// @tests:` line exactly the
   slugs `computeMissingCoTags` names for that file, after the slugs already there.
5. A test file with no `// @tests:` line is returned unchanged.
6. A seeded file differs from the original only inside its tag line: the line break after
   it and every other byte are unchanged.
7. Without `--apply` no file is written; with `--path` only selected files are.
8. `--path src/design` does not select a file under `src/design-extra/`, and a `--path`
   that selects no test file exits non-zero naming it.
9. The seeder exits non-zero, writes nothing, and names the regen step when the graph is
   stale or missing — including when its own prior `--apply` caused the staleness.
10. After a regen following a successful `--apply`, a second run over the same files exits
    0 and writes nothing.

## Risks / trade-offs

The seeder's blast radius is the larger risk. A single `--apply` over 201 test files is a
201-file diff that no reviewer will read line by line, and it lands `@tests:` tags that then
drive `links.tests` via `pnpm noldor sync test-links` — so a systematic error in the owner
computation propagates into every FD those tests name. That is why the dry run is the
default, why `--path` exists, and why "drain the backlog" is a non-goal: the tool and its
first use should not be the same review. The forced regen between batches is friction, but
it is also the thing that keeps each batch's tags derived from a graph that reflects the
previous batch's writes.

Switching the detector to core's `TEST_FILE_RE` widens it to `.js` / `.jsx` tests. This
repo has none, so its report does not move. A consumer with `.test.js` files gains rows for
them — rows the detector should always have had, since the same files already feed
`links.tests`.

`graph-fd-lookup.ts` gains an import of `extractTags` from `src/sync/`, which
`sdd-report.ts` already has. The boundaries allow it (only `sync → garden` is banned); if
the indirection ratchet moves, the new baseline is recorded in its own commit.

Finally, the coupling the entry names is not solved here and gets worse as `links.code`
gaps close. This ships a pump, not a fix for the leak.

## User Story

- As an agent draining SDD gaps, I want `@tests:` co-tags seeded mechanically from the
  graph, so closing the backlog is a batched command instead of a by-hand audit of 201
  files that will never happen.

## Usage

```bash
# drain the backlog, one reviewable batch at a time
/graphify --ast-only && pnpm toon                          # fresh graph (required)
pnpm noldor features seed-test-tags --path src/design       # dry run, prints the diff
pnpm noldor features seed-test-tags --path src/design --apply
/graphify --ast-only && pnpm toon                          # regen: the apply staled it
pnpm noldor features seed-test-tags --path src/metrics --apply
pnpm noldor sync test-links                                 # propagate into FD links.tests
```

Skipping the regen between batches is not a silent failure — the next `--apply` refuses and
names the step.

## Open questions (resolved)

1. *Does the seeder live under `features` or `garden`?*
   -> **`features`.** (D1) `migrate-code-tags.ts` is its twin and is an interior file, while
   `sdd-report.ts` already defines a rank-#10 god node.

2. *Dry run by default, or write immediately?*
   -> **Dry run by default, `--apply` to write.** (D2) A 201-file diff is not something to
   produce by accident, and the dry run is the batching surface.

3. *Should the seeder relax the freshness gate so batches can run back to back?*
   -> **No — keep the gate and document the regen.** (D3) The seeder cannot distinguish its
   own comment-only writes from a real source change without reimplementing the staleness
   rule, and a seeder that guesses wrong writes confidently wrong tags. Forced regen is
   friction; a wrong tag propagates into every FD the test names.

4. *Does the extraction cover test-file discovery, or only the diff chain?*
   -> **Both.** (D4) Sharing the computation while letting each side find its own files
   would have them agree on *how* and differ on *what* — the failure
   `sdd-report.ts:1001-1004` records having already shipped once.

5. *Which test-file predicate wins?*
   -> **Core's `TEST_FILE_RE`.** (D5) It already decides which files feed `links.tests`,
   and those are the files the seeder writes. Moving `sdd-report.ts`'s private copy into
   `graph-fd-lookup.ts` instead would still leave two predicates that disagree on `.js`.

6. *Should this still carry co-tag rows forward on a degraded run?*
   -> **No — dropped.** (D6) Operator ruling, 2026-09-24: the graph now refreshes itself
   after every code merge (#501), so the between-sweeps staleness that motivated it is gone.
   Recorded under Non-goals.
