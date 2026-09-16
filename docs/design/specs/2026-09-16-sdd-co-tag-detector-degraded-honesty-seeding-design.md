# Co-Tag Detector: Degraded-Mode Honesty + Mechanical Seeding — Design

**Slug:** sdd-co-tag-detector-degraded-honesty-seeding
**FD:** docs/features/sdd-co-tag-detector.md
**Date:** 2026-09-16
**Tier:** specs-only
**Deps:** none

## Problem

The 13th SDD detector (`detectMissingCoTags`, [`src/garden/sdd-report.ts`](../../../src/garden/sdd-report.ts))
needs a fresh `graphify-out/graph.json` to name the test files whose `// @tests:`
tag omits an FD that owns a file they import. When the graph is stale it does not
weaken the signal — it *replaces* it. [`src/garden/graph-fd-lookup.ts:67`](../../../src/garden/graph-fd-lookup.ts)
returns a single meta-gap, and the detector's `if (!loadResult.ok) return [loadResult.gap]`
hands that one row back in place of the whole scan.

Measured in this worktree on 2026-09-16, against the same working tree in both cases:

| graph state | co-tag rows emitted |
| --- | --- |
| stale (as committed on `main`) | 1 |
| fresh (after `/graphify --ast-only` + `pnpm toon`) | 183 |

183 of the 197 total SDD gaps — 93% of the entire report's findings — collapse into
one advisory line whose remedy text reads "or perform a manual co-tag audit". The
committed `docs/sdd-report.md`, generated 2026-09-06 against a fresh graph, carries
181 such rows; the roadmap entry recorded 139 on 2026-08-23. The backlog is growing
(139 → 181 → 183) because closing `links.code` gaps manufactures co-tag
obligations for every test importing the newly-owned file, and the graph goes stale
on its own between release sweeps.

There is a second, sharper failure hiding inside the first. A degraded run still
*rewrites* `docs/sdd-report.md`, so it replaces the 181-row section with the single
degraded row — destroying the only committed record of how large the backlog is.
This is not hypothetical: `main()` in `sdd-report.ts` returns early for `--json`
(which is why the measurement above left the file untouched) but otherwise writes
`resolveReportOutPath(...)` unconditionally. Any plain `noldor garden sdd-report`
run between release sweeps — the window in which the graph is stale by default —
therefore trades 181 rows for one.

And the prescribed remedy — a by-hand audit of 183 files — is work nothing will ever
do. `features migrate-code-tags` already gives `@fd:` tags mechanical seeding;
`@tests:` co-tags have no equivalent.

## Goals

1. A degraded run stops destroying the co-tag findings it cannot recompute: the
   report keeps the last fresh scan's rows, visibly marked as carried-forward rather
   than current.
2. The size of what is being stood in for is legible from the report itself, without
   a second command and without a new persisted state file.
3. `@tests:` co-tags get a mechanical seeder, so the 183-row backlog is drainable by
   a command instead of by hand.

## Non-goals

- **Replacing the mtime freshness gate with a content hash.** The gate at
  `loadFreshGraphOrWarn` compares `graph.json`'s mtime against the newest mtime under
  `consumer.scanPaths`, so a `git checkout` of `graphify-out/` makes a stale graph
  read fresh. Real, and out of scope — a different defect with a different blast
  radius. Worth an `ideas.md` bullet.
- **Changing `detectMissingCoTags` or the `Gap[]` contract.** The detector keeps
  returning exactly one meta-gap on a stale graph. That is what keeps `isStaleGraphGap`
  matching and `garden detect --ci` exiting 1
  ([`src/garden/garden-detect.ts:963`](../../../src/garden/garden-detect.ts)). The whole
  change lands in report *rendering*.
- **Making `garden sdd-report` exit non-zero on a degraded run.** `--ci` already
  refuses, and a second refusal point risks the failure
  `src/release/preflight-probes.ts:636` warns about — rewriting the report and then
  aborting, leaving unexplained drift.
- **Carrying other gap categories forward.** Co-tag is the only category that
  *substitutes* a meta-gap for its rows; detectors 9, 10 and 19 degrade silently or
  not at all, so they have no rows to lose.
- **Seeding tests that carry no `// @tests:` line at all.** That is detector 10
  (`detectUntaggedTests`), which suggests slugs but never writes. This covers the
  *incomplete* tag case only.
- **Draining the 183 rows.** This ships the tool. Running it is a follow-up chore,
  and a large one — see Risks.

## Design

### Structural context

From `pnpm noldor design graph-context` against a freshly regenerated graph
(status `fresh`; 3527 nodes, 9344 edges, 219 communities):

- `src/garden/graph-fd-lookup.ts` and `src/garden/sdd-report.ts` both sit in
  community **c4**, alongside their own tests and `src/garden/detectors/override-audit.ts`.
  The files this change edits are already neighbours, so Unit A lands inside one
  community rather than across a seam.
- `sdd-report.ts` **defines a god node**: `main()`, rank #10 with 24 edges. Unit A adds
  one file read to `main()`, which widens the repo's 10th-widest node — accepted
  deliberately, because the alternative is I/O inside the pure renderer (see Unit A).
  It is also the argument against putting the seeder here.
- `src/features/migrate-code-tags.ts` is in community **c44**, alongside
  `src/core/fd-load.ts` and `src/features/propose-pointers.ts`, with
  **no god nodes and no cross-community edges — an interior file**. A sibling seeder
  placed next to it inherits that interiority, which is why Unit B goes there.
- `graph-fd-lookup.ts`'s cross-community edges run to `garden-detect.ts` [c31],
  `graph-context.ts` [c25] and `fd-load.ts` [c44]. The c31 edge is the `--ci` consumer
  this design deliberately leaves untouched.

### Unit A — a degraded run carries the prior co-tag section forward

`renderReportMd` ([`src/garden/sdd-report.ts:881`](../../../src/garden/sdd-report.ts))
is pure: it takes grouped gaps plus four report sections and returns markdown, with no
file access of its own. That purity is worth keeping, so the prior report is read in
`main()` — which already does the report I/O — and reaches the renderer as data.

`main()` reads the existing report at `resolveReportOutPath(...)` before writing,
extracts the body of its `### Tests with incomplete co-tag` section, and passes it in.
When the co-tag category's gap set is exactly the stale meta-gap and a prior section
exists, the renderer emits that prior body under a banner naming the date it came from
and how many rows it holds, plus the regen instruction the meta-gap already carries.
When no prior report exists, it emits the bare meta-gap and no count — an absent number
is honest, a zero is not.

Re-running while still stale must not re-date the banner: the second run's "prior
section" is the first run's carried section, banner included, so the banner is carried
verbatim rather than recomputed. That makes the operation idempotent and keeps the date
pointing at the last *fresh* scan rather than the last *run*.

`renderReportMd` already takes seven positional parameters; an eighth would be a review
finding on arrival. This change converts its parameter list to a single options object
in the same commit — a contained refactor, one internal function and its call site.

### Unit B — `@tests:` co-tag seeder

A new module beside `migrate-code-tags.ts`, mirroring its shape (that file is 68 lines,
and its `insertFdTag` at line 22 is the pattern to follow). For each test file the
detector flags, rewrite the existing `// @tests:` line to include the missing slugs,
sorted and comma-separated. It reuses `getImportOwnersForTest`
([`src/garden/graph-fd-lookup.ts:216`](../../../src/garden/graph-fd-lookup.ts)) and
`buildFileToFdsMap`, so no new graph logic is introduced — the owner set the seeder
writes is the same set the detector reports.

Three properties matter more than the mechanics. It **refuses on a stale graph**:
seeding from a stale graph writes tags that are confidently wrong, which is worse than
the honest gap this feature exists to surface. It is **idempotent**, so running it
twice is a no-op and it is safe in a sweep. And it **defaults to a dry run**, printing
what it would write; `--apply` performs the write, and a path filter scopes it to a
subset so the 183-row backlog can be drained in reviewable batches.

## Acceptance criteria

1. With a stale graph and a prior report on disk, the regenerated report's
   `### Tests with incomplete co-tag` section contains the prior section's bullets.
2. That section carries a banner stating the date it came from and the number of rows
   it holds.
3. With a stale graph and no prior report on disk, the section contains exactly the
   stale meta-gap bullet and states no row count.
4. A stale run immediately following another stale run leaves the banner's date and
   count unchanged.
5. A fresh run's section is computed from the graph and carries no banner.
6. `detectMissingCoTags` still returns exactly one gap on a stale graph.
7. `isStaleGraphGap` still matches that gap, and `garden detect --ci` still exits 1.
8. `renderReportMd` performs no file I/O; the prior section reaches it as an argument.
9. The seeder, against a fresh graph and a test file with an incomplete `// @tests:`
   line, adds exactly the slugs the detector names for that file.
10. Running the seeder twice in a row produces no diff on the second run.
11. The seeder exits non-zero and writes nothing when the graph is stale or missing.
12. The seeder leaves a test file that carries no `// @tests:` line untouched.
13. Without `--apply` the seeder writes no file; with a path filter it writes only
    within that filter.

## Risks / trade-offs

The carried-forward section can be wrong in a specific way: it lists gaps as of the
last fresh scan, so a co-tag an operator fixed since then still appears. The banner is
what makes that readable rather than misleading, and the alternative — showing nothing
— is the defect being fixed. Carrying stale-but-labelled findings is the lesser error.

Unit A adds a file read to `main()`, a rank-#10 god node. The design accepts that
rather than pushing I/O into the pure renderer, but it does make a wide node wider.

The banner is a new non-volatile line in the report, so `onlyVolatileSectionsChanged`
([`src/release/sdd-report-diff.ts:67`](../../../src/release/sdd-report-diff.ts)) would
see it as a real delta and the release script would abort on a dirty report. That is
the correct outcome — the release sweep regenerates the graph before the report, so a
banner appearing there means the sweep's regen did not take — and the guard already
fails safe toward aborting, so the failure is loud rather than silent. No change needed;
recorded so the first occurrence is recognised rather than debugged.

The seeder's blast radius is the larger risk. A single `--apply` over 183 test files is
a 183-file diff that no reviewer will read line by line, and it lands `@tests:` tags
that then drive `links.tests` via `pnpm sync:test-links` — so a systematic error in the
owner computation propagates into 86 feature docs. That is why the dry run is the
default, why the path filter exists, and why "drain the backlog" is a non-goal: the tool
and its first use should not be the same review.

Finally, the coupling the entry names is not solved here and gets worse as `links.code`
gaps close. This ships a pump, not a fix for the leak.

## User Story

- As an operator reading `docs/sdd-report.md` with a stale graph, I want the co-tag
  findings from the last fresh scan kept and labelled, so a regen between release
  sweeps stops trading 181 actionable rows for one advisory line.
- As an agent draining SDD gaps, I want `@tests:` co-tags seeded mechanically from the
  graph, so closing the backlog is a command I can run in batches instead of a by-hand
  audit of 183 files that will never happen.

## Usage

```bash
# regen between sweeps: the co-tag section is kept and marked carried-forward
pnpm noldor garden sdd-report

# drain the backlog (fresh graph required — the seeder refuses on a stale one)
pnpm noldor features seed-test-tags                       # dry run, prints the diff
pnpm noldor features seed-test-tags --path src/design      # scope to a batch
pnpm noldor features seed-test-tags --path src/design --apply
pnpm noldor sync test-links                                # propagate into FD links.tests
```

## Open questions (resolved)

1. *Where does the prior-section read live — inside the renderer, or in `main()`?*
   -> **`main()`, passed in as data.** (D1) `renderReportMd` is pure today and its tests
   rely on that; `main()` already owns the report I/O.

2. *Should a stale-after-stale run re-date the banner?*
   -> **No — carry the banner verbatim.** (D2) The date must name the last *fresh* scan,
   not the last run, and carrying it makes the operation idempotent.

3. *`renderReportMd` has seven positional parameters. Add an eighth, or refactor?*
   -> **Refactor to an options object in the same commit.** (D3) Eight positional
   parameters is a guaranteed review finding; the refactor is one internal function and
   its call site.

4. *Does the seeder live under `features` or `garden`?*
   -> **`features`.** (D4) `migrate-code-tags.ts` is its twin and is an interior file,
   while `sdd-report.ts` already defines a rank-#10 god node.

5. *Dry run by default, or write immediately?*
   -> **Dry run by default, `--apply` to write.** (D5) A 183-file diff is not something
   to produce by accident, and the dry run is the batching surface.

6. *Should the carry-forward generalise to every gap category?*
   -> **No, co-tag only.** (D6) It is the only category that substitutes a meta-gap for
   its rows; a general mechanism would be speculative surface.
