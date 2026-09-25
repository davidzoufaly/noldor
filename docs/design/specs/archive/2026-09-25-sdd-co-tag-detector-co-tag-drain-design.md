# Co-Tag Drain — Design

**Slug:** sdd-co-tag-detector (enhancement: co-tag-drain)
**FD:** docs/features/sdd-co-tag-detector.md
**Date:** 2026-09-25
**Tier:** specs-only
**Deps:** none

## Problem

With a fresh graph, `garden detect` lists ~214 "Tests with incomplete co-tag" rows. The
roadmap entry (Q-0323) framed the fix as mechanical: run `pnpm noldor features seed-test-tags
--apply`, one PR per file family, until the category reads empty.

A dry run says the rows are mostly not missing tags. The seeder proposes **606 tag additions
across 215 test files**. Only **61 of those additions (56 files)** come from an imported file
that exactly one FD claims in `links.code`. The rest come from files several FDs claim at once:
`src/core/consumer-config.ts` is in both `acceptance-verify-lane` and `ui-design-review-lane`;
`src/core/doc-roots.ts` is in `unvalidated-slug-path-traversal-across-cli-entry-points`, a
security fix that touched it once; `acceptance-verify-lane` claims the whole `src/cr/` and
`src/autonomous/` directories. Every test that imports `consumer-config.ts` would gain both
slugs. Applying all 606 would make `// @tests:` lines say "this test covers every feature
that ever edited a helper it calls", which is the opposite of what the tag is for.

So the detector is right about its rule and wrong about its input: `links.code` over-claims
shared files, and the co-tag detector (and `features owners`, which the fast-track doc-impact
check reads) inherits every over-claim.

## Goals

- `garden detect`'s incomplete-co-tag category reads empty (the Q-0323 deletion test).
- Every tag the drain adds names an FD that is about a file the test imports (ADR 0009's rule).
  Whether the test exercises that feature's behaviour is not checked.
- `links.code` stops claiming files an FD only passed through, so `features owners` names the
  FDs a file is about rather than every FD that once edited it.

## Non-goals

- Changing the detector's rule (import → owner → expected tag), or filtering multi-owner files
  out of it (D1).
- A new check that caps how many FDs may claim one file. The co-tag detector already is that
  check: a fresh over-claim shows up as new co-tag rows at the next garden pass.
- Adding `// @tests:` lines to untagged tests — detector 10's job, not this drain's.
- E2E specs (`e2ePrefix`), which the detector already skips.
- Multi-owner claims on docs, skills and config files (`docs/**`, `.claude/**`,
  `.noldor/config.json`). Tests never import them, so they make no co-tags; they are left for a
  follow-up roadmap entry.

## Design

UI verdict: skip — the change edits FD frontmatter and test tag lines; no `uiPaths` are configured
and no file renders anything.

Architecture verdict: skip — no module, directory, package or cross-module import is added or
removed; `checks arch-baseline` still runs at ship time.

### Structural context

`src/features/seed-test-tags.ts` and `src/garden/graph-fd-lookup.ts` sit together in community
c27, alongside `features-owners-cli.ts` and their tests; the community is owned mostly by
`outcome-telemetry-and-effectiveness-metrics`, not by this FD. Neither file is a god node.
`graph-fd-lookup.ts` is the bridge: `garden-detect.ts` [c57] and `sdd-report.ts` [c11] both
import it, so any change to how ownership is resolved moves the co-tag detector, detector 10,
the orphan-owner suggestion and `features owners` together. The drain itself mostly edits
test files and FD frontmatter, which carry no structural weight.

### Where the noise comes from

`computeMissingCoTags` (`src/garden/graph-fd-lookup.ts:452`) walks each test's `imports_from`
edges and asks `getFdOwnersForFile` for every FD whose `links.code` covers the target —
directory entries included, via ancestor walk. A file claimed by N FDs makes N expected tags.
Nothing in the chain distinguishes "this FD is about this file" from "this FD once edited it".

### Approach (strawman pick): prune claims, then seed

The over-claim lives in the data, so the drain fixes the data rather than filtering it out of
one reader. A detector-side filter (skip any imported file two or more FDs claim) would be a
smaller change, but it hides the bad claims from the co-tag detector alone and leaves
`features owners` — and so the fast-track doc-impact check — as noisy as today.

1. **Prune.** List every `links.code` entry that covers a file some other FD also covers, plus
   every directory entry. Git history cannot settle ownership (the early squash commits that
   added most shared files carry no `Noldor-FD:` trailer), so the rule is a judgment rule:
   - **One owner per file by default** — the FD the file is *about*.
   - A **second owner keeps its claim** only when its `## Summary` describes what that file does.
   - **Directory entries** (`src/cr/`, `src/autonomous/`) become the specific files the feature
     added or is about.
   - A plain helper (`src/core/err-message.ts`, `src/core/consumer-config.ts`,
     `src/core/doc-roots.ts`) may end with **no** owner if no FD is about it.

   The agent drafts a prune table (`file | kept owner | dropped from`), shows it to the operator
   before editing any FD, and puts the approved table in the prune commit's message body.
   For an FD with any `// @fd:` headers, `pnpm noldor sync code-links` rebuilds every
   file-level `links.code` entry from those headers and keeps only directory entries
   (`project`, `src/sync/projection.ts`). So a prune there is a header edit plus the matching
   frontmatter, and a directory swap adds `// @fd:` headers to the files it keeps — otherwise
   the next sync undoes it. The FD edits go
   through `pnpm noldor validate features`, and `sync code-links --check` reports no new drift.
   The rule is recorded as [ADR 0009](../../adr/0009-links-code-means-what-a-file-is-about.md).
2. **Seed.** Re-run `seed-test-tags` (dry run) and check the proposal count dropped to roughly
   the single-owner set; then apply it one file family at a time with `--path <dir> --apply`.
3. **Verify.** `garden detect` shows the category empty; `features validate` and the suite stay
   green.

### Delivery

One PR from this session. The first commit is the prune (`// @fd:` header edits plus the
matching FD frontmatter); then one
commit per file family of tag edits (cr, core, dashboard, design, garden, autonomous, release,
and one catch-all for the small families). The entry proposed one PR per family, but the
families are the same mechanical edit and all of them wait on the prune, so seven sessions
would re-review one rule seven times. Per-family commits keep the diff readable and let a bad
family be reverted alone.

## Acceptance criteria

- On a graph built from the PR's head, `pnpm noldor garden detect` reports zero
  incomplete-co-tag rows.
- `pnpm noldor features seed-test-tags` (dry run) on that graph proposes zero edits.
- After the prune, no `src/**/*.ts` file is covered by more than one FD's `links.code` except
  the owners the approved prune table keeps, and no `links.code` entry is a bare directory under
  `src/`.
- The PR's diff touches only FD frontmatter (`links.code`), `// @fd:` header lines, `// @tests:`
  lines, this spec and its ADR; no test body or code line changes.
- `pnpm noldor sync code-links --check` reports no FD the prune made stale.
- The prune lands as its own commit before any tag commit, and each tag commit touches one file
  family.
- `pnpm noldor validate features`, typecheck and the full test suite pass.

## Risks / trade-offs

- Pruning `links.code` changes what `features owners` returns, so fast-track doc-impact checks
  see fewer candidates. That is the point, but a wrong prune hides a real owner.
- A 200-file diff of tag lines is hard to review line by line; the review has to trust the
  seeder's rule and check the pruning instead.
- "What the file is about" is a judgment. The prune table makes each call visible, and the
  operator skims it before anything is written; a wrong call is one frontmatter line to put back.
- Dropping a claim can leave a file with no owner, which `garden detect` may report as a
  code orphan. That is honest for a pure helper; the table flags every file it orphans.
- The graph holds imports, not ownership, so the prune needs no graph rebuild: the seeder reads
  the pruned FDs directly. A stale graph makes it refuse (`graph-unusable`) rather than write
  wrong tags.

## User Story

As a maintainer reading a test's `// @tests:` line, I want it to name only the features whose
files that test imports, so that the tag tells me what breaks when the test goes red.

## Usage

```bash
pnpm noldor features seed-test-tags               # dry run: what would change
pnpm noldor features seed-test-tags --path src/cr --apply
pnpm noldor garden detect                         # co-tag category reads empty
```

## Open questions (resolved)

1. *Prune `links.code`, or teach the detector to ignore shared files?*
   -> Prune. (D1) The over-claim also skews `features owners`; fixing the data fixes both
   readers, where a detector filter hides it from one.
2. *One PR per family, or one PR?*
   -> One PR, one commit per family after the prune. (D2) Same edit everywhere, all blocked on
   the prune; one review of the rule beats seven reviews of tag lines.
3. *When may an FD keep a file another FD also claims?*
   -> One owner by default; a second only when its Summary describes the file. (D3) History
   cannot attribute the old shared files, and a looser rule leaves most of the 545 noisy adds
   standing.
