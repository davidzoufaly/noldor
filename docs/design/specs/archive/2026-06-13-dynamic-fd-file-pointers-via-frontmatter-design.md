# Dynamic FD ↔ File Pointers via Frontmatter — Design

**Slug:** dynamic-fd-file-pointers-via-frontmatter
**FD:** docs/features/dynamic-fd-file-pointers-via-frontmatter.md
**Date:** 2026-06-13
**Tier:** full
**Deps:** none

## Problem

A feature MD (`docs/features/<slug>.md`) carries three link arrays in its
frontmatter — `links.code`, `links.tests`, `links.docs` (see
`src/features/feature-schema.ts:16` `LinksSchema`). Two of the three are
already **scan-derived from file-side tags**, but `links.code` is not, and
that asymmetry is the whole problem:

- **tests** — every test file carries a `// @tests: <slug>` comment.
  `src/sync/sync-test-links.ts` (`extractTags` → `buildSlugToTestsMap` →
  `updateFeatureMd`) walks the repo and writes `links.tests`. Presence is
  enforced by `validateTestTagPresence` in `src/features/validate-features.ts:214`.
- **docs** — tutorial/explanation MDs carry `<!-- @feature: <slug> -->`.
  `src/sync/sync-doc-links.ts` does the same for `links.docs`, enforced by
  `validateDocTagPresence`.
- **code** — code files carry **no** FD tag. `links.code` is maintained by
  hand, or backfilled in *reverse* by `src/features/fill-links-code-gaps.ts`
  (`resolveByPath` package/slug heuristic → `resolveByLlm` fallback →
  `applyProposal` writes the array). The mapping lives only on the FD side,
  so a moved/renamed/deleted file silently rots its FD's `links.code`, and
  a new file is invisible until someone re-runs the gap filler.

The body's trigger ("once FD count exceeds ~50 or after a refactor produces
N broken links across many FDs") is exactly the reverse-mapping failure mode:
manual `links.code` upkeep scales with `FDs × files`, and a refactor breaks it
en masse. The fix is to make code symmetric with tests/docs — the source file
declares its own FD, and `links.code` becomes a derived projection.

## Goals

- Add a file-side `// @fd: <slug>[, <slug>]` tag for code files, mirroring the
  exact convention and parser shape of `// @tests:` (`src/sync/sync-test-links.ts:6`).
- Add `noldor sync code-links` that scans tagged code files and writes
  `links.code` on each FD — a direct sibling of `sync test-links` / `sync doc-links`
  in the CLI manifest (`src/cli/manifest.ts:133`).
- Keep `links.code` as a **cached projection** (sync writes it; validators and
  detectors keep reading the array) and add a drift guard so a stale cache is
  caught, not silently trusted.
- Provide a one-off migration that seeds `// @fd:` tags into every file already
  listed in some FD's `links.code`, so the switch to scan-derived does not blank
  out existing arrays.
- At FD-creation time, propose initial pointers by reusing the graph primitives
  that already exist — `getCommunityOwners` and `getImportOwnersForTest`
  (`src/garden/graph-fd-lookup.ts:304`, `:254`) plus `resolveByLlm`
  (`src/features/fill-links-code-gaps.ts:162`).

## Non-goals

- Changing the `links.tests` / `links.docs` flows — they already work; this
  entry only makes code symmetric with them.
- Hard-failing every untagged code file in `validate:features` on day one. The
  orphan-code detector (`src/garden/sdd-report.ts:346`) already surfaces
  unreferenced files; tag presence becomes a *garden warning*, not a pre-commit
  wall (see D5).
- Replacing `fill-links-code-gaps.ts`. Its `resolveByPath`/`resolveByLlm`
  resolvers are *reused* by the creation-time proposer; the standalone reverse
  backfill stays as a recovery tool.
- Per-symbol (function/line) granularity. Tags are file-level, matching the
  existing `links.code` array which is file/dir-level.

## Design

### Unit 1 — `// @fd:` tag + parser (`src/sync/sync-code-links.ts`)

New module mirroring `src/sync/sync-test-links.ts` line-for-line:

- `CODE_TAG_RE = /^\/\/\s*@fd:\s*(.+?)\s*$/m` — same anchor/format as the
  `// @tests:` regex (`src/sync/sync-test-links.ts:6`), different keyword.
- `extractFdTags(content: string): string[]` — split on `,`, trim, drop empties
  (byte-for-byte the body of `extractTags`).
- `buildSlugToCodeMap(tagged: TaggedCode[]): Map<string, string[]>` — group file
  paths by tagged slug, dedupe + sort (mirror `buildSlugToTestsMap`).
- `CODE_FILE_RE = /\.(ts|tsx|js|jsx)$/` and exclusion of `*.test.*` / `*.spec.*`
  / `__tests__/` / `dist/` / `node_modules/` so a test file's `// @tests:` and a
  code file's `// @fd:` never cross.
- Scan roots come from `loadConsumerConfig().scanPaths` (when set) else
  `['packages', 'apps', 'scripts', 'src']` — `scanPaths` already exists in the
  config schema (`src/core/consumer-config.ts:51`) and is what the self-hosting
  noldor repo uses (its own code lives under `src/`).

### Unit 2 — `sync code-links` CLI + `--check` drift mode

- `main()` mirrors `sync-test-links.ts:111`: collect tagged code → build map →
  `updateFeatureMd` per slug, writing `links.code` (sorted, deduped) via
  `matter.stringify`, warning on `ENOENT` for unknown slugs.
- `--check` (no-write) recomputes the projection and diffs it against each FD's
  current `links.code`; any divergence exits non-zero with a per-FD report. This
  is what makes "cached projection" safe (D1) — the cache can never silently lie.
- Register `'code-links': { src: 'sync/sync-code-links.ts', desc: 'Sync code links into FDs' }`
  under the `sync` namespace in `src/cli/manifest.ts:136`, next to `test-links`.

### Unit 3 — drift garden detector (`src/garden/detectors/code-links-drift.ts`)

A detector in the `src/garden/detectors/*` family (siblings:
`override-audit.ts`, `tier-mismatch.ts`) that runs the Unit-2 `--check`
computation and emits a `Gap` per FD whose cached `links.code` diverges from the
scan. Wired into `garden-detect` so `/garden` and the SDD report surface code
drift the same way Detector 14/15 surface doc drift.

### Unit 4 — migration (`src/features/migrate-code-tags.ts`)

One-off: load every FD via `loadSddFeatures` (`src/garden/sdd-report.ts`), and
for each path in `links.code`, insert `// @fd: <slug>` at the top of the file
(after a leading license/shebang block if present), merging into an existing
`// @fd:` line when the file is already co-owned. Directory entries in
`links.code` are reported as "cannot tag a directory" and left for the operator.
Registered as `features migrate-code-tags` (sibling of `migrate-features`,
`src/cli/manifest.ts:117`). Run once at rollout; after it, `sync code-links`
reproduces every existing array.

### Unit 5 — creation-time pointer proposer (`src/features/propose-pointers.ts`)

`proposePointers({ slug, summary, graphPath })`:

1. Load the fresh graph + FD ownership map via
   `requireFreshGraph` (`src/garden/graph-fd-lookup.ts:182`).
2. For each candidate file in the new FD's area/package, gather signal from
   `getImportOwnersForTest` (import-edge owners) and `getCommunityOwners`
   (`graph-fd-lookup.ts:304` — files in the same graphify community).
3. For files with no graph signal, fall back to `resolveByLlm`
   (`fill-links-code-gaps.ts:162`) seeded with the FD summary.
4. Emit a proposal list `file → would-tag-with @fd: <slug>` for operator review;
   on confirm, write the `// @fd:` tags into the files (then `sync code-links`
   materializes `links.code`).

Surfaced to `/new-feature` and `/promote` as an optional `--propose-pointers`
step; both skills already scaffold the FD, so this adds a follow-on suggestion.

## Acceptance criteria

- `extractFdTags("// @fd: a, b")` → `['a', 'b']`; no tag → `[]`.
- A code file tagged `// @fd: foo` causes `sync code-links` to write its path
  into `docs/features/foo.md` `links.code` (sorted, deduped); re-running is a
  no-op (idempotent, like `sync test-links`).
- `sync code-links --check` exits 0 when every FD's `links.code` equals the
  scan, and non-zero with a per-FD diff when any array is stale.
- Test files (`*.test.ts`) are never written into `links.code`, and code files
  are never written into `links.tests`.
- `migrate-code-tags` over the live repo, followed by `sync code-links`,
  reproduces every existing `links.code` array byte-for-byte (directory entries
  excepted, reported).
- The `code-links-drift` detector reports a Gap for an FD whose `links.code`
  contains a path whose file no longer carries the matching `// @fd:` tag.
- `proposePointers` returns at least the import/community-derived candidates for
  a slug whose files are in the graph; returns `[]` (no throw) when the graph is
  stale or the slug has no candidates.

## Risks / trade-offs

- **Migration blast radius.** Seeding tags touches every file in every
  `links.code`. Mitigated by running `migrate-code-tags` once, then proving
  `sync code-links` reproduces the prior arrays before committing (acceptance
  bullet 5). The migration is the single highest-risk step.
- **Directory entries.** Some `links.code` entries are directories
  (`packages/sample-scenes`), which can't carry a comment tag. These stay
  manual; `--check` must treat a directory entry as "not scan-owned" and leave
  it rather than deleting it (otherwise the cache would shrink on every sync).
- **Two sources during transition.** Until migration completes, an FD's
  `links.code` is half hand-written / half scan-derived. The drift detector is a
  warning, not a wall (D5), so a half-migrated repo still commits.
- **Graph staleness** for the proposer — handled by `requireFreshGraph` already
  degrading gracefully; proposer returns `[]` rather than bad suggestions.

## User Story

As a contributor (human or agent) maintaining feature MDs, I want each code file
to declare which FD owns it via a `// @fd: <slug>` tag — exactly as test files
already declare `// @tests:` — so that `links.code` derives from a scan instead
of hand-maintained arrays, and a refactor that moves files can't silently rot
the FD ↔ code mapping across dozens of feature MDs.

## Usage

**Tagging a code file**

```ts
// @fd: dynamic-fd-file-pointers-via-frontmatter

import { ... } from '...';
```

Place the `// @fd:` line at the top of the file (after any shebang/license
block), mirroring where `// @tests:` sits in test files. Comma-separate slugs
for a co-owned file.

**Syncing `links.code` from tags**

```bash
pnpm noldor sync code-links          # scan tagged files, write links.code on each FD
pnpm noldor sync code-links --check  # CI/pre-commit: fail if any links.code is stale
```

**One-off migration (rollout only)**

```bash
pnpm noldor features migrate-code-tags   # seed // @fd: tags from existing links.code
pnpm noldor sync code-links --check      # prove the projection reproduces prior arrays
```

**Proposing initial pointers at FD creation**

```bash
pnpm noldor features propose-pointers --slug <new-slug>
```

Invoked optionally from `/new-feature` and `/promote` after the FD is
scaffolded; reviews import + community signal, proposes `// @fd:` tags, writes
them on confirm.

**Drift surfacing** — `pnpm noldor garden detect` (and the SDD report) now
include a `code-links-drift` gap per FD whose cached `links.code` diverges from
the tag scan.

**Keyboard shortcut** — _none (CLI + agent workflow, no UI surface)._

**Agent API** — _none (operates through `pnpm noldor` scripts and git)._

## Open questions (resolved)

1. *Keep the FD-side `links.code` array as a cached projection for
   `validate:features` speed, or always scan on demand?*
   -> **Keep it as a cached projection; sync writes it, `--check` guards it.**
   Tests and docs already work this way (`sync test-links` writes `links.tests`,
   readers consume the array), and downstream consumers —
   `buildFileToFdsMap` / `getCommunityOwners` (`graph-fd-lookup.ts`) and the SDD
   orphan detector (`sdd-report.ts:346`) — read `links.code` directly. Always-scan
   would force every one of those to re-walk the tree. The drift detector (Unit 3)
   removes the only downside of caching (silent staleness). (D1)

2. *Should `// @fd:` presence be a hard `validate:features` failure (like
   `// @tests:`), or a soft garden warning?*
   -> **Soft garden warning at first, not a pre-commit wall.** A hard wall would
   reject every commit during the half-migrated transition window, and the orphan
   detector (`sdd-report.ts:346`) already names untagged files. Promote to a hard
   validator only after the repo is fully tagged. (D2)

3. *What scan roots should `sync code-links` walk?*
   -> **`loadConsumerConfig().scanPaths` when set, else `['packages','apps','scripts','src']`.**
   `scanPaths` is already in the config schema (`consumer-config.ts:51`) and is
   what the self-hosting noldor repo uses (its code lives under `src/`, which the
   `apps`/`packages` defaults in `fill-links-code-gaps.ts` miss). (D3)

4. *Build a fresh resolver for the creation-time brainstorm, or reuse existing
   code?*
   -> **Reuse `getImportOwnersForTest` + `getCommunityOwners` + `resolveByLlm`.**
   The "imports + community membership" signal the body asks for is exactly what
   those functions already compute (`graph-fd-lookup.ts:254`, `:304`); a new
   resolver would duplicate them. (D4)

5. *How do we avoid blanking existing `links.code` arrays when we flip to
   scan-derived?*
   -> **Ship `migrate-code-tags` first and gate the flip on `sync code-links
   --check` reproducing the prior arrays.** Without the seeding migration, the
   first `sync code-links` would write empty arrays everywhere. The migration +
   check is the safe ordering. (D5)
