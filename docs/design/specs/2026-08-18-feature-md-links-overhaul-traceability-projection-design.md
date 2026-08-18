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
tag (`release-bypass-retirement`, `code-reviewer-20`), and 6 FDs carry 24
`links.docs` entries with no surviving tag.

**Two further defects surfaced while grounding this spec.**

`DOC_DIRS` at [`sync-doc-links.ts:7`](../../../src/sync/sync-doc-links.ts) covers only
`docs/user/tutorials`, `docs/user/explanation` and `docs/user/how-to`. Every one of
the 24 cached `links.docs` entries in this repo points under `docs/noldor/`, which is
never scanned — so those links are permanently unreachable by the sync, and the one
real live tag in the repo
([`docs/noldor/drain-mode.md:5`](../../../docs/noldor/drain-mode.md)) is invisible to it.
In this repo `docs/user/tutorials` and `docs/user/explanation` do not exist at all.

The doc tag regex `/<!--\s*@feature:\s*(.+?)\s*-->/m` has no line anchor, unlike the
`^`-anchored code and test regexes. It matches the literal example string
`<!-- @feature: <slug> -->` wherever it appears in prose — five framework docs contain
it inside table cells and bullets. Widening the scan roots without anchoring would
import five bogus `<slug>` references.

Finally, the doc-root list is forked four ways: sync uses three directories while
[`validate-features.ts:355`](../../../src/features/validate-features.ts),
[`sdd-report.ts:1000`](../../../src/garden/sdd-report.ts) and
[`dashboard/data.ts:1151`](../../../src/dashboard/data.ts) each hardcode two.

## Goals

- One projection engine shared by the three array-valued tag-scanned kinds, so a fix
  to clearing, scan failure or reporting applies to every traceability kind at once.
- `sync doc-links` and `sync test-links` clear a feature's last removed tag.
- A scan that could not read its inputs never masquerades as authoritative emptiness.
- The doc scan reaches the directory where the repo's real tags and cached links live,
  without importing prose examples and without redding the presence validator.
- `--check` and `--force`, plus garden drift detection, available for all three kinds
  rather than code alone.

## Non-goals

- `sync spec-links` and `sync fd-resources` are untouched. `spec-links` derives its
  slug from a filename via `extractSpecSlug` and writes a single-string `links.spec`,
  not a tag-scanned array; `fd-resources` is frontmatter-driven. Forcing either through
  the adapter interface is the over-generalization the source entry warns against.
- No `.noldor/config.json` knob for doc paths.
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
That is not hypothetical for docs: the six FDs above would lose 24 entries.

### U4 — Doc roots (`src/core/doc-roots.ts`)

Two new exports beside `loadDocRoots`:

- `docProjectionRoots()` → `docs/user/tutorials`, `docs/user/explanation`,
  `docs/user/how-to`, `docs/noldor`. Read by the docs adapter and by
  `validateDocFeatureSlugs`, so every tag the sync honors is also slug-validated.
- `docPresenceRoots()` → `docs/user/tutorials`, `docs/user/explanation`. Read by
  `validateDocTagPresence` and garden detector 11, so the roughly thirty untagged
  framework docs under `docs/noldor` are never required to carry a tag.

All four are framework defaults, so a missing one is an ENOENT skip under Layer A.
`sdd-report.ts` and `dashboard/data.ts` migrate to `docPresenceRoots()`, deleting their
literal copies.

### U5 — Entrypoints and drift detection

The three `sync-*-links.ts` files shrink to thin mains that select an adapter and call
`runProjection`, re-exporting the symbols their six external importers already use
(`extractTags`, `extractFeatureTags`, `buildSlugToCodeMap`, `collectTaggedCode`,
`loadCachedCode`, `diffProjection`, `scanRoots`). CLI manifest `src` paths are unchanged,
so `validate script-catalog` sees no churn.

`--check` and `--force` come from the engine for all three kinds.
`detectCodeLinksDrift` is replaced by one kind-parameterized detector invoked three times
in `garden-detect.ts`. Because `diffProjection` excludes FDs the write path would skip,
the 8 currently-drifting FDs surface in the tagless-kept report rather than as `sddGaps`,
so the release gate stays green.

### Error handling

A slug with no matching `docs/features/<slug>.md` warns and continues (today's behaviour).
Non-authoritative runs exit 1 with the offending root named. Frontmatter writes stay
atomic and validated. `--check` exits 1 on drift; a plain run exits 0.

### Testing

Per kind, the clearing case: start from one cached path, remove the final source tag,
run the projection, assert the array becomes empty under `--force` and is preserved-and-
reported without it. Per kind, Layer A: a missing configured root and an `EACCES` root
each yield a non-authoritative run that clears nothing. Docs specifically: a tag inside a
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
4. A run whose configured scan root is missing or unreadable clears no FD and exits
   non-zero, naming the root.
5. A run whose only missing roots come from `DEFAULT_SCAN_ROOTS` proceeds normally.
6. `sync <kind> --check` exits 0 when in sync and non-zero listing each stale FD, for
   all three kinds.
7. `<!-- @feature: <slug> -->` occurring inside a table cell or after a bullet marker
   produces no tag; the same string at line start does.
8. `sync doc-links` reads `docs/noldor` and reports
   `docs/noldor/drain-mode.md` under `portable-gate-entrypoint-for-non-claude-runners`.
9. `validate features` requires a tag only on files under `docPresenceRoots()`, and
   validates tag slugs over `docProjectionRoots()`.
10. `garden detect` emits a links-drift gap for each of the three kinds, and emits none
    for an FD the write path would skip.
11. A code FD's `links.code` directory entries survive a projection run; no
    directory-preservation path exists for tests or docs.
12. `validate script-catalog` and the six external importers of the sync modules pass
    unchanged.

## Risks / trade-offs

- **Behaviour change for existing consumers.** A repo that has been silently keeping
  stale `links.docs`/`links.tests` will start seeing them reported. They are not cleared
  without `--force`, so no data is lost on upgrade, but the reports are new output.
- **Layer A turns a silent skip into a failure** for consumers who configured a
  `scanPaths` entry that no longer exists. That is the intent — it is exactly the
  masquerading-emptiness case — but it can red a previously-green consumer on upgrade.
  The error names the root and the fix is a one-line config edit.
- **`docs/noldor` is templated and synced to consumers.** Making it a doc-projection root
  means a consumer's `links.docs` can point at framework-owned files. Accepted: the repo
  already has 24 such cached entries, so this makes an existing practice visible and
  reconcilable rather than introducing it.
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
   authoritative-but-empty scan clears only under `--force`. Docs has 24 cached entries
   that an unguarded fix would erase on the first run (D2).

3. *Is a missing scan root an error or a skip?*
   -> Error when the consumer configured that root; skip when it comes from
   `DEFAULT_SCAN_ROOTS`. The fallback list is a union of layouts and is meant to be
   partially absent, so failing on it would break every standalone consumer (D3).

4. *Does the doc scan keep `DOC_DIRS` or widen?*
   -> Widen to include `docs/noldor`. Every cached `links.docs` entry in the repo and
   the only real live tag both live there, so the current list can never reconcile them (D4).

5. *How does the doc adapter avoid matching prose examples?*
   -> Add the `^` line anchor the code and test regexes already use. Verified: all five
   prose occurrences sit inside table cells or after bullet markers and stop matching,
   while the real tag at line start keeps matching. No placeholder allowlist is needed (D5).

6. *Do docs and tests get `--check`, `--force` and garden drift detection?*
   -> Yes, all three. The flags fall out of the shared engine, and the detector becomes one
   kind-parameterized function. Measured green on this repo because `diffProjection`
   already excludes FDs the write path would skip (D6).

7. *Widening the doc roots desynchronizes the sync from the validators — how is that closed?*
   -> Split the provider: `docProjectionRoots()` (wide) feeds the sync and slug validation,
   `docPresenceRoots()` (narrow) feeds the presence check and garden detector 11. A single
   wide list would demand a tag on roughly thirty framework docs and red the build (D7).

8. *What module shape?*
   -> An engine plus adapter descriptors, with the three existing entrypoints kept as thin
   mains. Shared helpers without adapters would leave policy re-wired per file, which is how
   the three copies diverged in the first place; a single `--kind` entrypoint would point
   three manifest subcommands at one `src` path (D8).
