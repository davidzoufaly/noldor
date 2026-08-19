# Traceability Projection Module — Design

**Slug:** feature-md-links-overhaul-traceability-projection
**FD:** docs/features/feature-md-links-overhaul.md
**Date:** 2026-08-18
**Tier:** specs-only
**Deps:** none

## Problem

Three sync commands project file-side tags onto feature-MD `links.*` arrays, and
each one re-implements the same pipeline: tag extraction, filesystem walking, slug
grouping, feature-frontmatter loading, array comparison, frontmatter writing,
warnings and a CLI summary. Clone detection measured two repeated groups of
roughly 223 and 216 tokens across them. The three copies have already diverged,
and the divergence is where the defects live.

**The confirmed clearing bug.** `sync doc-links` and `sync test-links` cannot clear
a feature's last removed tag. Both drive their write loop from the freshly-scanned
map alone — `for (const [slug, paths] of map)` at
[`sync-doc-links.ts:105`](../../../src/sync/sync-doc-links.ts) and
[`sync-test-links.ts:136`](../../../src/sync/sync-test-links.ts). While a slug still
has at least one tagged file, removed paths disappear correctly. When the last tag
or the last tagged file goes, the slug drops out of the map entirely and its cached
frontmatter array is never visited, so stale `links.docs` and `links.tests` entries
survive forever. `sync code-links` already drives the union of scanned and cached
slugs ([`sync-code-links.ts:277`](../../../src/sync/sync-code-links.ts)) and pairs it
with an explicit empty-projection policy — that is the intended shape.

Measured on this repo: 2 FDs carry `links.tests` entries with no surviving `// @tests:`
tag (`release-bypass-retirement`, `code-reviewer-20`), and 7 FDs carry 25 `links.docs`
entries that no scan can reach at all.

**Two further defects surfaced while grounding this spec.**

Every one of the 25 cached `links.docs` entries in this repo points under `docs/noldor/`,
which `DOC_DIRS` at [`sync-doc-links.ts:7`](../../../src/sync/sync-doc-links.ts) never scans —
so no run can ever reconcile them, in either direction. `docs/noldor` is not a fixable scan
root either: its pages are byte-identical twins of `templates/docs/noldor/`, synced verbatim
into every consumer ([`migrations/0.6.0.ts:106`](../../../src/migrations/0.6.0.ts)), and the one
live tag there ([`docs/noldor/drain-mode.md:5`](../../../docs/noldor/drain-mode.md)) names a
Noldor-internal FD no consumer has. In this repo `docs/user/tutorials` and
`docs/user/explanation` do not exist at all, so the doc scan is effectively empty today.

The doc tag regex `/<!--\s*@feature:\s*(.+?)\s*-->/m` has no line anchor, unlike the
`^`-anchored code and test regexes, so it matches the literal example string
`<!-- @feature: <slug> -->` wherever it appears in prose. No doc under the scan roots contains
that string today, so this is latent rather than live — but five framework docs do carry it
inside table cells and bullets, and any how-to page documenting the convention would too.

Finally, the doc-root list is forked four ways: sync uses three directories while
[`validate-features.ts:355`](../../../src/features/validate-features.ts),
[`sdd-report.ts:1000`](../../../src/garden/sdd-report.ts) and
[`dashboard/data.ts:1151`](../../../src/dashboard/data.ts) each hardcode two.

## Goals

- One projection engine shared by the three array-valued tag-scanned kinds, so a fix
  to clearing, scan failure or reporting applies to every traceability kind at once.
- `sync doc-links` and `sync test-links` clear a feature's last removed tag.
- A scan that could not read its inputs never masquerades as authoritative emptiness.
- The doc scan stops matching prose examples, and the 25 unreconcilable cached entries get a
  convergence path that survives the templated twin.
- `--check` and `--force`, plus garden drift detection, available for all three kinds
  rather than code alone.

## Non-goals

- `sync spec-links` and `sync fd-resources` are untouched. `spec-links` derives its
  slug from a filename via `extractSpecSlug` and writes a single-string `links.spec`,
  not a tag-scanned array; `fd-resources` is frontmatter-driven. Forcing either through
  the adapter interface is the over-generalization the source entry warns against.
- No `.noldor/config.json` knob for doc paths.
- `docs/noldor` does not become a doc-projection root. Scanning a templated tree would emit an
  unknown-slug warning in every consumer's pre-commit hook to gain one already-correct link.
- `sync-code-links.ts`'s directory-entry preservation is not generalized into every
  kind — it stays explicit adapter data (see D3 under Design).

## Design

### U1 — `LinkAdapter` (`src/sync/adapters/`)

One descriptor per kind, each a plain object, each independently testable:

- `key` — the destination `links.*` field (`code` | `tests` | `docs`).
- `tagRe` — the line-anchored tag pattern.
- `roots()` — the directories to walk, each labelled `configured` or `default`.
- `eligible(name)` — filename predicate.
- `preserve(path)` — entries in the cached array the scan must never own. Code returns
  true for directory entries (a tag cannot live on a directory), matching today's
  `isDirEntry`; tests and docs return false. This is the explicit strategy data the
  source entry asks for instead of a generalized preservation rule.

Three adapters: `code.ts` (`^//\s*@fd:`, `scanRoots()` marked per origin, `.ts/.tsx/.js/.jsx`
excluding tests, key `code`), `tests.ts` (`^//\s*@tests:`, `scanRoots()`, `*.test.*`/`*.spec.*`,
key `tests`), `docs.ts` (`^<!--\s*@feature:...-->`, `docProjectionRoots()`, `*.md`, key `docs`).

### U2 — `src/sync/projection.ts` (the engine)

Kind-agnostic. Owns, in order: walk the adapter's roots; extract tags; group into a
`scanned` map; load the `cached` map from `docs/features/`; iterate the **union** of
scanned and cached slugs; apply the empty-scan policy; diff; write. The union iteration
is the clearing-bug fix, applied once for all kinds.

Exposed units: `collectTagged(adapter, repoRoot)`, `buildSlugMap(tagged)`,
`loadCached(featuresDir, key)`, `project(scanned, current, adapter, force)`,
`diffProjection(scanned, cached, adapter)`, `taglessKeptSlugs(scanned, cached, adapter)`,
`runProjection(adapter, opts)`. These mirror the names and semantics of the existing
`sync-code-links.ts` exports so the port is behaviour-preserving for the code kind.

### U3 — Empty-scan policy (two layers, all kinds)

**Layer A — authority.** Each root carries its origin. A missing root that the consumer
explicitly configured (a `.noldor/config.json` `scanPaths` entry) makes the whole run
non-authoritative: no FD is cleared, the offending root is named, exit code 1. A missing
root from the `DEFAULT_SCAN_ROOTS` union-of-layouts fallback is a silent skip, because
that list exists to be partially absent — a standalone repo has no `packages/`. Any
non-ENOENT `readdir` failure (`EACCES` and friends) is non-authoritative regardless of
root origin. Today `walkCode` ENOENT-skips everything and `walkTests` throws on
everything; both become this single policy.

**Layer B — emptiness.** A clean scan that matched zero tags for a slug keeps that FD's
cached non-preserved entries, reports them, and clears them only under `--force`. This
generalizes `projectLinksCode`'s existing guard, which exists because the same code path
in a repo with no tags at all would otherwise wipe every hand-curated array in one run.
That is not hypothetical for docs: the seven FDs above would lose 25 entries.

**Convergence.** Layer B on its own leaves a repo permanently noisy: the pre-commit hook runs
`sync doc-links` without `--force`, so the same tagless FDs are re-reported on every commit, and
`--force` is repo-wide so the only way to converge is to delete every curated entry at once. Two
things close that.

The tagless-kept report is suppressed by an explicit `--quiet` flag, added to the three `sync`
lines in [`lefthook/noldor.yml`](../../../lefthook/noldor.yml). The hook otherwise runs the
identical command an operator types, so there is no implicit discriminator to key off.

And the implementation carries a **one-time in-repo reconciliation** of the 25 cached
`links.docs` entries: all of them point under `docs/noldor`, which is not a projection root, so
they are **dropped** rather than tagged. Tagging is not available there — the pages are templated
twins, a tag would have to be mirrored into `templates/`, and a consumer's own edit is
overwritten on the next upgrade. Entries under a templated root are excluded from tagless-kept
accounting for the same reason: a consumer can never own a tag there, so reporting one is a
permanent red with no operator-reachable fix.

### U4 — Doc roots (`src/core/doc-roots.ts`)

Two new exports beside `loadDocRoots`, both taking an explicit `cwd` and returning **absolute**
paths — one convention with `loadDocRoots(cwd)`, and no implicit-cwd provider (the leak shape
Q-0104 left open). Callers that speak repo-relative paths normalize at their own boundary, as the
engine already does via `relative(repoRoot, file)`.

- `docProjectionRoots(cwd = process.cwd()): string[]` → `docs/user/tutorials`,
  `docs/user/explanation`, `docs/user/how-to`. Read by the docs adapter **and** by
  `validateDocFeatureSlugs`, so every tag the sync honors is also slug-validated.
- `docPresenceRoots(cwd = process.cwd()): string[]` → `docs/user/tutorials`,
  `docs/user/explanation`. Read by `validateDocTagPresence` and garden detector 11, so a how-to
  page is scanned and slug-validated without being required to carry a tag.

The split is presence-vs-projection only. `docs/noldor` appears in neither: it is a templated
twin, so a tag added there must be mirrored into `templates/` or `checks template-sync` fails
([`src/checks/check-template-sync.ts:29`](../../../src/checks/check-template-sync.ts)), mirroring
would ship framework-internal slugs into every consumer, and a consumer's own edit is overwritten
on the next upgrade. Keeping it out of the projection set is what lets slug validation stay on the
wide list without redding anyone.

All roots are framework defaults, so a missing one is an ENOENT skip under Layer A.
`sdd-report.ts` and `dashboard/data.ts` migrate to `docPresenceRoots()`, deleting their
literal copies.

### U5 — Entrypoints and drift detection

The three `sync-*-links.ts` files shrink to thin mains that select an adapter and call
`runProjection`, re-exporting the symbols their six external importers already use
(`extractTags`, `extractFeatureTags`, `buildSlugToCodeMap`, `collectTaggedCode`,
`loadCachedCode`, `diffProjection`, `scanRoots`). CLI manifest `src` paths are unchanged,
so `validate script-catalog` sees no churn.

`--check` and `--force` come from the engine for all three kinds.
`detectCodeLinksDrift` is replaced by one kind-parameterized detector. For `garden detect` the
engine exposes a multi-adapter entry that traverses the shared `scanRoots()` tree **once** — the
code and tests adapters differ only in their `eligible` predicate, so one walk classifies both —
and parses each FD **once**, returning all three cached arrays. Without it a single
`garden detect` would do two full recursive walks plus three full re-parses of every FD where it
walks once today. The per-kind CLI path keeps the simple single-adapter call. Because `diffProjection` excludes FDs the write path would skip,
the 9 currently-drifting FDs surface in the tagless-kept report rather than as `sddGaps`,
so the release gate stays green.

### Error handling

A slug with no matching `docs/features/<slug>.md` warns and continues (today's behaviour).
Non-authoritative runs exit 1 with the offending root named. Frontmatter writes go through the async
`atomicWriteFile`, which this change hoists from `src/dashboard/api/atomic.ts` into
[`src/core/atomic-write.ts`](../../../src/core/atomic-write.ts) beside its sync twin, with the
dashboard's one importer re-pointed at core. The three sync modules are async, and importing from
the dashboard layer would invert the dependency. This is a change from today's plain `writeFile`
in all three modules. The pre-commit hook writes FD
frontmatter under `stage_fixed`, so a torn write is reachable. `--check` exits 1 on drift; a plain run exits 0.

### Testing

Per kind, the clearing case: start from one cached path, remove the final source tag,
run the projection, assert the array becomes empty under `--force` and is preserved-and-
reported without it. Layer A splits by kind: the missing-configured-root case applies
to code and tests only (the docs adapter's four roots are all framework defaults, so that branch
is unreachable for it), while the `EACCES` case is asserted for all three. Docs specifically: a tag inside a
table cell or after a bullet marker does not match; a tag at line start does. Adapter
`preserve` behaviour: a directory entry survives a code projection and there is no
directory-preservation path for tests or docs.

## Acceptance criteria

1. Removing the last `// @tests:` tag for a slug and running `sync test-links --force`
   empties that FD's `links.tests`.
2. Removing the last `<!-- @feature: -->` tag for a slug and running
   `sync doc-links --force` empties that FD's `links.docs`.
3. Without `--force`, an FD whose scan matched no tags keeps its cached entries and is
   named in the run's tagless-kept report, for all three kinds.
4. For the code and tests kinds, a run whose consumer-configured scan root is missing
   clears no FD and exits non-zero, naming the root; for all three kinds an unreadable
   (non-ENOENT) root does the same.
5. A run whose only missing roots come from `DEFAULT_SCAN_ROOTS` proceeds normally.
6. `sync <kind> --check` exits 0 when in sync and non-zero listing each stale FD, for
   all three kinds.
7. `<!-- @feature: <slug> -->` occurring inside a table cell or after a bullet marker
   produces no tag; the same string at line start does.
8. `sync doc-links` does not read `docs/noldor`, and no FD whose cached entries all sit under a
   templated root appears in the tagless-kept report.
9. `validate features` validates tag slugs over `docProjectionRoots()` and requires a tag only
    over `docPresenceRoots()`, so `docs/user/how-to` keeps slug validation while a consumer whose
    templated `docs/noldor` carries a framework-internal slug stays green.
10. `garden detect` emits a links-drift gap for each of the three kinds, and emits none
    for an FD the write path would skip.
11. A code FD's `links.code` directory entries survive a projection run; no
    directory-preservation path exists for tests or docs.
12. `validate script-catalog` and the six external importers of the sync modules pass
    unchanged.
13. `sync <kind>-links --quiet` prints no tagless-kept report and the same command without the
    flag does; the three lefthook sync lines pass `--quiet`.
14. After the one-time reconciliation, `sync doc-links --check` on this repo reports zero
    tagless-kept FDs and zero drift.
15. One `garden detect` traverses the shared scan tree once and parses each FD once while
    emitting drift for all three kinds.

## Risks / trade-offs

- **Behaviour change for existing consumers.** A repo that has been silently keeping
  stale `links.docs`/`links.tests` will start seeing them reported. They are not cleared
  without `--force`, so no data is lost on upgrade, but the reports are new output.
- **Layer A turns a silent skip into a failure** for consumers who configured a
  `scanPaths` entry that no longer exists. That is the intent — it is exactly the
  masquerading-emptiness case — but it can red a previously-green consumer on upgrade.
  The error names the root and the fix is a one-line config edit.
- **Dropping the 25 `docs/noldor` entries loses hand-curated attribution.** Those links were
  real: they recorded which framework doc explains which feature. Nothing replaces them here.
  Re-establishing that attribution needs doc-side tags in a non-templated location, or a
  templated-doc attribution mechanism — neither is in scope, and both are worth a follow-up entry.
- **The adapter interface may not survive contact with a fourth kind.** `spec-links` and
  `fd-resources` were deliberately excluded; if either is folded in later the interface
  will need a projection-shape distinction (array vs scalar). Deferred until there is a
  second case.

## User Story

As an agent or maintainer relying on feature-MD traceability, I want `links.code`,
`links.tests` and `links.docs` to be one projection with one clearing, emptiness and
reporting policy, so that removing a tag actually removes the link and a broken scan
never silently erases curated links.

## Usage

```bash
pnpm noldor sync code-links            # write links.code from // @fd: tags
pnpm noldor sync test-links            # write links.tests from // @tests: tags
pnpm noldor sync doc-links             # write links.docs from <!-- @feature: --> tags

pnpm noldor sync <kind>-links --check  # report drift, exit 1 if stale, write nothing
pnpm noldor sync <kind>-links --force  # clear entries a tagless scan would otherwise keep
```

`--check` and `--force` behave identically across the three kinds. `garden detect`
surfaces drift for all three without a manual run.

## Open questions (resolved)

1. *Which sync kinds fold into the projection module?*
   -> The three array-valued tag-scanned kinds: `code-links`, `test-links`, `doc-links`.
   `spec-links` derives its slug from a filename and writes a scalar, and `fd-resources`
   is frontmatter-driven; both would distort the adapter interface for no leverage (D1).

2. *Does the empty-scan wipe guard apply to docs and tests, or is it code-only?*
   -> All three kinds, in two layers: a non-authoritative scan clears nothing, and an
   authoritative-but-empty scan clears only under `--force`. Docs has 25 cached entries
   that an unguarded fix would erase on the first run (D2).

3. *Is a missing scan root an error or a skip?*
   -> Error when the consumer configured that root; skip when it comes from
   `DEFAULT_SCAN_ROOTS`. The fallback list is a union of layouts and is meant to be
   partially absent, so failing on it would break every standalone consumer (D3).

4. *Should the doc scan widen to `docs/noldor`, where every cached entry lives?*
   -> No. It was widened and then reverted: the directory is a templated twin, its only live tag
   names a Noldor-internal FD, and scanning it would warn in every consumer's hook to gain one
   already-correct link. The roots stay `docs/user/{tutorials,explanation,how-to}` and the 25
   unreconcilable entries are dropped instead (D4, D12).

5. *How does the doc adapter avoid matching prose examples?*
   -> Add the `^` line anchor the code and test regexes already use. Verified: all five
   prose occurrences sit inside table cells or after bullet markers and stop matching,
   while the real tag at line start keeps matching. No placeholder allowlist is needed (D5).

6. *Do docs and tests get `--check`, `--force` and garden drift detection?*
   -> Yes, all three. The flags fall out of the shared engine, and the detector becomes one
   kind-parameterized function. Measured green on this repo because `diffProjection`
   already excludes FDs the write path would skip (D6).

7. *Widening the doc roots desynchronizes the sync from the validators — how is that closed?*
   -> Split the provider on presence versus projection: `docProjectionRoots()` feeds the sync and
   slug validation, `docPresenceRoots()` feeds the tag-required check and garden detector 11. With
   `docs/noldor` out of the projection set there is no templated directory in either list, so slug
   validation keeps its full reach without redding a consumer (D7, D12).

8. *Layer B reports the same tagless FDs forever and `--force` is repo-wide — what converges?*
   -> A `--quiet` flag on the three lefthook sync lines silences the report there, and this repo's
   25 cached entries are dropped once during implementation. Tagging them is unavailable: they all
   sit under a templated root. A per-slug `--force` was considered and rejected as new CLI surface
   that still needs 25 decisions (D10, D13, D14).

9. *Does invoking the detector per kind triple `garden detect`'s IO?*
   -> Yes, so the engine gets a multi-adapter entry that walks the shared tree once and parses each
   FD once. `garden detect` is on the release path and the fix is small (D11).

10. *What module shape?*
   -> An engine plus adapter descriptors, with the three existing entrypoints kept as thin
   mains. Shared helpers without adapters would leave policy re-wired per file, which is how
   the three copies diverged in the first place; a single `--kind` entrypoint would point
   three manifest subcommands at one `src` path (D8).
