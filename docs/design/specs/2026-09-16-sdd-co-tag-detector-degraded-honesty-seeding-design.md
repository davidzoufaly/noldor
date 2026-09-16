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
hands that one row back in place of the whole scan. A *missing* graph takes the same
branch, so both failure modes lose the same rows.

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
*rewrites* the report, so it replaces the 181-row section with the single degraded row
— destroying the only committed record of how large the backlog is. This is not
hypothetical: `main()` in `sdd-report.ts` returns early for `--json` (which is why the
measurement above left the file untouched) but otherwise writes
`resolveReportOutPath(...)` unconditionally. Any plain `noldor garden sdd-report` run
between release sweeps — the window in which the graph is stale by default — therefore
trades 181 rows for one.

And the prescribed remedy — a by-hand audit of 183 files — is work nothing will ever
do. `features migrate-code-tags` already gives `@fd:` tags mechanical seeding;
`@tests:` co-tags have no equivalent.

## Goals

1. A degraded run stops destroying the co-tag findings it cannot recompute: the
   report keeps the last fresh scan's rows, visibly marked as carried-forward rather
   than current. "Degraded" covers both a stale and a missing graph.
2. The size and provenance of what is being stood in for is legible from the report
   itself, without a second command and without a new persisted state file.
3. `@tests:` co-tags get a mechanical seeder, so the 183-row backlog is drainable by
   a command in reviewable batches instead of by hand.

## Non-goals

- **Replacing the mtime freshness gate with a content hash.** The gate at
  `loadFreshGraphOrWarn` compares `graph.json`'s mtime against the newest mtime under
  `consumer.scanPaths`, so a `git checkout` of `graphify-out/` makes a stale graph
  read fresh. Real, and out of scope — a different defect with a different blast
  radius. Worth an `ideas.md` bullet.
- **Changing `detectMissingCoTags`'s return contract.** It keeps returning exactly one
  meta-gap on a degraded graph. That is what keeps `isStaleGraphGap` matching and
  `garden detect --ci` exiting 1
  ([`src/garden/garden-detect.ts:963`](../../../src/garden/garden-detect.ts)). Its
  *internals* change once, to call the shared helper in Unit C.
- **Making `garden sdd-report` exit non-zero on a degraded run.** `--ci` already
  refuses, and a second refusal point risks the failure
  `src/release/preflight-probes.ts:636` warns about — rewriting the report and then
  aborting, leaving unexplained drift.
- **Carrying other gap categories forward.** Co-tag is the only category that
  *substitutes* a meta-gap for its rows; detectors 9, 10 and 19 degrade silently or
  not at all, so they have no rows to lose.
- **Seeding tests that carry no `// @tests:` line at all.** That is detector 10
  (`detectUntaggedTests`), which suggests slugs but never writes. The seeder merges
  into an existing tag line and never inserts one.
- **Draining the 183 rows.** This ships the tool. Running it is a follow-up chore,
  and a large one — see Risks.

## Design

### Structural context

From `pnpm noldor design graph-context` against a freshly regenerated graph
(status `fresh`; 3527 nodes, 9344 edges, 219 communities):

- `src/garden/graph-fd-lookup.ts` and `src/garden/sdd-report.ts` both sit in
  community **c4**, alongside their own tests and `src/garden/detectors/override-audit.ts`.
  Units A and C land inside one community rather than across a seam.
- `sdd-report.ts` **defines a god node**: `main()`, rank #10 with 24 edges. Unit A adds
  one file read to `main()`, which widens the repo's 10th-widest node — accepted
  deliberately, because the alternative is I/O inside the pure renderer. It is also the
  argument against putting the seeder here.
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
`main()` — which already owns the report I/O — and reaches the renderer as data. The
function is currently unexported with a single call site; this change **exports** it so
the purity claim is testable rather than only reviewable.

**Which file is read.** `main()` reads the path `resolveReportOutPath(...)` resolves —
the file it is about to overwrite — never the canonical `docs/sdd-report.md` when those
differ. The rule is one sentence and has no exception: **a run carries forward whatever
its own target already holds.** For a redirected run that target is usually empty, so
nothing is carried; the release preflight is exactly that case, regenerating into a fresh
`mkdtemp` directory (`src/release/preflight-probes.ts:648-656`), so a preflight regen
never carries forward in practice. But a redirected run whose target *does* hold prior
findings carries them, like any other run — the behaviour is uniform, and it is only the
preflight's choice of an always-empty target that makes it look otherwise.

**What counts as a baseline.** Only a prior section that held real findings. A prior
section whose content is the degraded meta-gap is not a baseline — carrying it would
label a meta-gap as one historical finding and date it to a degraded run. The prior
section arrives as **markdown bullets, not `Gap` objects**, so the classification is a
text predicate and deliberately does *not* call `isStaleGraphGap`
([`src/garden/graph-fd-lookup.ts:115`](../../../src/garden/graph-fd-lookup.ts)): that
function takes a `Gap`, and it documents at `graph-fd-lookup.ts:104-110` that it
deliberately excludes the *missing*-graph gap — so on the missing-graph path it would
classify a degraded-only section as a baseline. The predicate instead reads the bullets:
`renderGapBullet` (`sdd-report.ts:877`) renders `itemId` in a code span, and **both**
degrade branches emit `itemId: graphPath` (`graph-fd-lookup.ts:72` for missing,
`:85` for stale). So a section holding exactly one bullet whose code-span is the graph
path is degraded-only, on either path. `META_GAP_CATEGORY` is currently unexported at
`graph-fd-lookup.ts:40` and duplicated as a bare literal at `sdd-report.ts:469`; this
change exports it and both sites use the export, so the heading match is not a third copy.

**The marker is a visible line, not an HTML comment.** An HTML comment renders to nothing,
so a reader on GitHub would see historical bullets with no date, no count and no
carried-forward label — which is precisely the illegibility this feature exists to remove.
A carried section therefore opens with a blockquote directly under its `###` heading:

```
### Tests with incomplete co-tag

> **Carried forward** — 181 rows from the fresh scan of 2026-09-06, not re-checked in
> this run. Regenerate with `/graphify --ast-only && pnpm toon` to recount.
```

That line is both the human label and the machine marker; the parser keys on the
`**Carried forward**` opener rather than on a comment. On a **first** carry the date comes
from the prior report's `Generated:` line ([`docs/sdd-report.md:5`](../../../docs/sdd-report.md))
and the count from the counted bullets. On a **re-carry** the existing line's *date* is
preserved, so it keeps naming the last *fresh* scan rather than the last run.

**Three degenerate baselines, each with a stated outcome.** The verbatim-copy rule above
is not unconditional, because an unconditional copy can preserve false provenance:

- *Prior report present but unreadable or unparseable.* Do **not** write. Refuse with a
  message naming the path. Overwriting a file whose contents could not be read is the
  history loss this feature exists to prevent, and it is a narrower case than the
  degraded-graph non-goal above — which is about the graph, not about the prior report.
- *Prior section holds real findings but the report has no parseable `Generated:` date.*
  Carry the bullets and write the marker with the date stated as unknown. A fabricated
  date is worse than an admitted gap.
- *Prior section carries a marker whose row count disagrees with its bullet count.*
  Recount from the bullets and keep the marker's date. The date is the irreplaceable
  half; a count is derivable, so repairing it loses nothing.

**Both degrade paths.** Preservation triggers on any `!loadResult.ok` — stale *and*
missing graph — because both replace the rows and the goal is about degraded runs, not
about staleness specifically.

### Unit B — `@tests:` co-tag seeder

A new module beside `migrate-code-tags.ts`. It mirrors that file's shape, but only its
**merge** behaviour: `insertFdTag` (`src/features/migrate-code-tags.ts:22-33`) inserts a
tag line when none exists, and the seeder must not — a test with no `// @tests:` line is
detector 10's business, so when the tag regex misses, the seeder returns the content
unchanged. Where a tag line exists, the missing slugs are merged into it, sorted and
comma-separated.

Its freshness gate calls `loadFreshGraphOrWarn` with `scanRoots()` from
[`src/core/repo-paths.ts:34`](../../../src/core/repo-paths.ts) — the same function
`sdd-report.ts:1005` calls, where it is imported under the alias `resolveScanRoots`. A
hardcoded root set would let the seeder call fresh a graph the detector called stale,
which is exactly the confidently-wrong-tags failure the gate exists to prevent.

It **defaults to a dry run**, printing what it would write; `--apply` performs the write,
and `--path` scopes it so the backlog drains in reviewable batches.

**Batching needs a regen between batches, and that is stated rather than implied.** A
successful `--apply` rewrites test files under `scanPaths`, which bumps their mtimes and
makes the graph stale by the gate's own definition. The next batch therefore refuses —
correctly, since the seeder cannot distinguish its own writes from a real source change.
The workflow is: regen the graph, apply one batch, regen, apply the next. The refusal
message names the regen step. Idempotence is defined **against a refreshed graph**: after
a regen, a second run over already-seeded files exits 0 having written nothing. A run
that refuses because of its own prior writes is a distinct outcome with a non-zero exit,
and must not be mistaken for the idempotent no-op.

### Unit C — one shared missing-co-tag computation

`detectMissingCoTags` (`sdd-report.ts:456-474`) does more than call
`getImportOwnersForTest`: it applies the `TEST_FILE_RE` filter, the `e2ePrefix` skip, the
`source_location !== 'L1'` node filter, and the declared-tag diff. The seeder needs
exactly that chain, and copying it would make "the seeder writes what the detector
reports" an assertion rather than a structural fact.

So the chain is extracted as `computeMissingCoTags(features, testInputs, graph)`,
returning per-test missing-slug sets. `detectMissingCoTags` becomes a thin renderer over
it, and the seeder consumes the same function. Equality of the two sets is then a
property of there being one implementation, and is pinned by a test that runs both over
the same inputs.

**Discovery is extracted too, and that is the load-bearing half.** Sharing the diff chain
while letting the seeder find its own test files would leave the two agreeing on *how* to
compute and disagreeing on *what* to compute over — which is the bug this FD already
shipped once. The comment at `sdd-report.ts:1001-1003` records it: hardcoded roots left
standalone `src/` repos with an empty `testInputs` map, so every graph-known test read as
untagged and detector 13 flagged all of them. The duplication is live today —
`TEST_FILE_RE` is unexported at `sdd-report.ts:421`, and `main()` at
`sdd-report.ts:1010-1012` does not use it, filtering with an inline
`/\.test\.(ts|tsx)$/ || /\.spec\.(ts|tsx)$/` pair instead. That is already a second copy;
a seeder rolling its own walk would be the third.

So `collectTestInputs()` — `resolveScanRoots()` + `walkRepo` + the test-file filter +
`readTextFiles` — is extracted alongside `computeMissingCoTags`, `TEST_FILE_RE` is
exported, and `main()`'s inline pair is replaced by the shared call. Detector and seeder
then read one file set by construction, and the count the report shows is the count the
seeder will act on.

### Deliverables

- `src/garden/sdd-report.ts` — exported `renderReportMd` with an options-object parameter
  list (it has seven positional parameters today; an eighth would be a review finding),
  the carry-forward splice, and the prior-section read in `main()`.
- `src/garden/graph-fd-lookup.ts` — exported `META_GAP_CATEGORY`, plus
  `computeMissingCoTags` and `collectTestInputs`.
- `src/garden/sdd-report.ts` — exported `TEST_FILE_RE`, and `main()`'s inline
  `/\.test\.(ts|tsx)$/ || /\.spec\.(ts|tsx)$/` pair (`:1010-1012`) replaced by the shared
  discovery call, so the repo holds one test-file predicate rather than three.
- `src/features/<seeder>.ts` — the seeder, and its leaf in
  [`src/cli/manifest.ts`](../../../src/cli/manifest.ts).
- [`docs/noldor/script-catalog.md`](../../../docs/noldor/script-catalog.md) — required:
  `src/cli/validate-script-catalog.ts:29-33,47` blocks when a manifest leaf's `src` path
  and its `pnpm noldor <group> <sub>` token are not cited there.
- Tests beside each.

## Acceptance criteria

1. Stale graph + a prior section that held real findings → the regenerated section
   contains those bullets and states its provenance — carried-forward label, source date,
   row count — as **rendered** text, not only inside an HTML comment.
2. A missing graph produces the same carry-forward behaviour as a stale graph.
3. A prior section holding exactly one bullet whose code span is the graph path is not a
   baseline: on both the stale and the missing branch, the new section is the bare
   meta-gap with no marker and no row count.
4. A degraded re-run preserves the existing marker's date.
5. Each degenerate baseline has its stated outcome: a prior report that exists but cannot
   be read or parsed → nothing is written and the exit is non-zero, naming the path; real
   findings with no parseable `Generated:` date → bullets carried with the date stated as
   unknown; a marker whose row count disagrees with its bullets → recounted total, original
   date kept.
6. The resolved `--out` path is the only prior report read: an empty target yields the
   bare meta-gap, and a target holding findings carries them.
7. A fresh run's section is computed from the graph and carries no marker.
8. `detectMissingCoTags` returns exactly one gap on a stale graph and on a missing graph;
   `isStaleGraphGap` still matches the stale one, and `garden detect --ci` still exits 1.
9. `renderReportMd` is exported and performs no file I/O — the prior section reaches it as
   an argument.
10. `main()` and the seeder both obtain test files from `collectTestInputs()`, and no
    inline test-file regex remains in `sdd-report.ts`.
11. `detectMissingCoTags` and the seeder, run over identical inputs, produce equal
    missing-slug sets.
12. Against a fresh graph, the seeder adds to a test file's `// @tests:` line exactly the
    slugs `computeMissingCoTags` names for that file.
13. A test file with no `// @tests:` line is returned unchanged.
14. Without `--apply` no file is written; with `--path` only files under that filter are.
15. The seeder exits non-zero, writes nothing, and names the regen step when the graph is
    stale or missing — including when its own prior `--apply` caused the staleness.
16. After a regen following a successful `--apply`, a second run over the same files
    exits 0 and writes nothing.

## Risks / trade-offs

The carried-forward section can be wrong in a specific way: it lists gaps as of the last
fresh scan, so a co-tag an operator fixed since then still appears. The marker is what
makes that readable rather than misleading, and the alternative — showing nothing — is
the defect being fixed. Carrying stale-but-labelled findings is the lesser error.

Unit A adds a file read to `main()`, a rank-#10 god node, and converts
`renderReportMd`'s parameter list to an options object. Both are accepted: the read
belongs where the other report I/O already is, and seven positional parameters is already
at the limit.

Reading the resolved out path rather than the canonical report means a run can only
inherit its own target's history. The release preflight regenerates into a fresh
`mkdtemp` directory, so its target is always empty and preflight regens are unaffected by
this feature — no marker can appear there, and the `onlyVolatileSectionsChanged`
dirty-report guard
([`src/release/sdd-report-diff.ts:67`](../../../src/release/sdd-report-diff.ts)) sees no
new line. The cost is that a redirected run against an empty target gives up the
preservation this feature adds; the benefit is that no run can splice one file's findings
into another. Both follow from the same one-sentence rule, with no special case for
redirection.

The seeder's blast radius is the larger risk. A single `--apply` over 183 test files is a
183-file diff that no reviewer will read line by line, and it lands `@tests:` tags that
then drive `links.tests` via `pnpm sync:test-links` — so a systematic error in the owner
computation propagates into 86 feature docs. That is why the dry run is the default, why
`--path` exists, and why "drain the backlog" is a non-goal: the tool and its first use
should not be the same review. The forced regen between batches is friction, but it is
also the thing that keeps each batch's tags derived from a graph that reflects the
previous batch's writes.

Finally, the coupling the entry names is not solved here and gets worse as `links.code`
gaps close. This ships a pump, not a fix for the leak.

## User Story

- As an operator reading `docs/sdd-report.md` with a stale or missing graph, I want the
  co-tag findings from the last fresh scan kept and labelled with their date, so a regen
  between release sweeps stops trading 181 actionable rows for one advisory line.
- As an agent draining SDD gaps, I want `@tests:` co-tags seeded mechanically from the
  graph, so closing the backlog is a batched command instead of a by-hand audit of 183
  files that will never happen.

## Usage

```bash
# regen between sweeps: the co-tag section is kept, marked with its source date
pnpm noldor garden sdd-report

# drain the backlog, one reviewable batch at a time
/graphify --ast-only && pnpm toon                          # fresh graph (required)
pnpm noldor features seed-test-tags --path src/design       # dry run, prints the diff
pnpm noldor features seed-test-tags --path src/design --apply
/graphify --ast-only && pnpm toon                          # regen: the apply staled it
pnpm noldor features seed-test-tags --path src/metrics --apply
pnpm noldor sync test-links                                 # propagate into FD links.tests
```

Skipping the regen between batches is not a silent failure — the next `--apply` refuses
and names the step.

## Open questions (resolved)

1. *Where does the prior-section read live — inside the renderer, or in `main()`?*
   -> **`main()`, passed in as data.** (D1) `renderReportMd` is pure today; `main()`
   already owns the report I/O.

2. *Should a degraded-after-degraded run re-date the banner?*
   -> **No — copy the marker verbatim.** (D2) The date must name the last *fresh* scan,
   and the marker is what makes that decidable.

3. *`renderReportMd` has seven positional parameters. Add an eighth, or refactor?*
   -> **Refactor to an options object, and export it.** (D3) Eight positional parameters
   is a guaranteed review finding, and the export is what makes AC10 testable.

4. *Read the canonical `docs/sdd-report.md`, or the resolved `--out` path?*
   -> **The resolved out path, with no special case for redirection.** (D4) A run carries
   forward whatever its own target holds; reading the canonical report would splice its
   rows into an unrelated redirected file. The preflight's target happens to be an
   always-empty tmpdir, so preflight regens carry nothing — a consequence of the rule, not
   an exception to it.

5. *Does the seeder live under `features` or `garden`?*
   -> **`features`.** (D5) `migrate-code-tags.ts` is its twin and is an interior file,
   while `sdd-report.ts` already defines a rank-#10 god node.

6. *Dry run by default, or write immediately?*
   -> **Dry run by default, `--apply` to write.** (D6) A 183-file diff is not something
   to produce by accident, and the dry run is the batching surface.

7. *Should the carry-forward generalise to every gap category?*
   -> **No, co-tag only.** (D7) It is the only category that substitutes a meta-gap for
   its rows; a general mechanism would be speculative surface.

8. *Should the seeder relax the freshness gate so batches can run back to back?*
   -> **No — keep the gate and document the regen.** (D8) The seeder cannot distinguish
   its own comment-only writes from a real source change without reimplementing the
   staleness rule, and a seeder that guesses wrong writes confidently wrong tags. Forced
   regen is friction; a wrong tag propagates into 86 feature docs.

9. *Should the carried-forward marker be an HTML comment or visible text?*
   -> **Visible text — a blockquote under the heading.** (D9) An HTML comment renders to
   nothing, so the reader of the rendered report would see historical bullets with no
   date, no count and no label, which defeats both legibility goals. One visible line
   serves as the human label and the parse key.

10. *How does the renderer tell a real baseline from a degraded-only prior section?*
    -> **A text predicate on the bullets, not `isStaleGraphGap`.** (D10) The prior section
    arrives as markdown, and that function both takes a `Gap` and documents that it
    excludes the missing-graph gap — so it would misclassify a degraded-only section as a
    baseline on exactly the path (D2) just added. Both degrade branches emit
    `itemId: graphPath`, which `renderGapBullet` puts in a code span, so a lone bullet
    whose code span is the graph path identifies the degraded-only case on either path.

11. *What happens when the prior report exists but cannot be read or parsed?*
    -> **Refuse to write, non-zero, naming the path.** (D11) Overwriting a file whose
    contents could not be read is the history loss this feature exists to prevent. This is
    narrower than the degraded-graph non-goal, which concerns the graph and not the report.

12. *Does the extraction cover test-file discovery, or only the diff chain?*
    -> **Both.** (D12) Sharing the computation while letting each side find its own files
    would have them agree on *how* and differ on *what* — the failure `sdd-report.ts:1001-1003`
    records having already shipped once. `main()` already carries a second copy of the
    test-file predicate inline; a seeder with its own walk would be the third.
