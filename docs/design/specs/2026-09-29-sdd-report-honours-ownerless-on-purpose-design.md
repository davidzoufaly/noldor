# SDD Report Honours Ownerless On Purpose — Design

**Slug:** sdd-report-honours-ownerless-on-purpose
**FD:** docs/features/sdd-report-honours-ownerless-on-purpose.md
**Date:** 2026-09-29
**Tier:** specs-only

UI verdict: skip — no `consumer.uiPaths` configured and nothing here renders a surface.
Architecture verdict: skip — no new directory, package, external or cross-module import; edits stay inside `src/garden/sdd-report.ts` and the config schema.

## Problem

ADR 0009 ([`docs/adr/0009-links-code-means-what-a-file-is-about.md`](../../adr/0009-links-code-means-what-a-file-is-about.md)) says a shared helper that is about no single feature may have no owner. The SDD report does not know that. Two detectors in [`src/garden/sdd-report.ts`](../../../src/garden/sdd-report.ts) still count those honest cases as gaps:

- `detectCodeOrphans` ("Code files not referenced by any feature") lists every `.ts` file no FD's `links.code` names. Today that is 20 rows in `docs/sdd-report.md`. Some are real gaps (a file that should have an owner and lacks one). Others, like `src/core/consumer-config.ts`, `src/core/doc-roots.ts` and `src/core/session.ts`, are ownerless on purpose.
- `detectDoneFeaturesMissingCode` ("Done features without code") lists every `phase: done` FD with an empty `links.code`. Today that is 7 rows: the five dashboard page FDs, `scripts-reorganization-by-feature-area` and `self-boundaries-declaration-and-cycle-break`. PR #636 emptied them on purpose, because their code lives in shared files.

When honest rows and real gaps sit in one list, nobody can tell them apart, so nobody reads the list.

The existing `CODE_EXEMPT_SENTINEL` (`'n/a'` in `links.code`) does not fit. It means "this feature has no code by design", which is false here: these features have code, it just lives in shared files. It also carries no reason.

## Goals

- One declared place that says "this file / this FD is ownerless on purpose", with a reason for each entry.
- Both detectors skip what is declared there.
- A declaration that stops being true (file deleted, file gained an owner, FD gained code) shows up as a finding, so the list cannot rot quietly.
- Classify today's 27 rows (20 files + 7 FDs): declare the honest ones, leave the real gaps as rows.

## Non-goals

- Giving owners to the 10 files that should have one. Those rows stay in the report; that work is filed as its own `ideas.md` bullet at ship time.
- Changing what `features owners` or the co-tag detector (`computeMissingCoTags`, `src/garden/graph-fd-lookup.ts`) return. An ownerless file already has zero owners there.
- Removing `'n/a'`. It keeps its current meaning for pure-content FDs.

## Design

### Structural context

`src/garden/sdd-report.ts` sits in community c16 with the garden detectors (`detectors/adr.ts`, `detectors/override-audit.ts`). It reaches out across communities to `consumer-config.ts` [c40], `fd-load.ts` and `doc-roots.ts` [c64], and `graph-fd-lookup.ts` [c30]. It defines no god node, so the detector change itself is interior.

The config side is not interior. `src/core/consumer-config.ts` [c40] defines `loadConsumerConfig()`, god node rank #5 with 41 edges. A new field there is read-only for every other caller, but the schema change is seen by all 41 edges, so it must stay optional with an empty default.

`src/sync/adapters/code.ts` [c15, feature-md-links-overhaul] projects `links.code` from `// @fd:` headers. Its `preserve` rule keeps any entry without a file extension, which is why `'n/a'` survives a sync. This design does not touch it if the declaration lives in config (see next unit).

### Where the declaration lives

A new optional block in `.noldor/config.json`, parsed by `loadConsumerConfig` in [`src/core/consumer-config.ts`](../../../src/core/consumer-config.ts):

```json
"consumer": {
  "ownerless": {
    "files": { "src/core/consumer-config.ts": "config loader every module reads" },
    "features": { "dashboard-hot-zones-page": "page renders from src/dashboard/views.ts, shared by all pages" }
  }
}
```

Each value is a required reason that is not blank after trimming. Keys under `files` are repo-relative paths; keys under `features` are FD slugs.

Only the SDD report reads this block. Nothing else in the framework changes meaning.

Rejected: marking files in place with `// @fd: none — <reason>` and FDs with a `links.code: ['shared']` sentinel. It keeps the mark next to the file and survives a rename, but `// @fd: none` flows through the tag projection (`src/sync/sync-code-links.ts`), `validate-features` and `graph-fd-lookup`, which would all need to learn that `none` is not a slug. The rename risk the config list carries is covered by the stale-declaration check below.

### Detector changes

`detectCodeOrphans(allPaths, features, suggestion?, ownerless?)` drops any path listed in `ownerless.files`, or under a listed directory (the same `isCoveredByAncestorDir` rule `links.code` directory entries use). `detectDoneFeaturesMissingCode(features, ownerless?)` drops any FD listed in `ownerless.features`. Both keep working with the argument absent, so existing unit tests stay valid.

The block reaches them through `ReportInput` (`src/garden/sdd-report.ts:561`) as a **required** field, filled by both builders (`src/garden/sdd-report.ts` and `loadSddInput` in `src/dashboard/data.ts`), and `collectGaps` passes it to both detectors. Required, not optional, because `collectGaps` already warns about this trap: an optional input silently drops behaviour for any caller that forgets it, which is the dashboard-vs-report divergence the `loadSddInput layout parity` test guards. The schema itself is a new optional key on `ConsumerConfigSchema` (zod, `src/core/consumer-config.ts`) defaulting to `{ files: {}, features: {} }`.

### Stale-declaration check

A new detector, `detectStaleOwnerless`, emits one gap per declaration that no longer holds:

- a `files` entry whose path does not exist on disk (checked with `existsSync` against the repo root, not against `ReportInput.allRepoPaths`, which holds only walked files and so never contains a directory key or a file outside the scan roots);
- a `files` entry that some FD's `links.code` now covers (directly or by an ancestor directory, reusing `isCoveredByAncestorDir`);
- a `files` entry for a file `detectCodeOrphans` would never flag anyway (it matches `CODE_IGNORE_PATTERNS` or `isInfraFile`, or is not `.ts` / `.tsx`), since it hides nothing;
- a `features` entry whose slug has no FD, or whose FD now has a non-empty `links.code`.

Its category is "Stale ownerless declarations", and it runs inside `collectGaps` like every other detector. It lives in the SDD report and not in `validate noldor-config` because the report already loads every FD and walks the files it needs; the validator does neither. A stale row weighs the same as the row the entry was hiding, so it blocks the garden auto-restamp the same way.

### Classifying today's rows

The test for each row is ADR 0009's: is the file *about* one feature? If yes, the row is a real gap and stays. If it serves many features and is about none, it is declared.

**Declared ownerless (10 files).** Shared plumbing, each imported from several feature areas:

| File | Reason |
| --- | --- |
| `src/cli/manifest.ts` | the CLI's command registry; every verb group registers here |
| `src/core/config.ts` | repo config loader, 57 importers |
| `src/core/consumer-config.ts` | consumer config schema + loader, 39 importers |
| `src/core/doc-roots.ts` | doc-root resolution, 47 importers |
| `src/core/read-text.ts` | read-or-null file helper |
| `src/core/session.ts` | session-marker IO, used by every gate path |
| `src/cr/atomic-write.ts` | temp-then-rename JSON write, 26 importers |
| `src/cr/git-tree.ts` | tree-sha helper every CR receipt binds to |
| `src/cr/geometry/geometry-cli-emit.ts` | output plumbing shared by every `design geometry-*` entrypoint |
| `src/cr/lanes/pen-dispatch.ts` | shared child-dispatch for every pencil-MCP lane |

**Left as real gaps (10 files).** Each is about one feature and should get a `// @fd:` header in a later change: `src/autonomous/drain-eligibility.ts`, `src/autonomous/status-cli.ts`, `src/cr/cut-scan.ts`, `src/cr/geometry/geometry-export-cli.ts`, `src/cr/lanes/geometry-extract-dispatch.ts`, `src/cr/lanes/codex.ts`, `src/design/arch-draw.ts`, `src/design/editor-launch.ts`, `src/garden/detectors/fd-command-rot.ts`, `src/release/index.ts`.

**Declared ownerless (7 FDs).** All seven "Done features without code" rows: the five dashboard page FDs render from the shared `src/dashboard/` views, and `scripts-reorganization-by-feature-area` and `self-boundaries-declaration-and-cycle-break` were repo-wide restructures whose "code" is every file they moved.

### Files touched

- `src/core/consumer-config.ts` — `ownerless` key on `ConsumerConfigSchema`: `files` and `features`, each `z.record(z.string(), z.string().trim().min(1))`, defaulting to empty.
- `src/garden/sdd-report.ts` — `ReportInput.ownerless` (required), filled by its loader; the two detectors take it; new `detectStaleOwnerless`; `collectGaps` wires all three.
- `src/dashboard/data.ts` — `loadSddInput`, the second `ReportInput` builder, fills `ownerless` the same way.
- `src/garden/__tests__/sdd-report.test.ts` — unit tests for each criterion below.
- `.noldor/config.json` — the 10 file and 7 FD declarations.
- `docs/noldor/garden-and-drift.md` and its twin `templates/docs/noldor/garden-and-drift.md` — detector 9 and 19 rows name the declaration as a fix, plus a short note on the stale row.
- `docs/sdd-report.md` — regenerated.

## Acceptance criteria

- A file listed under `consumer.ownerless.files` gets no "Code files not referenced by any feature" row, and neither does a file under a listed directory.
- An FD listed under `consumer.ownerless.features` gets no "Done features without code" row.
- An entry with an empty or whitespace-only reason makes `loadConsumerConfig` throw, so every `pnpm noldor` command that reads the config exits non-zero.
- A `files` entry whose path is missing on disk, is now covered by some FD's `links.code`, or names a file the orphan detector would never flag, yields exactly one "Stale ownerless declarations" gap. A directory key that exists is not stale.
- A `features` entry whose slug has no FD, or whose FD has a non-empty `links.code`, yields exactly one "Stale ownerless declarations" gap.
- With no `ownerless` block, `collectGaps` returns exactly the gaps it returns today.
- The dashboard and the report still read the same `ReportInput` (the `loadSddInput layout parity` test stays green).
- `'n/a'` in `links.code` still exempts an FD as before.
- After the change, `pnpm noldor garden sdd-report` on this repo shows no "Done features without code" rows, exactly the 10 real-gap files under "Code files not referenced by any feature", and no stale rows.

## Risks / trade-offs

- A config list can drift from the code on a rename. The stale check turns that into a visible row instead of silent rot.
- Declaring is a judgment call, same as ADR 0009's owner choice. A lazy declaration hides a real gap. The required reason makes a lazy one visible in review.
- Touching `ConsumerConfig` reaches every caller of a rank-#5 god node; keeping the field optional with an empty default keeps them unaffected.
- Declaring a directory key under `files` hides every file below it. That is allowed, the same way `links.code` directory entries work, but the reason must then hold for every file under it.

## User Story

As a maintainer reading the SDD report, I want files and features that are ownerless on purpose to drop out of the gap lists, so that every row left is a real gap I should fix.

## Usage

Add an entry with its reason to `.noldor/config.json`:

```json
"ownerless": { "files": { "src/core/session.ts": "session marker IO, used by every path" } }
```

Then run `pnpm noldor garden sdd-report`. The row is gone. If the file is later deleted or given an owner, the report shows a "Stale ownerless declarations" row until the entry is removed.

## Open questions (resolved)

1. _Config list or in-file markers?_ -> Config list under `consumer.ownerless`. One reader, no change to the tag projection, slug validation or graph lookup; the stale check covers the rename risk (D1).
2. _Should the stale check live in the SDD report or in `validate noldor-config`?_ -> SDD report. It needs the FD set and the file walk, which the report already loads (D2).
3. _Fold owner fixes for the 10 real-gap files into this feature?_ -> No. Keep this to the mechanism and the honest declarations; the real gaps stay visible as rows and get their own `ideas.md` bullet (D3).
4. _Should a directory key be allowed under `files`?_ -> Yes, matching how `links.code` treats directories (`isCoveredByAncestorDir`). No declaration today needs one, but refusing it would make the two lists behave differently (D4).
