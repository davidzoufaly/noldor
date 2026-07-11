# Scan-Roots Repo-Paths Provider — Design

**Slug:** scan-roots-repo-paths-provider
**FD:** docs/features/scan-roots-repo-paths-provider.md
**Date:** 2026-07-03
**Tier:** specs-only

## Problem

PR #122 fixed the Charuy-layout walk in `sdd-report` `main()` by routing it through `scanRoots()` (`src/sync/sync-code-links.ts:63`), which resolves consumer `scanPaths` and falls back to the 4-dir union `['packages', 'apps', 'scripts', 'src']`. But three surfaces still hardcode the monorepo trio and see nothing on a standalone `src/` repo (self-host included):

- `src/features/fill-links-code-gaps.ts` — `walkRepo('packages'|'apps'|'scripts')` twice: interactive proposal flow (lines 399–401) and `runAutoHigh()` (lines 475–477). On self-host, `allPaths` is empty, so the links-code gap filler silently proposes/assigns nothing.
- `src/dashboard/data.ts` `loadSddInput()` — `walkRepo('packages'/'apps')` for `allRepoPaths` (lines 1052–1053) plus an extra `walkRepo('scripts')` for test discovery (line 1056), `readdir('packages')` for `actualPackages` (line 1079), and a hardcoded `graphSrcRoots: ['packages', 'apps', 'scripts']` (line 1105). The dashboard's gap output therefore diverges from `pnpm sdd:report` on any non-Charuy layout, despite the doc comment promising it "mirrors `sdd-report` `main()`".
- `src/garden/sdd-report.ts` `main()` — the walk is fixed, but `actualPackages` still comes from a raw `readdir('packages')` (line 1156), duplicated verbatim in dashboard `data.ts`.

Separately, the fallbacks have diverged: `src/features/propose-pointers.ts:119` falls back to `['src']` (`scanPaths.length > 0 ? scanPaths : ['src']`) while `scanRoots()` falls back to the 4-dir union. The PR #122 code-review lesson applies: a `['src']` fallback regresses unconfigured monorepo consumers, so the union semantics must win. `propose-pointers` also feeds its roots into `requireFreshGraph()` (`src/garden/graph-fd-lookup.ts:182`) — a fallback that disagrees with the roots the graph was built with makes the freshness check compare the wrong tree.

## Goals

- One repo-paths provider is the single source of truth for scan roots and package discovery; consumer `scanPaths` wins when set, the 4-dir union is the only fallback.
- `fill-links-code-gaps.ts` (both flows) and dashboard `loadSddInput()` walk `scanRoots()` instead of the hardcoded trio, so they work on standalone `src/` repos.
- The duplicated `readdir('packages')` / `package.json`-name blocks in `sdd-report.ts` `main()` and dashboard `data.ts` collapse into one provider function.
- `propose-pointers.ts` drops its private `['src']` fallback in favor of the provider.
- Dashboard `graphSrcRoots` matches what `sdd-report` `main()` passes (post-#122: `scanRoots()`).

## Non-goals

- The operator-assisted judgment pass over the 29 `@tests:`-untagged test files and 51 FD-unreferenced src files (detector-9 hints) — explicitly a separate follow-up per the roadmap entry.
- Other hardcoded layout heuristics that are pattern-matchers, not walks: `validate-features.ts:65` `TEST_WALK_ROOTS`, `public-api-tsdoc.ts:14` `PACKAGE_GLOB_DIRS`, `graph-to-toon.ts` package-grouping, and `fill-links-code-gaps.ts:61` `segments.indexOf('packages')` (degrades gracefully to `-1` on standalone layouts).
- Changing what counts as a "package" (see D2 — parity, not expansion).

## Design

### Unit 1 — `src/core/repo-paths.ts` (new provider module)

New module beside `src/core/doc-roots.ts` (the existing roots-provider precedent), exporting:

- `DEFAULT_SCAN_ROOTS = ['packages', 'apps', 'scripts', 'src']` — moved from `src/sync/sync-code-links.ts:14`.
- `scanRoots(): string[]` — moved verbatim from `src/sync/sync-code-links.ts:63-66`: consumer `scanPaths` (`loadConsumerConfig()`, zod default `[]` at `src/core/consumer-config.ts:79`) when non-empty, else `DEFAULT_SCAN_ROOTS`.
- `actualPackageNames(): Promise<string[]>` — extracted from the identical blocks at `src/garden/sdd-report.ts:1154-1176` and `src/dashboard/data.ts:1077-1093`: read `packages/*/package.json` names, ENOENT-tolerant (standalone repo → `[]`, matching today's caught-ENOENT behavior), skip dirs without `package.json`.

`src/sync/sync-code-links.ts` imports `scanRoots` from the provider and re-exports it (`export { scanRoots } from '../core/repo-paths.js'`) so the existing import in `src/garden/sdd-report.ts:20` keeps working; internal callers migrate to the core import.

### Unit 2 — `fill-links-code-gaps.ts` walks

Replace both hardcoded trios (lines 399–401 and 475–477) with:

```ts
for (const root of scanRoots()) {
  await walkRepo(root, allPaths);
}
```

`walkRepo` (imported from `../garden/sdd-report.js`, line 17) is already ENOENT-tolerant per its use in `sdd-report` `main()`, so union roots that don't exist are skipped silently.

### Unit 3 — dashboard `loadSddInput()` parity

Mirror the post-#122 shape of `sdd-report.ts` `main():1128-1137` exactly:

- Walk `scanRoots()` once into `allRepoPaths`; derive `testFiles` by filtering `allRepoPaths` — deleting the separate `testRepoPaths` copy + extra `walkRepo('scripts')` (lines 1055–1056), since `scripts` is already in the union (and in Charuy's configured `scanPaths`).
- `actualPackages` ← `await actualPackageNames()`.
- `graphSrcRoots: scanRoots()` instead of the literal trio (line 1105).

### Unit 4 — `sdd-report.ts` `main()` dedup

Swap the inline `readdir('packages')` block (lines 1154–1176) for `await actualPackageNames()`; switch the `scanRoots` import to the core provider.

### Unit 5 — `propose-pointers.ts` fallback unification

Replace lines 118–119 (`const { scanPaths } = loadConsumerConfig(); const srcRoots = scanPaths.length > 0 ? scanPaths : ['src']`) with `const srcRoots = scanRoots()`. This aligns the roots handed to `requireFreshGraph('graphify-out/graph.json', srcRoots, features)` (line 121) with the roots the graph and receipt were built against (PR #90 made receipt freshness mirror `scanPaths`; the fallback must match too).

### Tests

- `src/core/__tests__/repo-paths.test.ts` — `scanRoots()` returns configured `scanPaths`; empty config → 4-dir union; `actualPackageNames()` on a temp fixture with `packages/a/package.json` (named) + `packages/b/` (no package.json) + on a fixture with no `packages/` dir at all (→ `[]`).
- Standalone-layout regression: temp dir with only `src/**/*.ts`, `scanPaths: ['src']` (or unset) → `fill-links-code-gaps` candidate collection and dashboard `loadSddInput().allRepoPaths` are non-empty.
- Fallback-union regression: no `scanPaths`, monorepo fixture with `packages/` — `propose-pointers` root resolution includes `packages` (guards against a `['src']`-fallback reintroduction).

## Acceptance criteria

- `grep -rn "walkRepo('packages'\|walkRepo('apps'\|walkRepo('scripts'" src/` returns no hits outside test fixtures.
- `readdir('packages'` appears only inside `src/core/repo-paths.ts`.
- Exactly one `DEFAULT_SCAN_ROOTS` definition exists, in `src/core/repo-paths.ts`; `scanRoots()` has one definition, re-exported from `sync-code-links.ts`.
- On a standalone `src/`-only fixture, `fill-links-code-gaps --auto-high` sees candidate files and dashboard `loadGaps()` output equals `sdd-report` `main()`'s gap set (same detectors, same inputs).
- `propose-pointers.ts` contains no `['src']` fallback; with unconfigured `scanPaths` its roots equal the 4-dir union.
- Dashboard `loadSddInput()` returns `graphSrcRoots` equal to `scanRoots()`.
- `pnpm verify` green.

## Risks / trade-offs

- **Dashboard test-discovery scope shift**: today dashboard `testInputs` includes `scripts/` tests but `allRepoPaths` excludes `scripts/`; after unification both use the union. On Charuy, `allRepoPaths` gains `scripts/**` entries, which may surface previously-hidden detector gaps (that's the honest behavior — the doc comment already claims parity with sdd-report). Mitigate: run `pnpm sdd:report` + dashboard before/after on both layouts and diff.
- **`propose-pointers` fallback flip is a behavior change** for unconfigured consumers: an unconfigured standalone repo previously got `['src']`, now gets the union — harmless (extra roots ENOENT out at graph-freshness level), while unconfigured monorepos are fixed. Freshness receipts recorded under the old `['src']` roots will re-verify against union roots; a one-time graph rebuild may be needed.
- Re-export from `sync-code-links.ts` leaves two import paths for `scanRoots` alive; acceptable for churn control, and the acceptance grep pins the single definition.

## User Story

As a Noldor consumer on a non-Charuy layout (standalone `src/` repo, self-host included), I want every repo-walking surface — links-code gap filling, dashboard SDD input, pointer proposals — to resolve scan roots from one consumer-aware provider, so that these tools see my code instead of silently walking empty `packages`/`apps`/`scripts` dirs.

## Usage

No new CLI surface — existing commands gain correct behavior on non-Charuy layouts:

1. Configure once (optional): set `consumer.scanPaths` in `.noldor/config.json` (e.g. `["src"]`). Unset → 4-dir union fallback.
2. `pnpm noldor fill-links-code-gaps --auto-high` (or the interactive `--dry-run`/`--apply` flow) — now walks `scanRoots()`.
3. Dashboard (`http://localhost:4321`) gap panel — now matches `pnpm sdd:report` output on any layout.
4. `pnpm noldor propose-pointers` — roots align with graph-freshness receipts; no `['src']` surprise on unconfigured monorepos.

Agent API: import `scanRoots()` / `actualPackageNames()` from `src/core/repo-paths.ts` for any new repo-walking feature; never hardcode layout dirs.

## Open questions (resolved)

1. *Where does the provider live — extend `src/sync/sync-code-links.ts` (current home of `scanRoots()`) or a new core module?*
   -> New `src/core/repo-paths.ts`, with `sync-code-links.ts` re-exporting for import compatibility. (D1) Rationale: `sync-code-links` is a feature module — dashboard and `fill-links-code-gaps` importing from it inverts layering, while `src/core/doc-roots.ts` is the established precedent for a roots provider.

2. *Should `actualPackageNames()` expand to all scan roots (e.g. include `apps/*/package.json`) or keep `packages/`-only parity?*
   -> Keep `packages/`-only parity. (D2) Rationale: `actualPackages` feeds `detectReadmePackageDrift` (`src/garden/sdd-report.ts:557`), which checks the README `### Packages` table — adding app names would fabricate "missing from README" gaps; this entry centralizes, it doesn't redefine package semantics.

3. *Does flipping `propose-pointers`' fallback from `['src']` to the union risk breaking its graph-freshness check?*
   -> Flip it; union must win. (D3) Rationale: PR #122's CR established `['src']` regresses unconfigured monorepo consumers, and `requireFreshGraph` roots must match the roots the graph/receipt were built with (PR #90 semantics) — the union fallback is exactly what graph builds use; worst case is a one-time stale-graph rebuild prompt.
